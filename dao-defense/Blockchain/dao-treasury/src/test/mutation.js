const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const contractsDir = path.join(__dirname, "..", "contracts");
const readAll = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) readAll(full, out);
    else if (entry.name.endsWith(".sol")) out.push(fs.readFileSync(full, "utf8"));
  }
  return out;
};
const source = readAll(contractsDir).join("\n");

function functionalityGuard(candidate) {
  const rejected = [
    /function withdraw\([^)]*\)[^{]*\{\s*revert/,
    /function rebalance\([^)]*\)[^{]*\{[^}]*require\(msg\.sender == owner/,
    /function liquidate\([^)]*\)[^{]*\{\s*revert/,
    /function claim\([^)]*\)[^{]*\{\s*revert/,
    /bool critical\s*=\s*true/,
  ];
  return rejected.every((pattern) => !pattern.test(candidate));
}

assert.equal(functionalityGuard(source), true);
const mutations = [
  source.replace("function withdraw(uint256 amount) external {", "function withdraw(uint256 amount) external { revert(\"disabled\");"),
  source.replace("function rebalance(uint256 amount) external returns (uint256 out) {", "function rebalance(uint256 amount) external returns (uint256 out) { require(msg.sender == owner);"),
  source.replace("function liquidate(address user, uint256 collateralEpoch, uint256 debtEpoch) external {", "function liquidate(address user, uint256 collateralEpoch, uint256 debtEpoch) external { revert(\"disabled\");"),
  source.replace("function claim() external returns (uint256 amount) {", "function claim() external returns (uint256 amount) { revert(\"disabled\");"),
  source.replace("bool critical;", "bool critical = true;"),
];
for (const mutation of mutations) assert.equal(functionalityGuard(mutation), false);
console.log("mutation tests: obvious withdrawal, rebalance, liquidation, claim and governance overpatches rejected");
