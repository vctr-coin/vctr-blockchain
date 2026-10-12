import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider, formatUnits, getAddress } from "ethers";
import { fixedSaleSpec } from "./fixed-sale-config.mjs";

const root = process.cwd();
const reportPath = path.join(root, "deployments/vctr-fixed-sale-base-mainnet.json");
if (!fs.existsSync(reportPath)) throw new Error(`Missing sale deployment report: ${reportPath}`);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (report.network !== "Base Mainnet" || BigInt(report.chain_id) !== fixedSaleSpec.chainId) {
  throw new Error("Sale report does not identify Base Mainnet chain ID 8453.");
}
if (
  getAddress(report.vctr_token) !== getAddress(fixedSaleSpec.vctrToken)
    || getAddress(report.usdc_token) !== getAddress(fixedSaleSpec.usdcToken)
    || getAddress(report.seller) !== getAddress(fixedSaleSpec.seller)
    || report.price_usdc_per_vctr !== "0.018095"
) {
  throw new Error("Sale report addresses or price differ from the reviewed fixed-sale configuration.");
}

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

const provider = new JsonRpcProvider(readLocalEnv("BASE_MAINNET_RPC") || "https://mainnet.base.org");
try {
  const chainId = BigInt(await provider.send("eth_chainId", []));
  if (chainId !== fixedSaleSpec.chainId) throw new Error(`Wrong network: received chain ID ${chainId}.`);
  const saleAddress = getAddress(report.sale_contract);
  const code = await provider.getCode(saleAddress);
  if (code === "0x") throw new Error(`No contract code at reported sale address ${saleAddress}.`);

  const sale = new Contract(
    saleAddress,
    [
      "function vctrToken() view returns (address)",
      "function usdcToken() view returns (address)",
      "function seller() view returns (address)",
      "function priceMicroUsdcPerVctr() view returns (uint256)",
      "function minimumPurchaseVctr() view returns (uint256)",
      "function maximumSuccessfulPurchases() view returns (uint256)",
      "function maximumSaleVctr() view returns (uint256)",
      "function successfulPurchases() view returns (uint256)",
      "function totalVctrSold() view returns (uint256)",
      "function closed() view returns (bool)",
    ],
    provider,
  );
  const values = await Promise.all([
    sale.vctrToken(),
    sale.usdcToken(),
    sale.seller(),
    sale.priceMicroUsdcPerVctr(),
    sale.minimumPurchaseVctr(),
    sale.maximumSuccessfulPurchases(),
    sale.maximumSaleVctr(),
    sale.successfulPurchases(),
    sale.totalVctrSold(),
    sale.closed(),
  ]);
  const expected = [
    getAddress(fixedSaleSpec.vctrToken),
    getAddress(fixedSaleSpec.usdcToken),
    getAddress(fixedSaleSpec.seller),
    fixedSaleSpec.priceMicroUsdcPerVctr,
    fixedSaleSpec.minimumPurchaseVctr,
    fixedSaleSpec.maximumSuccessfulPurchases,
    fixedSaleSpec.maximumSaleVctr,
  ];
  for (let i = 0; i < 3; i++) {
    if (getAddress(values[i]) !== expected[i]) throw new Error(`On-chain immutable address mismatch at index ${i}.`);
  }
  for (let i = 3; i < 7; i++) {
    if (values[i] !== expected[i]) throw new Error(`On-chain immutable sale parameter mismatch at index ${i}.`);
  }

  const sold = values[8];
  const closed = values[9];
  const saleInventory = await new Contract(fixedSaleSpec.vctrToken, ["function balanceOf(address) view returns (uint256)"], provider)
    .balanceOf(saleAddress);
  const remaining = fixedSaleSpec.maximumSaleVctr - sold;
  if (!closed && saleInventory < remaining * 10n ** 18n) {
    throw new Error(`Sale inventory is short: ${formatUnits(saleInventory, 18)} VCTR held; ${remaining} VCTR required.`);
  }
  if (closed && saleInventory !== 0n) {
    throw new Error(`Closed sale unexpectedly retains ${formatUnits(saleInventory, 18)} VCTR.`);
  }

  process.stdout.write(`PASS: Base Mainnet chain ID ${chainId}; sale contract ${saleAddress} has bytecode.\n`);
  process.stdout.write(`PASS: fixed VCTR, native USDC, seller, price, minimum, purchase cap, and sale cap match reviewed values.\n`);
  process.stdout.write(`Sale status: ${closed ? "CLOSED" : "OPEN"}; purchases ${values[7]}/${fixedSaleSpec.maximumSuccessfulPurchases}; sold ${sold}/${fixedSaleSpec.maximumSaleVctr} VCTR.\n`);
  process.stdout.write(`Escrow balance: ${formatUnits(saleInventory, 18)} VCTR.\n`);
  if (!closed && values[7] === 0n && sold === 0n && saleInventory === fixedSaleSpec.maximumSaleVctr * 10n ** 18n) {
    process.stdout.write("PASS: sale inventory is fully funded and no purchases have occurred; sale is ready for a separately hosted buyer interface.\n");
  }
} finally {
  await provider.destroy();
}
