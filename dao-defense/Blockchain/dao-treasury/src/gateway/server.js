const crypto = require("node:crypto");
const fs = require("node:fs");
const express = require("express");
const { ethers } = require("ethers");
const { compileContracts } = require("../lib/compiler");
const { deploySystem } = require("../scripts/deploy");

const PORT = Number(process.env.PORT || 8080);
const FLAG_PATH = process.env.GZCTF_FLAG_FILE || "/flag";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const MNEMONIC = process.env.MNEMONIC || undefined; // optional; random if unset
const UPGRADE_KEY = process.env.GZCTF_UPGRADE_KEY || undefined; // team-owned upgrade authority

const app = express();
app.use(express.json({ limit: "512kb" }));
// CORS — allow the organizer dashboard (any origin) to read /info + /status.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const RPC_ALLOWLIST = new Set([
  "web3_clientVersion", "net_version", "eth_chainId", "eth_blockNumber", "eth_getBalance",
  "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs", "eth_sendRawTransaction", "eth_getStorageAt",
]);

const VULNS = ["oracle", "gauge", "batch", "ghost", "sandwich"];

let system = null;
let artifacts = null;
let flagFingerprint = null;
let nonces = new Map();   // `${player}:${kind}` -> { nonce, expiry }
let claimed = new Set();  // `${player}:${kind}`

function currentFlag() {
  try { return fs.readFileSync(FLAG_PATH, "utf8").trim(); }
  catch { return (process.env.GZCTF_FLAG || "flag{local-development}").trim(); }
}
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

function claimPayload(player, kind, proof, nonce, expiry) {
  return {
    domain: {
      name: "DAO Defense Claim",
      version: "1",
      chainId: system.chainId,
      verifyingContract: system._addresses.treasury,
    },
    types: CLAIM_TYPES,
    value: {
      player,
      kind: ethers.id(kind),
      proof,
      nonce,
      expiry,
      flagEpoch: `0x${flagFingerprint}`,
    },
  };
}

async function validProof(player, kind, proof) {
  const a = artifacts;
  const c = system._addresses;
  const provider = system.provider;
  const contract = (address, artifact) => new ethers.Contract(address, artifact.abi, provider);
  if (kind === "oracle") return (await contract(c.collateral, a.Token).balanceOf(player)) >= ethers.parseEther("100");
  if (kind === "gauge") return (await contract(c.reward, a.Token).balanceOf(player)) >= ethers.parseEther("500");
  if (kind === "batch") return (await contract(c.treasuryAsset, a.Token).balanceOf(player)) >= ethers.parseEther("1000");
  if (kind === "sandwich") return (await contract(c.marketAsset, a.Token).balanceOf(player)) > ethers.parseEther("205");
  if (kind === "ghost") {
    const probe = ethers.getAddress(proof);
    const owner = await contract(probe, a.DelegateProbe).owner();
    const votes = await contract(c.mirror, a.VoteMirror).votes(probe);
    const stake = await contract(c.vault, a.GovStakingVault).staked(player);
    return owner === player && votes >= ethers.parseEther("450") && stake === 0n;
  }
  return false;
}

function publicInfo() {
  return {
    chainId: system.chainId,
    rpcUrl: "/rpc",
    contracts: system._addresses,
    victim: system.victim,
    vulnerabilities: VULNS,
    upgradeAddress: system.upgradeAddress,
  };
}

app.get("/health", (_req, res) => res.type("text/plain").send("ok"));
app.get("/artifact/:name", (req, res) => {
  const artifact = artifacts[req.params.name];
  if (!artifact) return res.status(404).json({ error: "unknown artifact" });
  res.json({ abi: artifact.abi, bytecode: artifact.bytecode });
});
app.get("/info", (_req, res) => res.json(publicInfo()));

// Which vulnerabilities have been exploited (claimed) on this team's chain.
app.get("/status", (_req, res) => {
  const exploited = {};
  for (const kind of VULNS) {
    exploited[kind] = [...claimed].some((key) => key.endsWith(":" + kind));
  }
  res.json({ exploited });
});

// Gas + exploit-token faucet (rate-limited once per address per flag epoch).
app.post("/faucet", async (req, res, next) => {
  try {
    const player = ethers.getAddress(req.body?.player || "");
    const did = await system.fund(player);
    res.json({ funded: did, player });
  } catch (error) { next(error); }
});

// Single JSON-RPC relay into the persistent team chain (allowlisted).
async function rpcOne(request) {
  const id = request?.id ?? null;
  if (!request || request.jsonrpc !== "2.0" || !RPC_ALLOWLIST.has(request.method)) {
    return { jsonrpc: "2.0", id, error: { code: -32601, message: "RPC method disabled" } };
  }
  try {
    const result = await system.eip1193.request({ method: request.method, params: request.params || [] });
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    return { jsonrpc: "2.0", id, error: { code: error.code || -32000, message: error.shortMessage || error.message } };
  }
}
app.post("/rpc", async (req, res, next) => {
  try {
    const reply = Array.isArray(req.body)
      ? await Promise.all(req.body.map((item) => rpcOne(item)))
      : await rpcOne(req.body);
    res.json(reply);
  } catch (error) { next(error); }
});

app.get("/claim-challenge", (req, res, next) => {
  try {
    const player = ethers.getAddress(req.query.player || "");
    const kind = String(req.query.kind || "");
    const proof = ethers.getAddress(req.query.proof || ethers.ZeroAddress);
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });
    const nonce = `0x${crypto.randomBytes(32).toString("hex")}`;
    const expiry = Math.floor(Date.now() / 1000) + 300;
    nonces.set(`${player}:${kind}`, { nonce, expiry });
    res.json(claimPayload(player, kind, proof, nonce, expiry));
  } catch (error) { next(error); }
});

app.post("/claim", async (req, res, next) => {
  try {
    const kind = String(req.body?.kind || "");
    const player = ethers.getAddress(req.body?.player || "");
    const proof = ethers.getAddress(req.body?.proof || ethers.ZeroAddress);
    const nonce = String(req.body?.nonce || "");
    const key = `${player}:${kind}`;
    if (!VULNS.includes(kind)) return res.status(400).json({ error: "unknown vulnerability" });
    if (claimed.has(key)) return res.status(409).json({ error: "vulnerability already claimed" });
    const session = nonces.get(key);
    if (!session || session.nonce !== nonce) return res.status(403).json({ error: "bad claim nonce" });
    const payload = claimPayload(player, kind, proof, nonce, session.expiry);
    if (ethers.verifyTypedData(payload.domain, payload.types, payload.value, req.body?.signature || "") !== player) {
      return res.status(403).json({ error: "bad signature" });
    }
    nonces.delete(key);
    if (!(await validProof(player, kind, proof))) return res.status(403).json({ error: "exploit condition not met" });
    claimed.add(key);
    res.json({ flag: currentFlag(), vulnerability: kind });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

// Flag-rotation watcher: on a new flag, re-seed state + re-arm claims/faucet.
if (require.main === module) {
  setInterval(async () => {
    if (!system) return;
    const fp = fingerprint(currentFlag());
    if (fp !== flagFingerprint) {
      flagFingerprint = fp;
      nonces = new Map();
      claimed = new Set();
      try { await system.reset(); system.resetFunding(); } catch (error) { console.error("reset failed", error); }
    }
  }, 5000).unref();
}

async function boot() {
  artifacts = compileContracts();
  system = await deploySystem(artifacts, { chainId: CHAIN_ID, mnemonic: MNEMONIC, upgradeKey: UPGRADE_KEY });
  flagFingerprint = fingerprint(currentFlag());
  console.log(`[upgrade] team upgrade wallet: ${system.upgradeAddress}`);
  console.log(`[upgrade] team upgrade key:    ${system.upgradeKey}`);
}

if (require.main === module) {
  boot()
    .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`dao-defense listening on ${PORT}`)))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { app, CLAIM_TYPES, claimPayload, boot, publicInfo };
