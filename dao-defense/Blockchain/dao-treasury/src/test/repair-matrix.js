const assert = require("node:assert/strict");
const { compileContracts } = require("../lib/compiler");

const repairs = {
  oracle: (source) => source.replace(
    'Position storage p = positions[user];\n        if (!p.open) revert LendingVault__PositionClosed();',
    'Position storage p = positions[user];\n        if (!p.open) revert LendingVault__PositionClosed();\n        if (collateralEpoch != debtEpoch) revert LendingVault__EpochMismatch();',
  ),
  gauge: (source) => source
    .replace("mapping(address => uint256) public rewardDebt;", "mapping(address => uint256) public rewardDebt; mapping(address => uint256) public legacyBalance;")
    .replace("if (msg.sender != address(staking)) revert LegacyGauge__NotStaking();\n        rewardDebt[user] = newBalance * rewardPerToken / 1 ether;", "if (msg.sender != address(staking)) revert LegacyGauge__NotStaking();\n        legacyBalance[user] = newBalance;\n        rewardDebt[user] = newBalance * rewardPerToken / 1 ether;")
    .replace("uint256 accrued = staking.balanceOf(msg.sender) * rewardPerToken / 1 ether;", "uint256 accrued = legacyBalance[msg.sender] * rewardPerToken / 1 ether;"),
  batch: (source) => source
    .replace("bool critical;\n        address[] memory targets", "bool critical; uint256 aggregate;\n        address[] memory targets")
    .replace("if (value[i] > perActionCritical) {\n                critical = true;\n            }", "if (value[i] > perActionCritical) {\n                critical = true;\n            }\n            aggregate += value[i];")
    .replace("string memory description =", "if (aggregate > perActionCritical) critical = true;\n        string memory description ="),
  ghost: (source) => source.replace("if (!ok) {\n            return false;\n        }", "ok; // observer failure cannot skip accounting"),
  sandwich: (source) => source.replace(
    "uint256 quoted = ConstantProductAMM(amm).quote(rebalanceToken, amount);\n        uint256 minOut = quoted * 95 / 100;",
    "uint256 minOut = amount * 90 / 100; // independent 1:1 settlement policy",
  ),
};

const required = {
  LendingVault: "liquidate",
  LegacyGauge: "claim",
  RiskGovernor: "proposeBatch",
  GovStakingVault: "withdraw",
  Treasury: "rebalance",
};

function validate(name, transforms) {
  // Each repair's target is unique to one contract file; applying it to every
  // file is safe (String.replace is a no-op where the target isn't present).
  const artifacts = compileContracts((source) =>
    transforms.reduce((result, transform) => transform(result), source),
  );
  for (const [contract, fn] of Object.entries(required)) {
    assert(artifacts[contract].abi.some((item) => item.type === "function" && item.name === fn), `${name}: missing ${contract}.${fn}`);
  }
  return artifacts;
}

async function main() {
  for (const [name, repair] of Object.entries(repairs)) validate(name, [repair]);
  const fullyRepaired = validate("fully-repaired", Object.values(repairs));
  await require("./integration").runIntegration(fullyRepaired);
  console.log("repair matrix: five single repairs compile and the fully repaired build passes functionality");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { repairs, required };
