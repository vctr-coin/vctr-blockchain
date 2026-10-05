export const networkConfigs = Object.freeze({
  "base-sepolia": Object.freeze({
    name: "Base Sepolia",
    chainId: 84532n,
    rpcEnv: "BASE_SEPOLIA_RPC",
    rpcDefault: "https://sepolia.base.org",
    privateKeyEnv: "DEPLOYER_PRIVATE_KEY",
    confirmation: "DEPLOY TO BASE SEPOLIA",
    reportFile: "base-sepolia.json",
    isMainnet: false,
    confirmations: 1,
  }),
  "ethereum-sepolia": Object.freeze({
    name: "Ethereum Sepolia",
    chainId: 11155111n,
    rpcEnv: "ETHEREUM_SEPOLIA_RPC",
    rpcDefault: "https://ethereum-sepolia-rpc.publicnode.com",
    privateKeyEnv: "DEPLOYER_PRIVATE_KEY",
    confirmation: "DEPLOY TO ETHEREUM SEPOLIA",
    reportFile: "ethereum-sepolia.json",
    isMainnet: false,
    confirmations: 1,
  }),
  "base-mainnet": Object.freeze({
    name: "Base Mainnet",
    chainId: 8453n,
    rpcEnv: "BASE_MAINNET_RPC",
    rpcDefault: "https://mainnet.base.org",
    privateKeyEnv: "BASE_MAINNET_DEPLOYER_PRIVATE_KEY",
    confirmation: "DEPLOY TO BASE MAINNET",
    irreversibleConfirmation: "I ACCEPT IRREVERSIBLE MAINNET DEPLOYMENT",
    reportFile: "base-mainnet.json",
    isMainnet: true,
    confirmations: 5,
  }),
});

export function resolveNetworkConfig(networkKey = "base-sepolia") {
  const target = networkConfigs[networkKey];
  if (!target) {
    throw new Error('DEPLOY_NETWORK must be "base-sepolia", "ethereum-sepolia", or "base-mainnet".');
  }
  return target;
}

export function assertApprovedMainnetRelease(approvedCommit, currentCommit, workingTreeStatus) {
  if (!/^[0-9a-f]{40}$/i.test(approvedCommit || "")) {
    throw new Error("Set BASE_MAINNET_APPROVED_COMMIT to the full 40-character reviewed Git commit hash.");
  }
  if (currentCommit !== approvedCommit) {
    throw new Error("Current Git commit does not match BASE_MAINNET_APPROVED_COMMIT; refusing Mainnet deployment.");
  }
  if (workingTreeStatus) {
    throw new Error("Git working tree must be clean for Base Mainnet deployment.");
  }
}
