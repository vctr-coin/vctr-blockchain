import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSaleDeployer,
  assertSaleMainnetRelease,
  buildSaleConstructorArguments,
  saleMainnetAddresses,
} from "../scripts/sale-deployment-config.mjs";

test("sale deployment config uses the confirmed Base Mainnet token, signer, and payout addresses", () => {
  const [vctr, usdc, seller, treasurySigner, authorizationSigner, payoutWallets] = buildSaleConstructorArguments();
  assert.equal(vctr, saleMainnetAddresses.vctr);
  assert.equal(usdc, saleMainnetAddresses.usdc);
  assert.equal(seller, saleMainnetAddresses.seller);
  assert.equal(treasurySigner, saleMainnetAddresses.projectTreasurySigner);
  assert.equal(authorizationSigner, saleMainnetAddresses.authorizationSigner);
  assert.deepEqual(payoutWallets, [saleMainnetAddresses.tdsWallet, saleMainnetAddresses.salesWallet]);
});

test("sale deployment rejects duplicate signers, duplicate payout wallets, and an unconfirmed Sales address", () => {
  assert.throws(() => buildSaleConstructorArguments({
    ...saleMainnetAddresses,
    authorizationSigner: saleMainnetAddresses.seller,
  }), /must be distinct/);
  assert.throws(() => buildSaleConstructorArguments({
    ...saleMainnetAddresses,
    tdsWallet: saleMainnetAddresses.seller,
  }), /payout wallets must be distinct/);
  assert.throws(() => buildSaleConstructorArguments({
    ...saleMainnetAddresses,
    salesWallet: saleMainnetAddresses.projectTreasurySigner,
  }), /must match the Seller wallet/);
});

test("sale deployment requires the recorded deployer and reviewed clean commit", () => {
  assert.doesNotThrow(() => assertSaleDeployer(saleMainnetAddresses.deployer));
  assert.throws(() => assertSaleDeployer(saleMainnetAddresses.seller), /Wrong sale deployer/);
  const commit = "a".repeat(40);
  assert.doesNotThrow(() => assertSaleMainnetRelease(commit, commit, ""));
  assert.throws(() => assertSaleMainnetRelease(commit, "b".repeat(40), ""), /does not match/);
  assert.throws(() => assertSaleMainnetRelease(commit, commit, " M README.md"), /must be clean/);
});
