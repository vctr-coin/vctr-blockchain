import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fixedSaleConstructorArgs, fixedSaleSpec } from "../scripts/fixed-sale-config.mjs";

describe("pinned Base fixed-sale deployment configuration", () => {
  it("matches the previously deployed VCTR, native Base USDC, and Direct Sales wallet", () => {
    assert.equal(fixedSaleSpec.vctrToken, "0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc");
    assert.equal(fixedSaleSpec.usdcToken, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    assert.equal(fixedSaleSpec.seller, "0x7c98B0aF272Ae8e2f51bC16AaF19a82f6F2248cc");
    assert.equal(fixedSaleSpec.expectedDeployer, "0xE67189b9C5f4E672628808B51487e37C755b40b1");
  });

  it("encodes the agreed fixed price and sale caps without decimal ambiguity", () => {
    assert.equal(fixedSaleSpec.chainId, 8453n);
    assert.equal(fixedSaleSpec.priceMicroUsdcPerVctr, 18_095n);
    assert.equal(100n * fixedSaleSpec.priceMicroUsdcPerVctr, 1_809_500n); // 1.8095 USDC
    assert.equal(fixedSaleSpec.minimumPurchaseVctr, 100n);
    assert.equal(fixedSaleSpec.maximumSuccessfulPurchases, 3_000_000n);
    assert.equal(fixedSaleSpec.maximumSaleVctr, 3_000_000_000n);
    assert.equal(fixedSaleSpec.maximumSuccessfulPurchases * fixedSaleSpec.minimumPurchaseVctr, 300_000_000n);
    assert.equal(fixedSaleSpec.maximumSaleVctr * fixedSaleSpec.priceMicroUsdcPerVctr, 54_285_000_000_000n);
  });

  it("passes exactly the reviewed immutable arguments to the deployment factory", () => {
    assert.deepEqual(fixedSaleConstructorArgs(), [
      fixedSaleSpec.vctrToken,
      fixedSaleSpec.usdcToken,
      fixedSaleSpec.seller,
      18_095n,
      100n,
      3_000_000n,
      3_000_000_000n,
    ]);
  });
});
