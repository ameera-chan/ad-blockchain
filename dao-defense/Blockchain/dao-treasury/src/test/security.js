const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "gateway", "server.js"), "utf8");
const verifierSource = fs.readFileSync(path.join(__dirname, "..", "..", "verifier", "server.js"), "utf8");
const verifierChecks = fs.readFileSync(path.join(__dirname, "..", "..", "verifier", "checks.js"), "utf8");
const contractsDir = path.join(__dirname, "..", "contracts");
const readAll = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readAll(full, out);
    else if (entry.name.endsWith(".sol")) out.push(fs.readFileSync(full, "utf8"));
  }
  return out;
};
const solidity = readAll(contractsDir).join("\n");

// The team's service must be flag-free: exploit verification + flag release
// belong to the organizer-side verifier, not to the self-hosted service.
assert.doesNotMatch(source, /res\.json\(\{\s*flag:/);
assert.match(source, /system = await deploySystem/);
assert.match(source, /system\.reset\(\)/);
assert.match(source, /system\.fund\(/);

// The organizer verifier owns EIP-712 claims + on-chain exploit verification.
assert.match(verifierSource, /verifyTypedData/);
assert.match(verifierChecks, /validProof/);
assert.match(verifierChecks, /eth_call/);

// Solidity surface is intact.
assert.match(solidity, /GovernorTimelockControlUpgradeable/);
assert.match(solidity, /TimelockController/);
assert.match(solidity, /function liquidate\(/);
assert.match(solidity, /function claim\(/);
assert.match(solidity, /function withdraw\(/);
assert.match(solidity, /function rebalance\(/);
assert.match(solidity, /function proposeBatch\(/);

console.log("security: team service is flag-free; verifier owns EIP-712 claims + exploit verification; OZ timelock present");
