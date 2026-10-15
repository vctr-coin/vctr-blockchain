import { getAddress } from "ethers";
import { assertApprovedMainnetRelease } from "./deployment-config.mjs";

export const saleMainnetAddresses = Object.freeze({
  vctr: "0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  seller: "0x7c98B0aF272Ae8e2f51bC16AaF19a82f6F2248cc",
  projectTreasurySigner: "0x822b4D5711740A3Ee3d1F30C3Eeb06b794537767",
  authorizationSigner: "0x7b6153688fAa5B4AedaA6E2aF7ad012945ACC9D9",
  tdsWallet: "0xfe979c23184b498bbaBa5144e466761263e58737",
  salesWallet: "0x7c98B0aF272Ae8e2f51bC16AaF19a82f6F2248cc",
  deployer: "0xE67189b9C5f4E672628808B51487e37C755b40b1",
});

export function buildSaleConstructorArguments(addresses = saleMainnetAddresses) {
  const normalized = Object.fromEntries(
    Object.entries(addresses).map(([name, value]) => {
      try {
        return [name, getAddress(value)];
      } catch {
        throw new Error(`${name} is missing or is not a valid checksummed EVM address.`);
      }
    }),
  );

  if (normalized.seller === normalized.projectTreasurySigner
    || normalized.seller === normalized.authorizationSigner
    || normalized.projectTreasurySigner === normalized.authorizationSigner) {
    throw new Error("Seller, Project Treasury signer, and authorization signer must be distinct.");
  }
  if (normalized.tdsWallet === normalized.salesWallet) {
    throw new Error("TDS and Sales payout wallets must be distinct.");
  }
  if (normalized.salesWallet !== normalized.seller) {
    throw new Error("The confirmed Sales payout wallet must match the Seller wallet.");
  }

  return [
    normalized.vctr,
    normalized.usdc,
    normalized.seller,
    normalized.projectTreasurySigner,
    normalized.authorizationSigner,
    [normalized.tdsWallet, normalized.salesWallet],
  ];
}

export function assertSaleMainnetRelease(approvedCommit, currentCommit, workingTreeStatus) {
  assertApprovedMainnetRelease(approvedCommit, currentCommit, workingTreeStatus);
}

export function assertSaleDeployer(actualAddress, expectedAddress = saleMainnetAddresses.deployer) {
  if (getAddress(actualAddress) !== getAddress(expectedAddress)) {
    throw new Error(`Wrong sale deployer: expected ${getAddress(expectedAddress)}, received ${getAddress(actualAddress)}.`);
  }
}
