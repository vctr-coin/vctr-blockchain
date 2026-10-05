import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import ganache from "ganache";
import { BrowserProvider, Contract, ContractFactory } from "ethers";
import solc from "solc";

const root = process.cwd();
const unit = 10n ** 18n;
const cliffDuration = 15n * 365n * 24n * 60n * 60n;
const vestingDuration = 5n * 365n * 24n * 60n * 60n;
const allocationLockDuration = 3n * 365n * 24n * 60n * 60n;
const founderAllocation = 3_000_000_000n * unit;

function compileToken() {
  const input = {
    language: "Solidity",
    sources: {
      "contracts/VCTRToken.sol": {
        content: fs.readFileSync(path.join(root, "contracts/VCTRToken.sol"), "utf8"),
      },
      "contracts/FounderVesting.sol": {
        content: fs.readFileSync(path.join(root, "contracts/FounderVesting.sol"), "utf8"),
      },
      "contracts/AllocationTimelock.sol": {
        content: fs.readFileSync(path.join(root, "contracts/AllocationTimelock.sol"), "utf8"),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import(importPath) {
        const sourcePath = path.join(root, "node_modules", importPath);
        if (!fs.existsSync(sourcePath)) return { error: `Import not found: ${importPath}` };
        return { contents: fs.readFileSync(sourcePath, "utf8") };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((item) => item.severity === "error");
  assert.deepEqual(errors, [], errors.map((item) => item.formattedMessage).join("\n"));
  return output.contracts["contracts/VCTRToken.sol"].VCTRToken;
}

let chain;
let rpc;
let signers;
let addresses;
let token;
let vesting;
let communityLock;
let treasuryLock;
let socialCausesLock;
let startTimestamp;
let tokenArtifact;

async function advanceTo(timestamp) {
  const latest = BigInt((await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp);
  if (timestamp > latest) {
    await rpc.request({ method: "evm_setTime", params: [Number(timestamp * 1000n)] });
    await rpc.request({ method: "evm_mine", params: [] });
  }
}

describe("VCTR token and founder vesting on a temporary local EVM", () => {
  before(async () => {
    rpc = ganache.provider({
      logging: { quiet: true },
      chain: { hardfork: "shanghai" },
      wallet: { totalAccounts: 10, defaultBalance: 1000 },
    });
    chain = new BrowserProvider(rpc);
    signers = await Promise.all(Array.from({ length: 8 }, (_, index) => chain.getSigner(index)));
    addresses = await Promise.all(signers.map((signer) => signer.getAddress()));
    tokenArtifact = compileToken();

    const factory = new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, signers[0]);
    token = await factory.deploy(
      addresses[1], // liquidity reserve
      addresses[2], // seller
      addresses[3], // community and ecosystem
      addresses[4], // project treasury
      addresses[5], // social causes
      addresses[6], // founder beneficiary
    );
    await token.waitForDeployment();
    vesting = new Contract(
      await token.founderVesting(),
      [
        "function startTimestamp() view returns (uint64)",
        "function beneficiary() view returns (address)",
        "function token() view returns (address)",
        "function released() view returns (uint256)",
        "function vestedAmount(uint64) view returns (uint256)",
        "function releasableAmount() view returns (uint256)",
        "function release() returns (uint256)",
      ],
      signers[6],
    );
    const allocationLockAbi = [
      "function unlockTimestamp() view returns (uint64)",
      "function beneficiary() view returns (address)",
      "function allocation() view returns (uint256)",
      "function released() view returns (bool)",
      "function release()",
    ];
    communityLock = new Contract(await token.communityTimelock(), allocationLockAbi, signers[3]);
    treasuryLock = new Contract(await token.treasuryTimelock(), allocationLockAbi, signers[4]);
    socialCausesLock = new Contract(await token.socialCausesTimelock(), allocationLockAbi, signers[5]);
    startTimestamp = BigInt(await vesting.startTimestamp());
  });

  after(async () => {
    await rpc.disconnect();
  });

  it("sets metadata and allocates exactly 10 billion tokens across the six beneficiaries and lock contracts", async () => {
    assert.equal(await token.name(), "VCTR AI Token");
    assert.equal(await token.symbol(), "VCTR");
    assert.equal(await token.decimals(), 18n);
    assert.equal(await token.totalSupply(), 10_000_000_000n * unit);
    assert.equal(await token.balanceOf(await token.founderVesting()), founderAllocation);
    assert.equal(await token.balanceOf(addresses[1]), 1_000_000_000n * unit);
    assert.equal(await token.balanceOf(addresses[2]), 3_000_000_000n * unit);
    assert.equal(await token.balanceOf(await token.communityTimelock()), 500_000_000n * unit);
    assert.equal(await token.balanceOf(await token.treasuryTimelock()), 1_000_000_000n * unit);
    assert.equal(await token.balanceOf(await token.socialCausesTimelock()), 1_500_000_000n * unit);
    assert.equal(await token.balanceOf(addresses[3]), 0n);
    assert.equal(await token.balanceOf(addresses[4]), 0n);
    assert.equal(await token.balanceOf(addresses[5]), 0n);
    assert.equal(await token.balanceOf(addresses[6]), 0n);
    assert.equal(await vesting.beneficiary(), addresses[6]);
    assert.equal(await vesting.token(), await token.getAddress());
    assert.equal(await communityLock.beneficiary(), addresses[3]);
    assert.equal(await communityLock.allocation(), 500_000_000n * unit);
    assert.equal(await treasuryLock.beneficiary(), addresses[4]);
    assert.equal(await treasuryLock.allocation(), 1_000_000_000n * unit);
    assert.equal(await socialCausesLock.beneficiary(), addresses[5]);
    assert.equal(await socialCausesLock.allocation(), 1_500_000_000n * unit);
    for (const lock of [communityLock, treasuryLock, socialCausesLock]) {
      assert.equal(await lock.unlockTimestamp(), startTimestamp + allocationLockDuration);
      assert.equal(await lock.released(), false);
    }
  });

  it("has no owner, mint, pause, or upgrade entry points", () => {
    const functionNames = tokenArtifact.abi
      .filter((item) => item.type === "function")
      .map((item) => item.name);
    for (const forbidden of ["owner", "mint", "pause", "upgradeTo"]) {
      assert.equal(functionNames.includes(forbidden), false, `${forbidden} must not exist`);
    }
  });

  it("allows ordinary transfers without a token tax", async () => {
    const before = await token.balanceOf(addresses[2]);
    const amount = 10n * unit;
    await (await token.connect(signers[2]).transfer(addresses[7], amount)).wait();
    assert.equal(await token.balanceOf(addresses[2]), before - amount);
    assert.equal(await token.balanceOf(addresses[7]), amount);
  });

  it("rejects zero-value transfers and delegated transfers but allows a positive 1-wei transfer", async () => {
    await assert.rejects(async () => (await token.connect(signers[2]).transfer(addresses[7], 0n)).wait());

    await (await token.connect(signers[2]).approve(addresses[0], 1n)).wait();
    await assert.rejects(async () => (await token.connect(signers[0]).transferFrom(addresses[2], addresses[7], 0n)).wait());

    const recipientBefore = await token.balanceOf(addresses[7]);
    await (await token.connect(signers[2]).transfer(addresses[7], 1n)).wait();
    assert.equal(await token.balanceOf(addresses[7]), recipientBefore + 1n);
  });

  it("blocks community, treasury, and social-causes claims until year 3, then unlocks to each beneficiary", async () => {
    const unlockTimestamp = startTimestamp + allocationLockDuration;
    await advanceTo(unlockTimestamp - 1n);

    for (const [lock, beneficiary] of [
      [communityLock, addresses[3]],
      [treasuryLock, addresses[4]],
      [socialCausesLock, addresses[5]],
    ]) {
      await assert.rejects(async () => (await lock.release({ gasLimit: 500_000n })).wait());
      await assert.rejects(async () => (await lock.connect(signers[7]).release({ gasLimit: 500_000n })).wait());
      assert.equal(await token.balanceOf(beneficiary), 0n);
    }

    await advanceTo(unlockTimestamp);
    for (const [lock, beneficiary, amount] of [
      [communityLock, addresses[3], 500_000_000n * unit],
      [treasuryLock, addresses[4], 1_000_000_000n * unit],
      [socialCausesLock, addresses[5], 1_500_000_000n * unit],
    ]) {
      await (await lock.release({ gasLimit: 500_000n })).wait();
      assert.equal(await token.balanceOf(beneficiary), amount);
      assert.equal(await lock.released(), true);
      await assert.rejects(async () => (await lock.release({ gasLimit: 500_000n })).wait());
    }

    const beforeTransfer = await token.balanceOf(addresses[7]);
    await (await token.connect(signers[3]).transfer(addresses[7], unit)).wait();
    assert.equal(await token.balanceOf(addresses[7]), beforeTransfer + unit);
  });

  it("vests nothing through the 15-year cliff, then accrues linearly to the full allocation at year 20", async () => {
    const cliffEnd = startTimestamp + cliffDuration;
    const vestingEnd = cliffEnd + vestingDuration;
    assert.equal(await vesting.vestedAmount(cliffEnd - 1n), 0n);
    assert.equal(await vesting.vestedAmount(cliffEnd), 0n);
    assert.equal(await vesting.vestedAmount(cliffEnd + vestingDuration / 2n), founderAllocation / 2n);
    assert.equal(await vesting.vestedAmount(vestingEnd), founderAllocation);
  });

  it("blocks early and third-party claims, then lets only the beneficiary claim accrued tokens", async () => {
    const cliffEnd = startTimestamp + cliffDuration;
    await advanceTo(cliffEnd - 1n);
    const beforeCliff = BigInt(
      (await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp,
    );
    assert.ok(beforeCliff < cliffEnd);
    await assert.rejects(async () => (await vesting.release({ gasLimit: 500_000n })).wait());

    await advanceTo(cliffEnd + 365n * 24n * 60n * 60n);
    const afterCliff = BigInt(
      (await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] })).timestamp,
    );
    assert.ok(afterCliff >= cliffEnd + 365n * 24n * 60n * 60n);
    const availableAtYear16 = await vesting.releasableAmount();
    assert.ok(availableAtYear16 > 0n, `expected vested tokens by year 16; available=${availableAtYear16}`);
    await assert.rejects(async () => (await vesting.connect(signers[7]).release({ gasLimit: 500_000n })).wait());

    const receipt = await (await vesting.release({ gasLimit: 500_000n })).wait();
    const releaseBlock = await chain.getBlock(receipt.blockNumber);
    const vestedAtRelease = await vesting.vestedAmount(BigInt(releaseBlock.timestamp));
    assert.equal(await vesting.released(), vestedAtRelease);
    assert.equal(await token.balanceOf(addresses[6]), vestedAtRelease);
    assert.ok(vestedAtRelease > 0n);
    assert.ok(vestedAtRelease < founderAllocation);

    await advanceTo(cliffEnd + vestingDuration);
    assert.equal(await vesting.vestedAmount(cliffEnd + vestingDuration), founderAllocation);
    await (await vesting.release({ gasLimit: 500_000n })).wait();
    assert.equal(await vesting.released(), founderAllocation);
    assert.equal(await token.balanceOf(addresses[6]), founderAllocation);
    assert.equal(await token.balanceOf(await token.founderVesting()), 0n);
  });

  it("rejects zero and duplicate allocation recipients", async () => {
    const factory = new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, signers[0]);
    await assert.rejects(
      factory.deploy(addresses[1], addresses[2], addresses[3], addresses[4], addresses[5], "0x0000000000000000000000000000000000000000"),
    );
    await assert.rejects(
      factory.deploy(addresses[1], addresses[1], addresses[3], addresses[4], addresses[5], addresses[6]),
    );
  });
});
