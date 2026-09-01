const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { validProof, readState } = require("./checks");

const PORT = Number(process.env.PORT || 9090);
const TEAMS_FILE = process.env.TEAMS_FILE || path.join(__dirname, "teams.json");
const FLAGS_FILE = process.env.FLAGS_FILE || path.join(__dirname, "flags.json");
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, "state.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CLAIM_TTL_SECONDS = Number(process.env.CLAIM_TTL_SECONDS || 300);
const CLAIM_RATE_WINDOW_MS = Number(process.env.CLAIM_RATE_WINDOW_MS || 60_000);
const CLAIM_RATE_MAX = Number(process.env.CLAIM_RATE_MAX || 30);
const CLAIM_RATE_BY_IP = process.env.CLAIM_RATE_BY_IP === "true";

if (process.env.NODE_ENV === "production" && !ADMIN_TOKEN) {
  console.error("fatal: ADMIN_TOKEN is required when NODE_ENV=production");
  process.exit(1);
}

const VULNS = ["oracle", "gauge", "batch", "ghost", "sandwich"];
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "content-type, authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function fingerprint(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function loadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (fallback !== null && error.code === "ENOENT") return fallback;
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}

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

const teams = loadJson(TEAMS_FILE);
let flags = loadJson(FLAGS_FILE, {});
const saved = loadJson(STATE_FILE, { rounds: {}, claimed: [], usedProbes: [] });
const rounds = new Map(Object.entries(saved.rounds || {}).map(([k, v]) => [k, Number(v)]));
const claimed = new Set(saved.claimed || []);
const usedProbes = new Set(saved.usedProbes || []);
const nonces = new Map();
const rate = new Map();

// FLAGS_FILE is a bind-mounted file in the organizer compose stack. Replacing
// that mount point with rename(2) can fail with EBUSY, so write it in place.
function persistFlags() {
  fs.writeFileSync(FLAGS_FILE, JSON.stringify(flags, null, 2) + "\n", { mode: 0o600 });
}

// STATE_FILE lives on a normal named volume, so atomic replacement is safe.
function persistState() {
  writeJsonAtomic(STATE_FILE, {
    rounds: Object.fromEntries(rounds),
    claimed: [...claimed],
    usedProbes: [...usedProbes],
  });
}

function flagFor(teamId) {
  const flag = flags[teamId];
  if (!flag) throw new Error(`no flag for team "${teamId}"`);
  return String(flag);
}

function claimKey(teamId, flagEpoch, player, kind) {
  return `${teamId}:${flagEpoch}:${player}:${kind}`;
}

function sessionKey(teamId, player, kind) {
  return `${teamId}:${player}:${kind}`;
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

function adminOnly(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const provided = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!provided || provided !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function checkRate(req, player) {
  const now = Date.now();
  const keys = [`player:${player.toLowerCase()}`];
  // Enable IP limiting only when the deployment preserves the real client IP;
  // otherwise every player behind one reverse proxy would share one bucket.
  if (CLAIM_RATE_BY_IP) keys.push(`ip:${req.ip}`);

  for (const key of keys) {
    const entry = rate.get(key);
    if (!entry || now - entry.started >= CLAIM_RATE_WINDOW_MS) {
      rate.set(key, { started: now, count: 1 });
      continue;
    }
    if (entry.count >= CLAIM_RATE_MAX) return false;
    entry.count += 1;
  }
  return true;
}

function cleanup() {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [key, session] of nonces) {
    if (session.expiry < nowSec) nonces.delete(key);
  }
  const now = Date.now();
  for (const [key, entry] of rate) {
    if (now - entry.started >= CLAIM_RATE_WINDOW_MS * 2) rate.delete(key);
  }
}
setInterval(cleanup, 30_000).unref();

app.get("/health", (_req, res) => res.type("text/plain").send("ok"));

app.get("/teams", adminOnly, (_req, res) => {
  const out = {};
  for (const [id, cfg] of Object.entries(teams)) {
    out[id] = { rpc: cfg.rpc, chainId: cfg.chainId, contracts: cfg.contracts };
  }
  res.json(out);
});

// GZCTF checker -> verifier flag synchronization. Rounds are monotonic: a late
// checker from an older tick cannot roll the verifier back to a stale flag.
app.post("/flag", adminOnly, (req, res) => {
  const teamId = String(req.body?.team || "");
  const flag = String(req.body?.flag || "").trim();
  const round = Number(req.body?.round);
  if (!teamId || !flag || !Number.isSafeInteger(round) || round < 0) {
    return res.status(400).json({ error: "team, flag and non-negative integer round required" });
  }
  if (!teams[teamId]) return res.status(404).json({ error: "unknown team" });

  const currentRound = rounds.get(teamId);
  if (currentRound !== undefined && round < currentRound) {
    return res.status(409).json({ error: "stale round", currentRound });
  }
  if (currentRound === round && flags[teamId] && flags[teamId] !== flag) {
    return res.status(409).json({ error: "conflicting flag for current round" });
  }

  rounds.set(teamId, round);
  flags[teamId] = flag;
  persistFlags();
  persistState();
  res.json({ ok: true, team: teamId, round });
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
    if (!checkRate(req, player)) return res.status(429).json({ error: "claim challenge rate limit exceeded" });

    const flag = flagFor(teamId);
    const baseline = await readState(team, player, proof);

    // The sandwich attacker must already have received its 200 MKT starter
    // allocation before the baseline is captured. This closes the sequence
    // challenge -> faucet -> claim, which otherwise looks like positive profit.
    if (kind === "sandwich" && baseline.marketAsset < ethers.parseEther("200")) {
      return res.status(400).json({ error: "fund player before requesting sandwich challenge" });
    }

    const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
    const expiry = Math.floor(Date.now() / 1000) + CLAIM_TTL_SECONDS;
    nonces.set(sessionKey(teamId, player, kind), {
      nonce,
      expiry,
      flagEpoch: fingerprint(flag),
      baseline,
      proof,
    });
    res.json(claimPayload(team, player, kind, proof, nonce, expiry, flag));
  } catch (error) {
    next(error);
  }
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
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });

    if (kind === "ghost" && usedProbes.has(proof.toLowerCase())) {
      return res.status(403).json({ error: "ghost probe already claimed" });
    }

    const key = sessionKey(teamId, player, kind);
    const session = nonces.get(key);
    if (!session || session.nonce !== nonce) return res.status(403).json({ error: "bad claim nonce" });
    if (proof !== session.proof) return res.status(403).json({ error: "proof does not match challenge" });
    if (Math.floor(Date.now() / 1000) > session.expiry) {
      nonces.delete(key);
      return res.status(403).json({ error: "claim challenge expired" });
    }

    const flag = flagFor(teamId);
    if (fingerprint(flag) !== session.flagEpoch) {
      nonces.delete(key);
      return res.status(403).json({ error: "flag rotated, request a new challenge" });
    }

    const cKey = claimKey(teamId, session.flagEpoch, player, kind);
    if (claimed.has(cKey)) return res.status(409).json({ error: "vulnerability already claimed" });

    const payload = claimPayload(team, player, kind, proof, nonce, session.expiry, flag);
    const signer = ethers.getAddress(ethers.verifyTypedData(
      payload.domain,
      payload.types,
      payload.value,
      req.body?.signature || "",
    ));
    if (signer !== player) return res.status(403).json({ error: "bad signature" });

    nonces.delete(key);
    if (!(await validProof(team, player, kind, proof, session.baseline))) {
      return res.status(403).json({ error: "exploit condition not met" });
    }

    if (kind === "ghost") usedProbes.add(proof.toLowerCase());
    claimed.add(cKey);
    persistState();
    res.json({ flag, vulnerability: kind });
  } catch (error) {
    next(error);
  }
});

app.get("/status", adminOnly, (_req, res, next) => {
  try {
    const result = {};
    for (const teamId of Object.keys(teams)) {
      const epoch = fingerprint(flagFor(teamId));
      result[teamId] = { round: rounds.get(teamId) ?? null };
      for (const kind of VULNS) {
        result[teamId][kind] = [...claimed].some(
          (key) => key.startsWith(`${teamId}:${epoch}:`) && key.endsWith(`:${kind}`),
        );
      }
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

app.listen(PORT, "0.0.0.0", () => console.log(`attack verifier listening on ${PORT}`));
