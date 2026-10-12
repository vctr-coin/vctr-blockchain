export const fixedSaleSpec = Object.freeze({
  network: "Base Mainnet",
  chainId: 8453n,
  vctrToken: "0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc",
  usdcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  seller: "0x7c98B0aF272Ae8e2f51bC16AaF19a82f6F2248cc",
  expectedDeployer: "0xE67189b9C5f4E672628808B51487e37C755b40b1",
  priceMicroUsdcPerVctr: 18_095n,
  minimumPurchaseVctr: 100n,
  maximumSuccessfulPurchases: 3_000_000n,
  maximumSaleVctr: 3_000_000_000n,
});

export function fixedSaleConstructorArgs() {
  return [
    fixedSaleSpec.vctrToken,
    fixedSaleSpec.usdcToken,
    fixedSaleSpec.seller,
    fixedSaleSpec.priceMicroUsdcPerVctr,
    fixedSaleSpec.minimumPurchaseVctr,
    fixedSaleSpec.maximumSuccessfulPurchases,
    fixedSaleSpec.maximumSaleVctr,
  ];
}
