const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { validProof } = require("./checks");

const PORT = Number(process.env.PORT || 9090);
const TEAMS_FILE = process.env.TEAMS_FILE || path.join(__dirname, "teams.json");
const FLAGS_FILE = process.env.FLAGS_FILE || path.join(__dirname, "flags.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

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
// Flags ROTATE every round, so they are re-read from disk on every request
// (the organizer/GZCTF flag-lifecycle hook rewrites flags.json in place).
const nonces = new Map();   // `${teamId}:${player}:${kind}` -> { nonce, expiry, flagEpoch }
const claimed = new Set();  // `${teamId}:${flagEpoch}:${player}:${kind}`

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Re-read the flags file each call so a round rotation takes effect without a
// verifier restart.
function flagFor(teamId) {
  const flags = loadJson(FLAGS_FILE);
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
// open; in production set it and the organizer dashboard passes it as a bearer
// token (or ?token= query).
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

app.get("/claim-challenge", (req, res, next) => {
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
    nonces.set(`${teamId}:${player}:${kind}`, { nonce, expiry, flagEpoch: fingerprint(flag) });
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
    if (!(await validProof(team, player, kind, proof))) return res.status(403).json({ error: "exploit condition not met" });
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
