import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Contract, Interface, JsonRpcProvider, formatUnits, getAddress } from "ethers";

const root = process.cwd();
const chainIdRequired = 11155111n;
const unit = 10n ** 18n;
const report = JSON.parse(fs.readFileSync(path.join(root, "deployments/ethereum-sepolia.json"), "utf8"));
const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts/solc/VCTRToken.json"), "utf8"));
const rpcUrl = process.env.ETHEREUM_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const provider = new JsonRpcProvider(rpcUrl, Number(chainIdRequired), { staticNetwork: true });

try {
  const network = await provider.getNetwork();
  assert.equal(network.chainId, chainIdRequired, "RPC must be Ethereum Sepolia");
  assert.equal(report.chain_id, Number(chainIdRequired));
  const receipt = await provider.getTransactionReceipt(report.transaction_hash);
  assert.ok(receipt, "deployment transaction must be confirmed");
  assert.equal(receipt.status, 1, "deployment transaction must have succeeded");
  assert.equal(getAddress(receipt.contractAddress), getAddress(report.token_address));
  const deploymentBlock = await provider.getBlock(receipt.blockNumber);
  assert.ok(deploymentBlock);
  assert.equal(Number(deploymentBlock.timestamp), report.start_timestamp);

  const tokenCode = await provider.getCode(report.token_address);
  assert.notEqual(tokenCode, "0x", "token bytecode must exist");
  const token = new Contract(report.token_address, artifact.abi, provider);
  assert.equal(await token.name(), "VCTR AI Token");
  assert.equal(await token.symbol(), "VCTR");
  assert.equal(await token.decimals(), 18n);
  assert.equal(await token.totalSupply(), 10_000_000_000n * unit);

  const forbiddenFunctions = ["owner", "mint", "pause", "upgradeTo"];
  const functionNames = artifact.abi.filter((item) => item.type === "function").map((item) => item.name);
  for (const name of forbiddenFunctions) assert.ok(!functionNames.includes(name), `${name} must not exist`);

  const lockAbi = [
    "function beneficiary() view returns (address)",
    "function unlockTimestamp() view returns (uint64)",
    "function allocation() view returns (uint256)",
    "function released() view returns (bool)",
    "function release()",
  ];
  const allocations = [
    ["Liquidity Reserve", report.recipients["Liquidity Reserve"], 1_000_000_000n * unit],
    ["Seller", report.recipients.Seller, 3_000_000_000n * unit],
    ["Founder Vesting", report.vesting_contract_address, 3_000_000_000n * unit],
    ["Community and Ecosystem", report.allocation_locks["Community and Ecosystem"].contract_address, 500_000_000n * unit],
    ["Project Treasury", report.allocation_locks["Project Treasury"].contract_address, 1_000_000_000n * unit],
    ["Social Causes", report.allocation_locks["Social Causes"].contract_address, 1_500_000_000n * unit],
  ];
  for (const [label, address, expected] of allocations) {
    assert.equal(await token.balanceOf(address), expected, `${label} allocation mismatch`);
  }

  const founderAbi = [
    "function token() view returns (address)",
    "function beneficiary() view returns (address)",
    "function startTimestamp() view returns (uint64)",
    "function released() view returns (uint256)",
    "function vestedAmount(uint64) view returns (uint256)",
    "function release() returns (uint256)",
  ];
  const vesting = new Contract(report.vesting_contract_address, founderAbi, provider);
  assert.notEqual(await provider.getCode(report.vesting_contract_address), "0x", "founder vesting bytecode must exist");
  assert.equal(getAddress(await vesting.token()), getAddress(report.token_address));
  assert.equal(getAddress(await vesting.beneficiary()), getAddress(report.founder_beneficiary));
  assert.equal(Number(await vesting.startTimestamp()), report.start_timestamp);
  assert.equal(await vesting.released(), 0n);
  const cliffTimestamp = BigInt(report.start_timestamp) + 15n * 365n * 24n * 60n * 60n;
  assert.equal(await vesting.vestedAmount(cliffTimestamp), 0n);
  await assert.rejects(() => vesting.release.staticCall({ from: report.founder_beneficiary }));

  const lockRows = Object.entries(report.allocation_locks);
  for (const [label, lockInfo] of lockRows) {
    assert.notEqual(await provider.getCode(lockInfo.contract_address), "0x", `${label} lock bytecode must exist`);
    const lock = new Contract(lockInfo.contract_address, lockAbi, provider);
    const expectedBeneficiary = report.recipients[label];
    assert.equal(getAddress(await lock.beneficiary()), getAddress(expectedBeneficiary));
    assert.equal(Number(await lock.unlockTimestamp()), report.start_timestamp + 3 * 365 * 24 * 60 * 60);
    assert.equal(await lock.released(), false);
    await assert.rejects(() => lock.release.staticCall({ from: expectedBeneficiary }));
  }

  const recipient = report.founder_beneficiary;
  const iface = new Interface(artifact.abi);
  await assert.rejects(() => provider.call({
    from: report.recipients.Seller,
    to: report.token_address,
    data: iface.encodeFunctionData("transfer", [recipient, 0n]),
  }));
  const positiveSimulation = await provider.call({
    from: report.recipients.Seller,
    to: report.token_address,
    data: iface.encodeFunctionData("transfer", [recipient, 1n]),
  });
  assert.equal(iface.decodeFunctionResult("transfer", positiveSimulation)[0], true);
  assert.equal(await token.balanceOf(report.recipients.Seller), 3_000_000_000n * unit, "eth_call must not alter state");
  assert.equal(await token.balanceOf(recipient), 0n, "eth_call must not alter state");

  process.stdout.write(`PASS: Ethereum Sepolia chain ID ${network.chainId}; deployment receipt ${receipt.hash} in block ${receipt.blockNumber}.\n`);
  process.stdout.write(`PASS: VCTR AI Token (${await token.symbol()}, ${await token.decimals()} decimals) has exactly ${formatUnits(await token.totalSupply(), 18)} tokens.\n`);
  process.stdout.write("PASS: all six allocations and the four immutable vesting/timelock contracts match the deployment report.\n");
  process.stdout.write("PASS: founder cliff and all three-year locks reject premature release calls.\n");
  process.stdout.write("PASS: zero-value transfer reverts; a 1-wei transfer simulation succeeds; simulations did not change chain state.\n");
  process.stdout.write("PASS: no owner, mint, pause, or upgrade entry points are present.\n");
} finally {
  await provider.destroy();
}
