// =============================================================================
// The Gateway
// GZCTF only launches this container.
// =============================================================================

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { ethers } = require("ethers");
const { compileContracts } = require("../lib/compiler");
const { deploySystem } = require("../scripts/deploy");
const rateLimit = require("express-rate-limit");
const MAX_RPC_BATCH = 20;
const PORT = Number(process.env.PORT || 8080);
const FLAG_PATH = process.env.GZCTF_FLAG_FILE || "/flag";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const MNEMONIC_FILE = process.env.MNEMONIC_FILE || "/data/secrets/mnemonic";
const PRIVATE_CREDENTIALS_DIR = process.env.PRIVATE_CREDENTIALS_DIR || "/data/private";
const UPGRADE_KEY_FILE = process.env.UPGRADE_KEY_FILE || path.join(PRIVATE_CREDENTIALS_DIR, "UPGRADE_KEY");
const LEGACY_UPGRADE_KEY_FILE = "/data/secrets/upgrade-key";
const LEGACY_TEAM_CREDENTIALS_FILE = "/data/team-credentials";
const ANVIL_HOST = process.env.ANVIL_HOST || "127.0.0.1";
const ANVIL_PORT = Number(process.env.ANVIL_PORT || 8545);
const ANVIL_STATE = process.env.ANVIL_STATE || "/data/anvil-state.json";
const CLAIMS_FILE = process.env.CLAIMS_FILE || "/data/secrets/claims.json";
const MIN_WALLET_ETH = ethers.parseEther("0.01");

// ----------------------------------------------------------------------------
// Secrets: upgrade key, mnemonic, anvil state
// ----------------------------------------------------------------------------

function loadOrCreateUpgradeKey() {
  try {
    const existing = fs.readFileSync(UPGRADE_KEY_FILE, "utf8").trim();
    if (existing) return existing;
  } catch { }

  const key = `0x${crypto.randomBytes(32).toString("hex")}`;

  fs.mkdirSync(path.dirname(UPGRADE_KEY_FILE), { recursive: true });
  fs.writeFileSync(UPGRADE_KEY_FILE, key, { mode: 0o600 });

  return key;
}

function loadOrCreateMnemonic() {
  try {
    const existing = fs.readFileSync(MNEMONIC_FILE, "utf8").trim();
    if (existing) return existing;
  } catch { }

  const mnemonic = ethers.Mnemonic.entropyToPhrase(crypto.randomBytes(16));

  fs.mkdirSync(path.dirname(MNEMONIC_FILE), { recursive: true });
  fs.writeFileSync(MNEMONIC_FILE, mnemonic, { mode: 0o600 });

  return mnemonic;
}

function effectiveStateFile() {
  fs.mkdirSync(path.dirname(ANVIL_STATE), { recursive: true });
  return ANVIL_STATE;
}

const app = express();
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.json({ limit: "512kb" }));

app.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.use("/ui", express.static(PUBLIC_DIR, { index: false, maxAge: "1h" }));

const RPC_ALLOWLIST = new Set([
  "web3_clientVersion", "net_version", "eth_chainId", "eth_blockNumber", "eth_getBalance",
  "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_feeHistory",
  "eth_maxPriorityFeePerGas", "eth_getBlockByNumber", "eth_getBlockByHash",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs", "eth_sendRawTransaction", "eth_getStorageAt",
]);

let system = null;
let artifacts = null;
const claimNonces = new Map();
const claimsInFlight = new Set();
let consumedClaims = {};

function currentFlag() {
  try {
    const mounted = fs.readFileSync(FLAG_PATH, "utf8").trim();
    if (mounted) return mounted;
  } catch { }
  const injected = process.env.GZCTF_FLAG?.trim();
  if (!injected) throw new Error("challenge flag not configured");
  return injected;
}

function selfInfo() {
  return {
    rpcUrl: "/rpc",
    playerAddress: system.playerAddress,
    registryContract: system._addresses.registry,
  };
}

function writePrivateCredentials() {
  fs.mkdirSync(PRIVATE_CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(PRIVATE_CREDENTIALS_DIR, 0o700);
  const values = {
    PRIVKEY: system.playerPrivateKey,
    UPGRADE_ADDR: system.upgradeAddress,
  };
  for (const [name, value] of Object.entries(values)) {
    fs.writeFileSync(path.join(PRIVATE_CREDENTIALS_DIR, name), `${value}\n`, { mode: 0o600 });
  }
  for (const file of [LEGACY_UPGRADE_KEY_FILE, LEGACY_TEAM_CREDENTIALS_FILE]) {
    try { fs.rmSync(file, { force: true }); }
    catch (error) { console.error(`warning: could not remove ${file}:`, error.message); }
  }
}

// ----------------------------------------------------------------------------
// HTTP surface.
// ----------------------------------------------------------------------------

app.get("/self-info", (_req, res) => res.json(selfInfo()));
app.get("/health", (_req, res) => res.type("text/plain").send("ok"));
app.get("/status", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ ready: Boolean(system), blockNumber: await system.provider.getBlockNumber() });
  } catch (error) { next(error); }
});

const BALANCE_FIELDS = [
  ["ETH", null, "playerAddress"],
  ["GOV", "gov", "playerAddress"],
  ["DEBT", "debt", "playerAddress"],
  ["LP", "lp", "playerAddress"],
  ["MKT", "marketAsset", "playerAddress"],
];

const RESERVE_FIELDS = [
  ["Treasury TRES", "treasuryAsset", "treasury"],
  ["Treasury MKT", "marketAsset", "treasury"],
  ["Lending collateral", "collateral", "lending"],
  ["Gauge V1 reward", "reward", "rewardGaugeV1"],
  ["AMM market reserve", "marketAsset", "amm"],
  ["AMM settlement reserve", "stable", "amm"],
];

function tokenBalance(token, owner) {
  return callView(system._addresses[token], "Token", "balanceOf", [system._addresses[owner] || system[owner]])
    .then((value) => BigInt(value[0]));
}

async function readBalances() {
  const wallet = {};
  for (const [label, token, owner] of BALANCE_FIELDS) {
    const value = token
      ? await tokenBalance(token, owner)
      : await system.provider.getBalance(system.playerAddress);
    wallet[label] = { wei: value.toString(), formatted: ethers.formatEther(value) };
  }

  const reserves = {};
  for (const [label, token, owner] of RESERVE_FIELDS) {
    const value = await tokenBalance(token, owner);
    reserves[label] = { wei: value.toString(), formatted: ethers.formatEther(value) };
  }
  return { wallet, reserves };
}

function depletionReasons(balances) {
  const reasons = [];
  if (BigInt(balances.wallet.ETH.wei) < MIN_WALLET_ETH) reasons.push("wallet ETH");
  for (const [label, value] of Object.entries(balances.reserves)) {
    if (BigInt(value.wei) === 0n) reasons.push(label);
  }
  return reasons;
}

async function recoveryStatus() {
  const balances = await readBalances();
  const reasons = depletionReasons(balances);
  return {
    address: system.playerAddress,
    balances: balances.wallet,
    depleted: reasons.length > 0,
    automaticRecoverySeconds: null,
    recoverySecondsRemaining: null,
  };
}

app.get("/wallet", async (_req, res, next) => {
  try { res.json(await recoveryStatus()); }
  catch (error) { next(error); }
});

function iface(name) {
  return new ethers.Interface(artifacts[name].abi);
}

async function callView(to, abiName, fn, args = []) {
  const data = iface(abiName).encodeFunctionData(fn, args);
  const raw = await system.eip1193.request({ method: "eth_call", params: [{ to, data }, "latest"] });
  return iface(abiName).decodeFunctionResult(fn, raw);
}

async function readAccountMetrics(player) {
  const a = system._addresses;
  return Promise.all([
    callView(a.collateral, "Token", "transferVolume", [a.lending, player]),
    callView(a.amm, "ConstantProductAMM", "executionVariance", [player]),
    callView(a.reward, "Token", "rewardAdjustment", [player]),
    callView(a.timelock, "DaoTimelock", "distributionRecords", [player]),
  ]).then((values) => values.map((value) => BigInt(value[0])));
}

app.use("/rpc", rateLimit({ windowMs: 60 * 1000, max: 300, message: "RPC rate limit exceeded" }));
app.use("/faucet", rateLimit({ windowMs: 60 * 1000, max: 10, message: "Faucet limit exceeded" }));

app.use("/claim-challenge", rateLimit({ windowMs: 60000, max: 60 }));
app.use("/flag", rateLimit({ windowMs: 60000, max: 60 }));
app.get("/claim-challenge", (req, res, next) => {
  try {
    const player = ethers.getAddress(req.query.player || "");
    const now = Date.now();
    for (const [nonce, claim] of claimNonces) if (claim.expires <= now) claimNonces.delete(nonce);
    if (claimNonces.size >= 1000) return res.status(429).json({ error: "try again later" });
    const nonce = crypto.randomBytes(32).toString("hex");
    const message = `DAO Treasury flag claim\n${system._addresses.registry}\n${player}\n${nonce}`;
    claimNonces.set(nonce, { player, message, expires: now + 60000 });
    res.set("Cache-Control", "no-store").json({ nonce, message });
  } catch (error) { next(error); }
});
app.get("/flag", (_req, res) => res.status(403).json({ error: "signed claim required; see player guide" }));
app.post("/flag", async (req, res, next) => {
  let player;
  try {
    const claim = claimNonces.get(req.body?.nonce);
    if (!claim || claim.expires <= Date.now()) return res.status(403).json({ error: "claim expired" });
    let signer;
    try { signer = ethers.verifyMessage(claim.message, req.body?.signature); }
    catch { return res.status(403).json({ error: "invalid signature" }); }
    if (signer !== claim.player) return res.status(403).json({ error: "wrong signer" });
    player = signer;
    if (claimsInFlight.has(player)) return res.status(429).json({ error: "claim in progress" });
    claimsInFlight.add(player);
    claimNonces.delete(req.body.nonce);
    const metrics = await readAccountMetrics(player);
    const baseline = (consumedClaims[player] || ["0", "0", "0", "0"]).map(BigInt);
    const minimumDelta = [ethers.parseEther("100"), ethers.parseEther("10"), ethers.parseEther("100"), 1n];
    if (!metrics.some((value, i) => value - baseline[i] >= minimumDelta[i])) {
      return res.status(403).json({ error: "no capture evidence for this wallet" });
    }
    const flag = currentFlag();
    const nextClaims = { ...consumedClaims, [player]: metrics.map(String) };
    fs.mkdirSync(path.dirname(CLAIMS_FILE), { recursive: true });
    fs.writeFileSync(`${CLAIMS_FILE}.tmp`, JSON.stringify(nextClaims), { mode: 0o600 });
    fs.renameSync(`${CLAIMS_FILE}.tmp`, CLAIMS_FILE);
    consumedClaims = nextClaims;
    res.set("Cache-Control", "no-store").type("text/plain").send(flag);
  } catch (error) {
    next(error);
  } finally {
    if (player) claimsInFlight.delete(player);
  }
});

app.post("/faucet", async (req, res, next) => {
  try {
    const player = ethers.getAddress(req.body?.player || "");
    const did = await system.fund(player);
    res.json({ funded: did, player });
  } catch (error) { next(error); }
});

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
    const payload = req.body;

    if (Array.isArray(payload) && payload.length > MAX_RPC_BATCH) {
      return res.status(400).json({ error: "RPC batch too large" });
    }

    const reply = Array.isArray(payload)
      ? await Promise.all(payload.map((item) => rpcOne(item)))
      : await rpcOne(payload);

    res.json(reply);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status || (error.code === "INVALID_ARGUMENT" ? 400 : 500);
  res.status(status).json({ error: status === 500 ? "internal service error" : error.message });
});

// ----------------------------------------------------------------------------
// Boot & shutdown.
// ----------------------------------------------------------------------------

async function boot() {
  artifacts = compileContracts();
  system = await deploySystem(artifacts, {
    chainId: CHAIN_ID,
    mnemonic: loadOrCreateMnemonic(),
    upgradeKey: loadOrCreateUpgradeKey(),
    stateFile: effectiveStateFile(),
    host: ANVIL_HOST,
    port: ANVIL_PORT,
  });
  writePrivateCredentials();
  try { consumedClaims = JSON.parse(fs.readFileSync(CLAIMS_FILE, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  console.log(`[anvil] raw rpc on ${ANVIL_HOST}:${system.port} (organizer-only; gateway on :${PORT})`);
}

if (require.main === module) {
  boot()
    .then(() => {
      let refreshing = false;
      setInterval(async () => {
        if (refreshing) return;
        refreshing = true;
        try { await system.refreshOracle(); }
        catch (error) { console.error("oracle refresh failed:", error.message); }
        finally { refreshing = false; }
      }, 60000).unref();
      app.listen(PORT, "0.0.0.0", () => console.log(`dao-defense listening on ${PORT}`));
    })
    .catch((error) => { console.error(error); process.exit(1); });
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("shutdown: persisting anvil state...");
  if (system && system.stop) system.stop();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
