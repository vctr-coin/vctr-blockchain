import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits, getAddress } from "ethers";
import { fixedSaleConstructorArgs, fixedSaleSpec } from "./fixed-sale-config.mjs";

const root = process.cwd();
const expectedSeller = getAddress(fixedSaleSpec.seller);
const expectedVctr = getAddress(fixedSaleSpec.vctrToken);
const expectedUsdc = getAddress(fixedSaleSpec.usdcToken);
const expectedDeployer = getAddress(fixedSaleSpec.expectedDeployer);
const tokenAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const reportPath = path.join(root, "deployments/vctr-fixed-sale-base-mainnet.json");

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

function assertCleanMainnetRelease() {
  let branch;
  let commit;
  let status;
  try {
    branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Deployment requires a Git checkout with a clean, reviewed main-branch release commit.");
  }
  if (branch !== "main") throw new Error(`Refusing deployment from branch '${branch}'; use the reviewed main branch.`);
  if (status) throw new Error("Working tree is not clean; commit and review all release files before deployment.");
  const approved = readLocalEnv("BASE_MAINNET_APPROVED_COMMIT");
  if (!/^[0-9a-f]{40}$/i.test(approved || "") || approved !== commit) {
    throw new Error("BASE_MAINNET_APPROVED_COMMIT must exactly match the full reviewed main-branch commit hash.");
  }
  return commit;
}

const rpcUrl = readLocalEnv("BASE_MAINNET_RPC") || "https://mainnet.base.org";
const provider = new JsonRpcProvider(rpcUrl);
async function assertBaseMainnet() {
  const actualChainId = BigInt(await provider.send("eth_chainId", []));
  if (actualChainId !== fixedSaleSpec.chainId) {
    throw new Error(`Wrong network: expected Base Mainnet (${fixedSaleSpec.chainId}), received ${actualChainId}.`);
  }
  return actualChainId;
}
const chainId = await assertBaseMainnet();

for (const [label, address] of [["VCTR", expectedVctr], ["native Base USDC", expectedUsdc]]) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`${label} has no contract code at the configured Base Mainnet address.`);
}

const vctr = new Contract(expectedVctr, tokenAbi, provider);
const usdc = new Contract(expectedUsdc, tokenAbi, provider);
const [vctrName, vctrSymbol, vctrDecimals, totalSupply, sellerBalance, usdcSymbol, usdcDecimals] = await Promise.all([
  vctr.name(),
  vctr.symbol(),
  vctr.decimals(),
  vctr.totalSupply(),
  vctr.balanceOf(expectedSeller),
  usdc.symbol(),
  usdc.decimals(),
]);
const requiredInventory = fixedSaleSpec.maximumSaleVctr * 10n ** 18n;
if (vctrName !== "VCTR AI Token" || vctrSymbol !== "VCTR" || vctrDecimals !== 18n) {
  throw new Error(`Unexpected VCTR metadata at ${expectedVctr}: ${vctrName}/${vctrSymbol}/${vctrDecimals}.`);
}
if (totalSupply !== 10_000_000_000n * 10n ** 18n) throw new Error("VCTR total supply does not match 10 billion tokens.");
if (usdcSymbol !== "USDC" || usdcDecimals !== 6n) {
  throw new Error(`Unexpected native USDC metadata at ${expectedUsdc}: ${usdcSymbol}/${usdcDecimals}.`);
}
if (sellerBalance < requiredInventory) {
  throw new Error(
    `Seller inventory check failed: ${formatUnits(sellerBalance, 18)} VCTR available; ` +
      `${formatUnits(requiredInventory, 18)} VCTR required. No transaction was sent.`,
  );
}

process.stdout.write(`Read-only preflight passed for ${fixedSaleSpec.network}, chain ID ${chainId}.\n`);
process.stdout.write(`VCTR: ${expectedVctr} (${vctrName}, ${vctrSymbol}, ${vctrDecimals} decimals).\n`);
process.stdout.write(`Native USDC: ${expectedUsdc} (${usdcSymbol}, ${usdcDecimals} decimals).\n`);
process.stdout.write(`Seller: ${expectedSeller} (${formatUnits(sellerBalance, 18)} VCTR; 3,000,000,000 required).\n`);
process.stdout.write(`Price: ${fixedSaleSpec.priceMicroUsdcPerVctr} micro-USDC = 0.018095 USDC per whole VCTR.\n`);
process.stdout.write(`Minimum: ${fixedSaleSpec.minimumPurchaseVctr} VCTR = 1.8095 USDC.\n`);
process.stdout.write(`Limits: ${fixedSaleSpec.maximumSuccessfulPurchases} successful purchases OR ${fixedSaleSpec.maximumSaleVctr} VCTR.\n`);

if (process.argv.includes("--check")) {
  process.stdout.write("Check-only mode: no signing key was read and no transaction was sent.\n");
  await provider.destroy();
  process.exit(0);
}

if (fs.existsSync(reportPath)) {
  throw new Error(`Refusing to deploy because the report already exists: ${reportPath}`);
}
const approvedCommit = assertCleanMainnetRelease();
await import("./compile.mjs");
const artifactPath = path.join(root, "artifacts/solc/VCTRFixedSale.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const privateKey = readLocalEnv("BASE_MAINNET_DEPLOYER_PRIVATE_KEY");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("Set BASE_MAINNET_DEPLOYER_PRIVATE_KEY in the ignored local .env; never paste it into chat or source control.");
}
const deployer = new Wallet(privateKey, provider);
if (getAddress(deployer.address) !== expectedDeployer) {
  throw new Error(`Wrong deployment account: expected previously confirmed ${expectedDeployer}, found ${deployer.address}. No transaction was sent.`);
}
const balance = await provider.getBalance(deployer.address);
const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, deployer);
const args = fixedSaleConstructorArgs();
const unsigned = await factory.getDeployTransaction(...args);
const gasEstimate = await provider.estimateGas({ ...unsigned, from: deployer.address });
const feeData = await provider.getFeeData();
const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
if (maxFeePerGas === null) throw new Error("Could not estimate Base Mainnet gas price.");
const gasLimit = (gasEstimate * 120n) / 100n;
const maxCost = gasLimit * maxFeePerGas;
if (balance < maxCost) {
  throw new Error(`Insufficient Base ETH. Estimated maximum cost: ${formatEther(maxCost)} Base ETH; available ${formatEther(balance)}.`);
}

process.stdout.write(`\nDeployment account: ${deployer.address}\n`);
process.stdout.write(`Estimated gas: ${gasEstimate}; limit with 20% headroom: ${gasLimit}.\n`);
process.stdout.write(`Maximum estimated deployment cost: ${formatEther(maxCost)} Base ETH.\n`);
process.stdout.write(`Reviewed release commit: ${approvedCommit}\n`);
process.stdout.write("Constructor values (immutable):\n");
process.stdout.write(`  VCTR token: ${expectedVctr}\n  USDC token: ${expectedUsdc}\n  Seller: ${expectedSeller}\n`);
process.stdout.write(`  Price micro-USDC/VCTR: ${fixedSaleSpec.priceMicroUsdcPerVctr}\n`);
process.stdout.write(`  Minimum whole VCTR: ${fixedSaleSpec.minimumPurchaseVctr}\n`);
process.stdout.write(`  Maximum successful purchases: ${fixedSaleSpec.maximumSuccessfulPurchases}\n`);
process.stdout.write(`  Maximum whole VCTR sold: ${fixedSaleSpec.maximumSaleVctr}\n`);

const rl = createInterface({ input: stdin, output: stdout });
try {
  const addressConfirm = await rl.question(`Type exactly "DEPLOYER ${deployer.address}" after checking the deployment account: `);
  if (addressConfirm !== `DEPLOYER ${deployer.address}`) throw new Error("Deployment-account confirmation mismatch; stopped without sending.");
  const networkConfirm = await rl.question('Type "DEPLOY IMMUTABLE SALE ON BASE MAINNET 8453" to continue: ');
  if (networkConfirm !== "DEPLOY IMMUTABLE SALE ON BASE MAINNET 8453") throw new Error("Network confirmation mismatch; stopped without sending.");
const irreversibleConfirm = await rl.question('Type "I ACCEPT IRREVERSIBLE SALE DEPLOYMENT" to submit the real transaction: ');
  if (irreversibleConfirm !== "I ACCEPT IRREVERSIBLE SALE DEPLOYMENT") throw new Error("Irreversible-deployment confirmation mismatch; stopped without sending.");

  await assertBaseMainnet();
  const sale = await factory.deploy(...args, { gasLimit });
  const tx = sale.deploymentTransaction();
  process.stdout.write(`Deployment submitted: ${tx.hash}\n`);
  const receipt = await tx.wait(5);
  if (receipt.status !== 1) throw new Error(`Deployment transaction failed: ${tx.hash}`);
  const saleAddress = getAddress(await sale.getAddress());
  const deployedCode = await provider.getCode(saleAddress);
  if (deployedCode === "0x") throw new Error(`No contract code found at ${saleAddress} after deployment.`);

  const [deployedVctr, deployedUsdc, deployedSeller, deployedPrice, deployedMinimum, deployedPurchaseLimit, deployedSaleLimit] = await Promise.all([
    sale.vctrToken(),
    sale.usdcToken(),
    sale.seller(),
    sale.priceMicroUsdcPerVctr(),
    sale.minimumPurchaseVctr(),
    sale.maximumSuccessfulPurchases(),
    sale.maximumSaleVctr(),
  ]);
  if (
    getAddress(deployedVctr) !== expectedVctr || getAddress(deployedUsdc) !== expectedUsdc
      || getAddress(deployedSeller) !== expectedSeller || deployedPrice !== fixedSaleSpec.priceMicroUsdcPerVctr
      || deployedMinimum !== fixedSaleSpec.minimumPurchaseVctr
      || deployedPurchaseLimit !== fixedSaleSpec.maximumSuccessfulPurchases
      || deployedSaleLimit !== fixedSaleSpec.maximumSaleVctr
      || (await sale.successfulPurchases()) !== 0n || (await sale.totalVctrSold()) !== 0n || (await sale.closed())
  ) {
    throw new Error(`Post-deployment immutable-value verification failed at ${saleAddress}; do not fund or advertise it.`);
  }

  const report = {
    network: fixedSaleSpec.network,
    chain_id: Number(fixedSaleSpec.chainId),
    sale_contract: saleAddress,
    vctr_token: expectedVctr,
    usdc_token: expectedUsdc,
    seller: expectedSeller,
    price_usdc_per_vctr: "0.018095",
    price_micro_usdc_per_vctr: fixedSaleSpec.priceMicroUsdcPerVctr.toString(),
    minimum_purchase_vctr: fixedSaleSpec.minimumPurchaseVctr.toString(),
    maximum_successful_purchases: fixedSaleSpec.maximumSuccessfulPurchases.toString(),
    maximum_sale_vctr: fixedSaleSpec.maximumSaleVctr.toString(),
    inventory_funding_required_before_sale: "3000000000 VCTR",
    deployer: deployer.address,
    transaction_hash: receipt.hash,
    block_number: receipt.blockNumber,
    approved_commit: approvedCommit,
    inventory_funded: false,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`\nSale contract deployed and cross-checked at ${saleAddress}.\n`);
  process.stdout.write(`Transaction: ${receipt.hash} (block ${receipt.blockNumber}).\n`);
  process.stdout.write(`Report: ${reportPath}\n`);
  process.stdout.write(`Next: transfer exactly 3,000,000,000 VCTR from ${expectedSeller} to ${saleAddress} on Base Mainnet; verify the received balance before advertising.\n`);
} finally {
  rl.close();
  await provider.destroy();
}
