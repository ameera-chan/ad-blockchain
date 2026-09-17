const fs = require("node:fs");
const path = require("node:path");
const { compileContracts } = require("../lib/compiler");

const root = path.resolve(__dirname, "..");
const player = path.join(root, "player/dist-ameera-ad-dao/src");
for (const dir of ["interfaces", "supporting", "patchable"]) {
  for (const name of fs.readdirSync(path.join(root, "contracts", dir))) {
    if (!name.endsWith(".sol")) continue;
    const source = fs.readFileSync(path.join(root, "contracts", dir, name), "utf8")
      .replace(/\.\.\/(?:interfaces|supporting|patchable)\//g, "./");
    fs.writeFileSync(path.join(player, name), source);
  }
}
const probes = compileContracts(undefined, {
  "test/Probes.sol": { content: fs.readFileSync(path.join(root, "test/Probes.sol"), "utf8") },
});
const names = ["LendingProbe", "RewardProbe", "VoteProbe", "TreasuryProbe", "GovernanceProbe"];
fs.writeFileSync(path.join(root, "../checker/probes.json"), JSON.stringify(
  Object.fromEntries(names.map((name) => [name, probes[name].bytecode]))
));
console.log("Player sources and checker probes synchronized.");
