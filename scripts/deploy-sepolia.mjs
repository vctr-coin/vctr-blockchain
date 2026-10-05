import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits, getAddress } from "ethers";

const root = process.cwd();

function readLocalEnv(key) {
  if (process.env[key]) return process.env[key];
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return undefined;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match?.[1] === key) return match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

const networkConfigs = {
  "base-sepolia": {
    name: "Base Sepolia",
    chainId: 84532n,
    rpcEnv: "BASE_SEPOLIA_RPC",
    rpcDefault: "https://sepolia.base.org",
    confirmation: "DEPLOY TO BASE SEPOLIA",
    reportFile: "base-sepolia.json",
  },
  "ethereum-sepolia": {
    name: "Ethereum Sepolia",
    chainId: 11155111n,
    rpcEnv: "ETHEREUM_SEPOLIA_RPC",
    rpcDefault: "https://ethereum-sepolia-rpc.publicnode.com",
    confirmation: "DEPLOY TO ETHEREUM SEPOLIA",
    reportFile: "ethereum-sepolia.json",
  },
};
const networkKey = readLocalEnv("DEPLOY_NETWORK") || "base-sepolia";
const targetNetwork = networkConfigs[networkKey];
if (!targetNetwork) {
  throw new Error('DEPLOY_NETWORK must be "base-sepolia" or "ethereum-sepolia".');
}

function getDraftAddresses(spec) {
  const rows = Object.fromEntries(spec.allocations.map((row) => [row.name, row]));
  const raw = [
    rows.Liquidity.destination_wallet,
    rows["Direct sales"].destination_wallet,
    rows["Community and ecosystem"].destination_wallet,
    rows["Project treasury"].destination_wallet,
    rows["Social causes"].destination_wallet,
    rows["Founder lock"].beneficiary_wallet,
  ];
  const labels = [
    "Liquidity Reserve",
    "Seller",
    "Community and Ecosystem",
    "Project Treasury",
    "Social Causes",
    "Founder Beneficiary",
  ];
  const checksummed = raw.map((address, index) => {
    try {
      return getAddress(address);
    } catch {
      throw new Error(`${labels[index]} address is missing or has an invalid checksum in config/tokenomics.json.`);
    }
  });
  if (new Set(checksummed).size !== checksummed.length) {
    throw new Error("Recipient addresses must be distinct.");
  }
  return { labels, addresses: checksummed };
}

const rl = createInterface({ input: stdin, output: stdout });
try {
  const spec = JSON.parse(fs.readFileSync(path.join(root, "config/tokenomics.json"), "utf8"));
  const { labels, addresses } = getDraftAddresses(spec);
  const rpcUrl =
    readLocalEnv(targetNetwork.rpcEnv) ||
    (networkKey === "base-sepolia" ? readLocalEnv("RPC_URL") : undefined) ||
    targetNetwork.rpcDefault;
  const provider = new JsonRpcProvider(rpcUrl, Number(targetNetwork.chainId), { staticNetwork: true });
  const network = await provider.getNetwork();
  if (network.chainId !== targetNetwork.chainId) {
    throw new Error(`Wrong chain: expected ${targetNetwork.name} (${targetNetwork.chainId}), received ${network.chainId}.`);
  }

  process.stdout.write(`${targetNetwork.name} only (chain ID ${targetNetwork.chainId}). This publishes a test deployment and spends test ETH.\n`);
  process.stdout.write("Verify these recipient addresses in MetaMask before continuing:\n");
  labels.forEach((label, index) => process.stdout.write(`  ${label}: ${addresses[index]}\n`));
  const addressConfirmation = await rl.question('Type "ADDRESSES VERIFIED" to continue: ');
  if (addressConfirmation !== "ADDRESSES VERIFIED") throw new Error("Address confirmation did not match; stopped without sending.");

  await import("./compile.mjs");
  const artifactPath = path.join(root, "artifacts/solc/VCTRToken.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const privateKey = readLocalEnv("DEPLOYER_PRIVATE_KEY");
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("Set DEPLOYER_PRIVATE_KEY in the ignored local .env using a dedicated Sepolia-only deployer account.");
  }
  const deployer = new Wallet(privateKey, provider);
  const deployerBalance = await provider.getBalance(deployer.address);
  process.stdout.write(`Deployer: ${deployer.address}\nTest ETH available: ${formatEther(deployerBalance)}\n`);

  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, deployer);
  const deployTransaction = await factory.getDeployTransaction(...addresses);
  const estimatedGas = await provider.estimateGas({ ...deployTransaction, from: deployer.address });
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maxFeePerGas === null) throw new Error("Could not estimate Sepolia gas price.");
  const estimatedCost = estimatedGas * maxFeePerGas;
  if (deployerBalance < estimatedCost) {
    throw new Error(`Insufficient test ETH. Estimated deployment cost: ${formatEther(estimatedCost)} test ETH.`);
  }
  process.stdout.write(`Estimated gas: ${estimatedGas}\nEstimated cost: ${formatEther(estimatedCost)} test ETH\n`);
  const sendConfirmation = await rl.question(`Type "${targetNetwork.confirmation}" to submit this test transaction: `);
  if (sendConfirmation !== targetNetwork.confirmation) throw new Error("Deployment confirmation did not match; stopped without sending.");

  const token = await factory.deploy(...addresses, {
    gasLimit: estimatedGas * 120n / 100n,
  });
  const receipt = await token.deploymentTransaction().wait(1);
  const tokenAddress = await token.getAddress();
  const vestingAddress = await token.founderVesting();
  const allocationLockAbi = [
    "function beneficiary() view returns (address)",
    "function unlockTimestamp() view returns (uint64)",
    "function allocation() view returns (uint256)",
  ];
  const allocationLockRefs = [
    ["Community and Ecosystem", await token.communityTimelock()],
    ["Project Treasury", await token.treasuryTimelock()],
    ["Social Causes", await token.socialCausesTimelock()],
  ];
  const allocationLocks = {};
  for (const [label, address] of allocationLockRefs) {
    const lock = new Contract(address, allocationLockAbi, provider);
    const unlockTimestamp = Number(await lock.unlockTimestamp());
    allocationLocks[label] = {
      contract_address: address,
      beneficiary: await lock.beneficiary(),
      amount_tokens: formatUnits(await lock.allocation(), 18),
      unlock_timestamp: unlockTimestamp,
      unlock_date_utc: new Date(unlockTimestamp * 1000).toISOString(),
    };
  }
  const vesting = new Contract(
    vestingAddress,
    [
      "function startTimestamp() view returns (uint64)",
      "function beneficiary() view returns (address)",
    ],
    provider,
  );
  const startTimestamp = Number(await vesting.startTimestamp());
  const report = {
    network: targetNetwork.name,
    chain_id: Number(targetNetwork.chainId),
    token_address: tokenAddress,
    vesting_contract_address: vestingAddress,
    founder_beneficiary: await vesting.beneficiary(),
    start_timestamp: startTimestamp,
    start_date_utc: new Date(startTimestamp * 1000).toISOString(),
    allocation_locks: allocationLocks,
    deployer: deployer.address,
    transaction_hash: receipt.hash,
    recipients: Object.fromEntries(labels.map((label, index) => [label, addresses[index]])),
    note: "Testnet deployment only. Addresses and tokens have no production effect or real value.",
  };
  const reportDirectory = path.join(root, "deployments");
  fs.mkdirSync(reportDirectory, { recursive: true });
  const reportPath = path.join(reportDirectory, targetNetwork.reportFile);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  process.stdout.write(`\n${targetNetwork.name} test deployment confirmed in block ${receipt.blockNumber}.\n`);
  process.stdout.write(`Token: ${tokenAddress}\nFounder vesting: ${vestingAddress}\nReport: ${reportPath}\n`);
  for (const [label, lock] of Object.entries(allocationLocks)) {
    process.stdout.write(`${label} lock: ${lock.contract_address} (unlocks ${lock.unlock_date_utc})\n`);
  }
} finally {
  rl.close();
}
