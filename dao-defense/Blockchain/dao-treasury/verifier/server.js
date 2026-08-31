const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { validProof, fetchJson } = require("./checks");

const PORT = Number(process.env.PORT || 9090);
const TEAMS_FILE = process.env.TEAMS_FILE || path.join(__dirname, "teams.json");

const VULNS = ["oracle", "gauge", "batch", "ghost", "sandwich"];

const app = express();
app.use(express.json({ limit: "512kb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "content-type");
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

const teams = loadTeams();
const nonces = new Map();   // `${teamId}:${player}:${kind}` -> { nonce, expiry, info }
const claimed = new Set();  // `${teamId}:${player}:${kind}`

function loadTeams() {
  const raw = fs.readFileSync(TEAMS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  for (const [id, cfg] of Object.entries(parsed)) {
    if (!cfg.rpc || !cfg.flag) throw new Error(`team "${id}" is missing rpc or flag`);
  }
  return parsed;
}

async function claimPayload(team, info, player, kind, proof, nonce, expiry) {
  return {
    domain: { name: "DAO Defense Claim", version: "1", chainId: info.chainId, verifyingContract: info.contracts.treasury },
    types: CLAIM_TYPES,
    value: { player, kind: ethers.id(kind), proof, nonce, expiry, flagEpoch: `0x${fingerprint(team.flag)}` },
  };
}

app.get("/health", (_req, res) => res.type("text/plain").send("ok"));
app.get("/teams", (_req, res) => res.json(Object.keys(teams)));

app.get("/claim-challenge", async (req, res, next) => {
  try {
    const team = teams[String(req.query.team || "")];
    if (!team) return res.status(404).json({ error: "unknown team" });
    const player = ethers.getAddress(req.query.player || "");
    const kind = String(req.query.kind || "");
    const proof = ethers.getAddress(req.query.proof || ethers.ZeroAddress);
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });

    const info = await fetchJson(`${team.rpc}/info`);
    const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    nonces.set(`${team.rpc}:${player}:${kind}`, { nonce, expiry, info });
    res.json(await claimPayload(team, info, player, kind, proof, nonce, expiry));
  } catch (error) { next(error); }
});

app.post("/claim", async (req, res, next) => {
  try {
    const team = teams[String(req.body?.team || "")];
    if (!team) return res.status(404).json({ error: "unknown team" });
    const kind = String(req.body?.kind || "");
    const player = ethers.getAddress(req.body?.player || "");
    const proof = ethers.getAddress(req.body?.proof || ethers.ZeroAddress);
    const nonce = String(req.body?.nonce || "");
    const key = `${team.rpc}:${player}:${kind}`;
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });
    if (claimed.has(key)) return res.status(409).json({ error: "vulnerability already claimed" });
    const session = nonces.get(key);
    if (!session || session.nonce !== nonce) return res.status(403).json({ error: "bad claim nonce" });
    const payload = await claimPayload(team, session.info, player, kind, proof, nonce, session.expiry);
    if (ethers.verifyTypedData(payload.domain, payload.types, payload.value, req.body?.signature || "") !== player) {
      return res.status(403).json({ error: "bad signature" });
    }
    nonces.delete(key);
    if (!(await validProof(team, session.info, player, kind, proof))) return res.status(403).json({ error: "exploit condition not met" });
    claimed.add(key);
    res.json({ flag: team.flag, vulnerability: kind });
  } catch (error) { next(error); }
});

app.get("/status", (_req, res) => {
  const result = {};
  for (const [teamId, team] of Object.entries(teams)) {
    result[teamId] = {};
    for (const kind of VULNS) {
      result[teamId][kind] = [...claimed].some((key) => key.startsWith(`${team.rpc}:`) && key.endsWith(`:${kind}`));
    }
  }
  res.json(result);
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

app.listen(PORT, "0.0.0.0", () => console.log(`attack verifier listening on ${PORT}`));
