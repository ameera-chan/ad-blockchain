const fs = require("node:fs");
const path = require("node:path");
const { compileContracts } = require("../lib/compiler");

const root = path.resolve(__dirname, "..");
const player = path.join(root, "player/dist-ameera-ad-dao/src");
const forge = path.join(root, "forge-test-directory");
const contractDirs = ["interfaces", "supporting", "patchable"];
const playerFiles = new Set();

for (const dir of contractDirs) {
  fs.mkdirSync(path.join(forge, "src", dir), { recursive: true });
  const names = fs.readdirSync(path.join(root, "contracts", dir))
    .filter((name) => name.endsWith(".sol"));

  for (const existing of fs.readdirSync(path.join(forge, "src", dir))) {
    if (existing.endsWith(".sol") && !names.includes(existing)) {
      fs.rmSync(path.join(forge, "src", dir, existing));
    }
  }

  for (const name of names) {
    if (!name.endsWith(".sol")) continue;
    playerFiles.add(name);
    const source = fs.readFileSync(path.join(root, "contracts", dir, name), "utf8");
    const playerSource = source.replace(/\.\.\/(?:interfaces|supporting|patchable)\//g, "./");
    fs.writeFileSync(path.join(player, name), playerSource);
    fs.writeFileSync(path.join(forge, "src", dir, name), source);
  }
}

for (const existing of fs.readdirSync(player)) {
  if (existing.endsWith(".sol") && !playerFiles.has(existing)) {
    fs.rmSync(path.join(player, existing));
  }
}

const probeSource = fs.readFileSync(path.join(forge, "test/Probes.t.sol"), "utf8")
  .replace(/"\.\.\/src\//g, '"../');
const probes = compileContracts(undefined, {
  "test/Probes.sol": { content: probeSource },
});
const names = ["LendingProbe", "RewardProbe", "VoteProbe", "TreasuryProbe", "GovernanceProbe"];
fs.writeFileSync(path.join(root, "../checker/probes.json"), JSON.stringify(
  Object.fromEntries(names.map((name) => [name, probes[name].bytecode]))
));
console.log("Player sources, Forge sources, and checker probes synchronized.");
