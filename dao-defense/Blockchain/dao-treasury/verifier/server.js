const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { validProof, readState } = require("./checks");

const PORT = Number(process.env.PORT || 9090);
const TEAMS_FILE = process.env.TEAMS_FILE || path.join(__dirname, "teams.json");
const FLAGS_FILE = process.env.FLAGS_FILE || path.join(__dirname, "flags.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// Fail closed: in production the organizer-only endpoints (/teams, /status)
// MUST be protected. Refuse to start if NODE_ENV=production and no token.
if (process.env.NODE_ENV === "production" && !ADMIN_TOKEN) {
  console.error("fatal: ADMIN_TOKEN is required when NODE_ENV=production");
  process.exit(1);
}

const VULNS = ["oracle", "gauge", "batch", "ghost", "sandwich"];

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "content-type, authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function fingerprint(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

const CLAIM_TYPES = {
  Claim: [
    { name: "player", type: "address" },
    { name: "kind", type: "bytes32" },
    { name: "proof", type: "address" },
    { name: "nonce", type: "bytes32" },
    { name: "expiry", type: "uint64" },
    { name: "flagEpoch", type: "bytes32" },
  ],
};

// The contract registry is stable per event; read it once at startup.
const teams = loadJson(TEAMS_FILE);
// Flags ROTATE every round. They are seeded from flags.json at startup and
// updated in place by the organizer — either by hand-editing the file (picked
// up on restart) or, in production, via the admin POST /flag endpoint that the
// GZCTF checker calls each tick.
let flags = loadJson(FLAGS_FILE);
const nonces = new Map();    // `${teamId}:${player}:${kind}` -> { nonce, expiry, flagEpoch, baseline }
const claimed = new Set();   // `${teamId}:${flagEpoch}:${player}:${kind}`
const usedProbes = new Set(); // ghost probe addresses already claimed (any round)

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Persist the current in-memory flags to disk (best-effort — the in-memory map
// is authoritative; a read-only mount only means a restart would re-seed from
// the older file).
function persistFlags() {
  try {
    fs.writeFileSync(FLAGS_FILE, JSON.stringify(flags, null, 2) + "\n");
  } catch (error) {
    console.error("warning: could not persist flags.json:", error.message);
  }
}

function flagFor(teamId) {
  const flag = flags[teamId];
  if (!flag) throw new Error(`no flag for team "${teamId}"`);
  return flag;
}

// A claim is scoped to the flag epoch it was issued in, so a new round
// (new flag) naturally re-arms the same player+kind.
function claimKey(teamId, flagEpoch, player, kind) {
  return `${teamId}:${flagEpoch}:${player}:${kind}`;
}

function claimPayload(team, player, kind, proof, nonce, expiry, flag) {
  return {
    domain: {
      name: "DAO Defense Claim",
      version: "1",
      chainId: team.chainId,
      verifyingContract: team.contracts.treasury,
    },
    types: CLAIM_TYPES,
    value: {
      player,
      kind: ethers.id(kind),
      proof,
      nonce,
      expiry,
      flagEpoch: `0x${fingerprint(flag)}`,
    },
  };
}

// Organizer-only guard. When ADMIN_TOKEN is unset (local dev), endpoints stay
// open; in production the process refuses to start without it.
function adminOnly(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const provided = (req.get("authorization") || "").replace(/^Bearer\s+/i, "") || String(req.query.token || "");
  if (provided !== ADMIN_TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

// Registry for the organizer dashboard (no flags — those are secret).
app.get("/teams", adminOnly, (_req, res) => {
  const out = {};
  for (const [id, cfg] of Object.entries(teams)) {
    out[id] = { rpc: cfg.rpc, chainId: cfg.chainId, contracts: cfg.contracts };
  }
  res.json(out);
});

// Update a team's round flag. Called by the GZCTF checker each tick so the
// verifier always holds the same flag the target service was seeded with — no
// manual flags.json maintenance. Admin-only.
app.post("/flag", adminOnly, (req, res) => {
  const teamId = String(req.body?.team || "");
  const flag = String(req.body?.flag || "");
  if (!teamId || !flag) return res.status(400).json({ error: "team and flag required" });
  if (!teams[teamId]) return res.status(404).json({ error: "unknown team" });
  flags[teamId] = flag;
  persistFlags();
  res.json({ ok: true, team: teamId, round: req.body?.round });
});

app.get("/claim-challenge", async (req, res, next) => {
  try {
    const teamId = String(req.query.team || "");
    const team = teams[teamId];
    if (!team) return res.status(404).json({ error: "unknown team" });
    const player = ethers.getAddress(req.query.player || "");
    const kind = String(req.query.kind || "");
    const proof = ethers.getAddress(req.query.proof || ethers.ZeroAddress);
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });

    const flag = flagFor(teamId);
    const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    // Snapshot the attacker's state NOW so the claim is a delta over this
    // session (the exploit must happen AFTER this challenge is issued).
    const baseline = await readState(team, player, proof);
    nonces.set(`${teamId}:${player}:${kind}`, { nonce, expiry, flagEpoch: fingerprint(flag), baseline });
    res.json(claimPayload(team, player, kind, proof, nonce, expiry, flag));
  } catch (error) { next(error); }
});

app.post("/claim", async (req, res, next) => {
  try {
    const teamId = String(req.body?.team || "");
    const team = teams[teamId];
    if (!team) return res.status(404).json({ error: "unknown team" });
    const kind = String(req.body?.kind || "");
    const player = ethers.getAddress(req.body?.player || "");
    const proof = ethers.getAddress(req.body?.proof || ethers.ZeroAddress);
    const nonce = String(req.body?.nonce || "");
    const sessionKey = `${teamId}:${player}:${kind}`;
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });

    // A ghost probe is a one-shot proof — it can only be claimed once, ever.
    if (kind === "ghost" && usedProbes.has(proof)) {
      return res.status(403).json({ error: "ghost probe already claimed" });
    }

    const session = nonces.get(sessionKey);
    if (!session || session.nonce !== nonce) return res.status(403).json({ error: "bad claim nonce" });
    if (Math.floor(Date.now() / 1000) > session.expiry) {
      nonces.delete(sessionKey);
      return res.status(403).json({ error: "claim challenge expired" });
    }

    // Re-read the current flag; reject if the round rotated since the challenge
    // was issued (the signed payload is bound to a specific flag epoch).
    const flag = flagFor(teamId);
    if (fingerprint(flag) !== session.flagEpoch) {
      nonces.delete(sessionKey);
      return res.status(403).json({ error: "flag rotated, request a new challenge" });
    }
    if (claimed.has(claimKey(teamId, session.flagEpoch, player, kind))) {
      return res.status(409).json({ error: "vulnerability already claimed" });
    }

    const payload = claimPayload(team, player, kind, proof, nonce, session.expiry, flag);
    if (ethers.verifyTypedData(payload.domain, payload.types, payload.value, req.body?.signature || "") !== player) {
      return res.status(403).json({ error: "bad signature" });
    }
    nonces.delete(sessionKey);
    // Delta-based verification against the baseline captured at challenge time.
    if (!(await validProof(team, player, kind, proof, session.baseline))) {
      return res.status(403).json({ error: "exploit condition not met" });
    }
    if (kind === "ghost") usedProbes.add(proof);
    claimed.add(claimKey(teamId, session.flagEpoch, player, kind));
    res.json({ flag, vulnerability: kind });
  } catch (error) { next(error); }
});

app.get("/status", adminOnly, (_req, res) => {
  const result = {};
  for (const teamId of Object.keys(teams)) {
    const epoch = fingerprint(flagFor(teamId));
    result[teamId] = {};
    for (const kind of VULNS) {
      result[teamId][kind] = [...claimed].some((key) => key.startsWith(`${teamId}:${epoch}:`) && key.endsWith(`:${kind}`));
    }
  }
  res.json(result);
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

app.listen(PORT, "0.0.0.0", () => console.log(`attack verifier listening on ${PORT}`));
