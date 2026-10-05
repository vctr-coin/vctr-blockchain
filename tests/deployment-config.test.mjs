import assert from "node:assert/strict";
import test from "node:test";
import {
  assertApprovedMainnetRelease,
  networkConfigs,
  resolveNetworkConfig,
} from "../scripts/deployment-config.mjs";

test("Base Mainnet is an explicit production target with a separate signing key", () => {
  const config = resolveNetworkConfig("base-mainnet");

  assert.equal(config.name, "Base Mainnet");
  assert.equal(config.chainId, 8453n);
  assert.equal(config.rpcEnv, "BASE_MAINNET_RPC");
  assert.equal(config.privateKeyEnv, "BASE_MAINNET_DEPLOYER_PRIVATE_KEY");
  assert.equal(config.reportFile, "base-mainnet.json");
  assert.equal(config.isMainnet, true);
  assert.equal(config.confirmation, "DEPLOY TO BASE MAINNET");
  assert.equal(config.irreversibleConfirmation, "I ACCEPT IRREVERSIBLE MAINNET DEPLOYMENT");
  assert.equal(config.confirmations, 5);
});

test("test deployments remain separate from Base Mainnet", () => {
  assert.equal(resolveNetworkConfig("base-sepolia").chainId, 84532n);
  assert.equal(resolveNetworkConfig("ethereum-sepolia").chainId, 11155111n);
  assert.equal(resolveNetworkConfig().name, "Base Sepolia");
  assert.equal(Object.hasOwn(networkConfigs, "ethereum-mainnet"), false);
  assert.throws(() => resolveNetworkConfig("unknown"), /DEPLOY_NETWORK must be/);
});

test("Base Mainnet deployment requires the exact reviewed commit and a clean tree", () => {
  const commit = "a".repeat(40);

  assert.doesNotThrow(() => assertApprovedMainnetRelease(commit, commit, ""));
  assert.throws(() => assertApprovedMainnetRelease("", commit, ""), /full 40-character/);
  assert.throws(() => assertApprovedMainnetRelease(commit, "b".repeat(40), ""), /does not match/);
  assert.throws(() => assertApprovedMainnetRelease(commit, commit, " M contracts/VCTRToken.sol"), /must be clean/);
});
