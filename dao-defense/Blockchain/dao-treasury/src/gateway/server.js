const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { compileContracts } = require("../lib/compiler");
const { deploySystem } = require("../scripts/deploy");

const PORT = Number(process.env.PORT || 8080);
const FLAG_PATH = process.env.GZCTF_FLAG_FILE || "/flag";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const MNEMONIC = process.env.MNEMONIC || undefined; // optional; random if unset
const UPGRADE_KEY = process.env.GZCTF_UPGRADE_KEY || undefined; // organizer-provisioned override
const UPGRADE_KEY_FILE = process.env.UPGRADE_KEY_FILE || "/data/secrets/upgrade-key";

// The team's upgrade authority. If the organizer provisioned a key via
// GZCTF_UPGRADE_KEY, use it; otherwise generate once and persist it so a
// container restart never destroys the team's defensive authority. The key is
// never logged — teams read it from the mounted volume (or via `daoctl credentials`).
function loadOrCreateUpgradeKey() {
  if (UPGRADE_KEY) return UPGRADE_KEY;
  try {
    const existing = fs.readFileSync(UPGRADE_KEY_FILE, "utf8").trim();
    if (existing) return existing;
  } catch {}
  const key = `0x${crypto.randomBytes(32).toString("hex")}`;
  try {
    fs.mkdirSync(path.dirname(UPGRADE_KEY_FILE), { recursive: true });
    fs.writeFileSync(UPGRADE_KEY_FILE, key, { mode: 0o600 });
  } catch (error) {
    console.error("warning: could not persist upgrade key:", error.message);
  }
  return key;
}

const app = express();
app.use(express.json({ limit: "512kb" }));
// CORS — allow the organizer dashboard (any origin) to read /info.
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
let roundFingerprint = null;

// The flag file is read ONLY as the per-round reset signal. This service never
// releases the flag — exploit verification and flag release live in the
// organizer-side verifier (see ../verifier), outside the team's control.
function currentFlag() {
  try { return fs.readFileSync(FLAG_PATH, "utf8").trim(); }
  catch { return (process.env.GZCTF_FLAG || "flag{local-development}").trim(); }
}
function fingerprint(value) { return crypto.createHash("sha256").update(value).digest("hex"); }

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

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

// Round-reset watcher: on a new flag epoch, re-seed exploitable state + re-arm
// the faucet. Proxies and implementations persist across rounds.
if (require.main === module) {
  setInterval(async () => {
    if (!system) return;
    const fp = fingerprint(currentFlag());
    if (fp !== roundFingerprint) {
      roundFingerprint = fp;
      try { await system.reset(); system.resetFunding(); } catch (error) { console.error("reset failed", error); }
    }
  }, 5000).unref();
}

async function boot() {
  artifacts = compileContracts();
  system = await deploySystem(artifacts, { chainId: CHAIN_ID, mnemonic: MNEMONIC, upgradeKey: loadOrCreateUpgradeKey() });
  roundFingerprint = fingerprint(currentFlag());
  console.log(`[upgrade] team upgrade wallet: ${system.upgradeAddress}`);
}

if (require.main === module) {
  boot()
    .then(() => app.listen(PORT, "0.0.0.0", () => console.log(`dao-defense listening on ${PORT}`)))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { app, boot, publicInfo };
