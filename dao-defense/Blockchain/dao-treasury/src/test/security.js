const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CLAIM_TYPES } = require("../gateway/server");

const source = fs.readFileSync(path.join(__dirname, "..", "gateway", "server.js"), "utf8");
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

assert.deepEqual(CLAIM_TYPES.Claim.map((field) => field.name), [
  "player", "kind", "proof", "nonce", "expiry", "flagEpoch",
]);
assert.match(source, /claimed = new Set\(\)/);
assert.match(source, /verifyTypedData/);
assert.doesNotMatch(source, /verifyMessage/);
assert.match(source, /system = await deploySystem/);
assert.match(source, /system\.reset\(\)/);
assert.match(source, /system\.fund\(/);
assert.match(solidity, /GovernorTimelockControlUpgradeable/);
assert.match(solidity, /TimelockController/);
assert.match(solidity, /function liquidate\(/);
assert.match(solidity, /function claim\(/);
assert.match(solidity, /function withdraw\(/);
assert.match(solidity, /function rebalance\(/);
assert.match(solidity, /function proposeBatch\(/);

console.log("security: EIP-712, independent claims, persistent proxy service and OpenZeppelin timelock are present");
