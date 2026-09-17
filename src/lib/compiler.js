const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const solc = require("solc");

let cached;
const precompiledPath = path.join(__dirname, "..", "artifacts.json");

function compileContracts(transform, extraSources = {}) {
  const contractsDir = path.join(__dirname, "..", "contracts");
  const sources = {};
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.name.endsWith(".sol")) sources[rel] = { content: fs.readFileSync(full, "utf8") };
    }
  };
  walk(contractsDir, "");
  Object.assign(sources, extraSources);
  if (transform) {
    for (const [file, source] of Object.entries(sources)) source.content = transform(source.content, file);
  }
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  if (!transform && cached?.sourceHash === sourceHash) return cached.artifacts;
  if (!transform && !cached) {
    try {
      const precompiled = JSON.parse(fs.readFileSync(precompiledPath, "utf8"));
      if (precompiled.sourceHash === sourceHash && precompiled.artifacts) {
        cached = precompiled;
        return cached.artifacts;
      }
    } catch { }
  }
  const input = {
    language: "Solidity",
    sources,
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const findImports = (importPath) => {
    const candidate = path.join(__dirname, "..", "node_modules", importPath);
    try { return { contents: fs.readFileSync(candidate, "utf8") }; }
    catch { return { error: `import not found: ${importPath}` }; }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
  const errors = (output.errors || []).filter((e) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  const artifacts = {};
  for (const unit of Object.values(output.contracts || {})) {
    for (const [name, artifact] of Object.entries(unit)) {
      if (artifact.evm.bytecode.object) {
        artifacts[name] = { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
      }
    }
  }
  if (!transform) cached = { sourceHash, artifacts };
  return artifacts;
}

function writePrecompiledArtifacts() {
  compileContracts();
  fs.writeFileSync(precompiledPath, JSON.stringify(cached));
}

module.exports = { compileContracts, writePrecompiledArtifacts };
