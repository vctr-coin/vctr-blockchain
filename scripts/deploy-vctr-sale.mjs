import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, formatEther, formatUnits } from "ethers";
import { assertSaleDeployer, assertSaleMainnetRelease, buildSaleConstructorArguments } from "./sale-deployment-config.mjs";

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

if (process.env.DEPLOY_NETWORK && process.env.DEPLOY_NETWORK !== "base-mainnet") {
  throw new Error("This sale deployment script is Base Mainnet only; no testnet deployment is supported here.");
}

let currentCommit;
let workingTreeStatus;
try {
  currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  workingTreeStatus = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {
  throw new Error("Base Mainnet sale deployment requires a Git checkout with a clean, reviewed release commit.");
}
assertSaleMainnetRelease(readLocalEnv("BASE_MAINNET_APPROVED_COMMIT"), currentCommit, workingTreeStatus);

const constructorArgs = buildSaleConstructorArguments();
const [vctrAddress, usdcAddress, sellerAddress, treasurySigner, authorizationSigner, payoutWallets] = constructorArgs;
const targetChainId = 8453n;
const rpcUrl = readLocalEnv("BASE_MAINNET_RPC") || "https://mainnet.base.org";
const privateKey = readLocalEnv("BASE_MAINNET_DEPLOYER_PRIVATE_KEY");
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error("Set BASE_MAINNET_DEPLOYER_PRIVATE_KEY in the ignored local .env or a secure environment variable.");
}

await import("./compile.mjs");
const artifactPath = path.join(root, "artifacts/solc/VCTRSale.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const provider = new JsonRpcProvider(rpcUrl, Number(targetChainId), { staticNetwork: true });
const network = await provider.getNetwork();
if (network.chainId !== targetChainId) {
  throw new Error(`Wrong chain: expected Base Mainnet (${targetChainId}), received ${network.chainId}.`);
}

const deployer = new Wallet(privateKey, provider);
assertSaleDeployer(deployer.address);

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];
const vctr = new Contract(vctrAddress, erc20Abi, provider);
const usdc = new Contract(usdcAddress, erc20Abi, provider);
for (const [name, address] of [["VCTR", vctrAddress], ["native Base USDC", usdcAddress]]) {
  if (await provider.getCode(address) === "0x") throw new Error(`${name} address has no deployed contract code on Base Mainnet.`);
}
if (await vctr.decimals() !== 18n) throw new Error("Configured VCTR contract does not report 18 decimals.");
if (await usdc.decimals() !== 6n) throw new Error("Configured native Base USDC contract does not report 6 decimals.");
const sellerBalance = await vctr.balanceOf(sellerAddress);
const plannedInventory = 5_000_000n * 10n ** 18n;
if (sellerBalance < plannedInventory) {
  throw new Error(`Seller currently has ${formatUnits(sellerBalance, 18)} VCTR; 5,000,000 VCTR is needed for the planned initial inventory.`);
}
const reportPath = path.join(root, "deployments/base-mainnet-sale.json");
if (fs.existsSync(reportPath)) {
  throw new Error(`Refusing to deploy because ${reportPath} already exists; inspect the existing report first.`);
}

const rl = createInterface({ input: stdin, output: stdout });
try {
  process.stdout.write("BASE MAINNET — VCTR DIRECT-SALE CONTRACT DEPLOYMENT ONLY\n");
  process.stdout.write("This sends a real, irreversible transaction. It does not move VCTR inventory.\n\n");
  process.stdout.write(`VCTR: ${vctrAddress}\nNative USDC: ${usdcAddress}\n`);
  process.stdout.write(`Seller / Sales: ${sellerAddress}\nProject Treasury signer: ${treasurySigner}\n`);
  process.stdout.write(`Authorization signer: ${authorizationSigner}\nTDS payout: ${payoutWallets[0]}\n`);
  process.stdout.write(`Deployer: ${deployer.address}\nBase ETH: ${formatEther(await provider.getBalance(deployer.address))}\n`);
  process.stdout.write("Immutable terms: 0.018095 USDC/VCTR; minimum 100 VCTR; 3,000,000,000 VCTR and 30,000,000 successful-purchase caps; initial TDS 1%.\n");
  const addressConfirmation = await rl.question('Type "SALE ADDRESSES VERIFIED" to continue: ');
  if (addressConfirmation !== "SALE ADDRESSES VERIFIED") throw new Error("Address confirmation did not match; stopped without sending.");

  const factory = new ContractFactory(artifact.abi, artifact.evm.bytecode.object, deployer);
  const deployTx = await factory.getDeployTransaction(...constructorArgs);
  const estimatedGas = await provider.estimateGas({ ...deployTx, from: deployer.address });
  const feeData = await provider.getFeeData();
  const maxFeePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (maxFeePerGas === null) throw new Error("Could not estimate Base Mainnet gas price.");
  const gasLimit = (estimatedGas * 120n) / 100n;
  const estimatedCost = gasLimit * maxFeePerGas;
  const deployerBalance = await provider.getBalance(deployer.address);
  if (deployerBalance < estimatedCost) {
    throw new Error(`Insufficient Base ETH. Maximum estimated deployment cost: ${formatEther(estimatedCost)} Base ETH.`);
  }
  process.stdout.write(`Estimated gas: ${estimatedGas}\nGas limit with 20% headroom: ${gasLimit}\nMaximum estimated cost: ${formatEther(estimatedCost)} Base ETH\n`);
  const networkConfirmation = await rl.question('Type "DEPLOY VCTR SALE TO BASE MAINNET" to submit: ');
  if (networkConfirmation !== "DEPLOY VCTR SALE TO BASE MAINNET") throw new Error("Network confirmation did not match; stopped without sending.");
  const irreversibleConfirmation = await rl.question('Type "I ACCEPT IRREVERSIBLE SALE DEPLOYMENT" to authorize: ');
  if (irreversibleConfirmation !== "I ACCEPT IRREVERSIBLE SALE DEPLOYMENT") {
    throw new Error("Irreversible-deployment confirmation did not match; stopped without sending.");
  }

  const sale = await factory.deploy(...constructorArgs, { gasLimit });
  const receipt = await sale.deploymentTransaction().wait(5);
  const saleAddress = await sale.getAddress();
  const verifiedValues = {
    vctr: await sale.vctr(),
    usdc: await sale.usdc(),
    seller: await sale.seller(),
    projectTreasurySigner: await sale.projectTreasurySigner(),
    authorizationSigner: await sale.authorizationSigner(),
    payout: await sale.activeSplitConfig(),
    price: await sale.PRICE_USDC_MICRO_PER_VCTR(),
    minimumPurchase: await sale.MIN_PURCHASE(),
    maxSale: await sale.MAX_SALE(),
    maxPurchases: await sale.MAX_PURCHASES(),
  };
  if (verifiedValues.vctr !== vctrAddress || verifiedValues.usdc !== usdcAddress
    || verifiedValues.seller !== sellerAddress || verifiedValues.projectTreasurySigner !== treasurySigner
    || verifiedValues.authorizationSigner !== authorizationSigner || verifiedValues.price !== 18_095n
    || verifiedValues.minimumPurchase !== 100n * 10n ** 18n
    || verifiedValues.maxSale !== 3_000_000_000n * 10n ** 18n || verifiedValues.maxPurchases !== 30_000_000n
    || verifiedValues.payout[0][0] !== payoutWallets[0] || verifiedValues.payout[0][1] !== payoutWallets[1]
    || verifiedValues.payout[1] !== 100n || verifiedValues.payout[2] !== 1n) {
    throw new Error("Deployed sale constructor state did not match the reviewed configuration; stop and investigate.");
  }

  const report = {
    network: "Base Mainnet",
    chain_id: Number(targetChainId),
    sale_contract_address: saleAddress,
    deployment_transaction_hash: receipt.hash,
    deployment_block: receipt.blockNumber,
    deployer: deployer.address,
    constructor: {
      vctr: vctrAddress,
      usdc: usdcAddress,
      seller: sellerAddress,
      project_treasury_signer: treasurySigner,
      authorization_signer: authorizationSigner,
      tds_wallet: payoutWallets[0],
      sales_wallet: payoutWallets[1],
    },
    immutable_sale_terms: {
      price_usdc_micro_per_vctr: "18095",
      minimum_vctr: "100000000000000000000",
      max_vctr: "3000000000000000000000000000",
      max_successful_purchases: "30000000",
      initial_tds_bps: "100",
    },
    initial_inventory_funded: false,
    note: "Sale contract deployed. Source verification and inventory funding are separate steps; do not announce sales before both are complete.",
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`\nSale deployment confirmed in block ${receipt.blockNumber}.\nSale contract: ${saleAddress}\nReport: ${reportPath}\n`);
} finally {
  rl.close();
  await provider.destroy();
}
