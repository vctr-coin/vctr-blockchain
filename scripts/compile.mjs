import fs from "node:fs";
import path from "node:path";
import solc from "solc";

const root = process.cwd();
const sourceFiles = [
  "contracts/VCTRToken.sol",
  "contracts/FounderVesting.sol",
  "contracts/AllocationTimelock.sol",
];
const sources = Object.fromEntries(
  sourceFiles.map((file) => [file, { content: fs.readFileSync(path.join(root, file), "utf8") }]),
);

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(
  solc.compile(JSON.stringify(input), {
    import(importPath) {
      const sourcePath = path.join(root, "node_modules", importPath);
      if (!fs.existsSync(sourcePath)) return { error: `Import not found: ${importPath}` };
      return { contents: fs.readFileSync(sourcePath, "utf8") };
    },
  }),
);

const errors = (output.errors ?? []).filter((item) => item.severity === "error");
for (const warning of (output.errors ?? []).filter((item) => item.severity !== "error")) {
  process.stderr.write(warning.formattedMessage);
}
if (errors.length) {
  for (const error of errors) process.stderr.write(error.formattedMessage);
  process.exitCode = 1;
} else {
  const outputDirectory = path.join(root, "artifacts", "solc");
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [sourceName, contracts] of Object.entries(output.contracts)) {
    for (const [contractName, artifact] of Object.entries(contracts)) {
      fs.writeFileSync(
        path.join(outputDirectory, `${contractName}.json`),
        `${JSON.stringify({ contractName, sourceName, ...artifact }, null, 2)}\n`,
      );
    }
  }
  process.stdout.write(`Compiled with solc ${solc.version()} for Shanghai EVM.\n`);
}
