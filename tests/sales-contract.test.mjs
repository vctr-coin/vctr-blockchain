import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import ganache from "ganache";
import {
  AbiCoder,
  BrowserProvider,
  Contract,
  ContractFactory,
  Wallet,
  id,
  keccak256,
} from "ethers";
import solc from "solc";

const root = process.cwd();
const UNIT = 10n ** 18n;
const USDC_UNIT = 10n ** 6n;
const PRICE_MICRO = 18_095n;
const MIN_PURCHASE = 100n * UNIT;
const MAX_SALE = 3_000_000_000n * UNIT;
const DAY = 24n * 60n * 60n;
const NOTICE = 30n * DAY;

const mockTokenSource = `
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract MockToken is ERC20 {
    uint8 private immutable tokenDecimals;
    mapping(address => bool) public blocked;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { tokenDecimals = d; }
    function decimals() public view override returns (uint8) { return tokenDecimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function setBlocked(address account, bool value) external { blocked[account] = value; }
    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        super._update(from, to, amount);
    }
}`;

function compileContracts() {
  const sources = {
    "contracts/VCTRSale.sol": {
      content: fs.readFileSync(path.join(root, "contracts/VCTRSale.sol"), "utf8"),
    },
    "contracts/VCTRToken.sol": {
      content: fs.readFileSync(path.join(root, "contracts/VCTRToken.sol"), "utf8"),
    },
    "contracts/FounderVesting.sol": {
      content: fs.readFileSync(path.join(root, "contracts/FounderVesting.sol"), "utf8"),
    },
    "contracts/AllocationTimelock.sol": {
      content: fs.readFileSync(path.join(root, "contracts/AllocationTimelock.sol"), "utf8"),
    },
    "tests/MockToken.sol": { content: mockTokenSource },
  };
  const input = {
    language: "Solidity",
    sources,
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
        return fs.existsSync(sourcePath)
          ? { contents: fs.readFileSync(sourcePath, "utf8") }
          : { error: `Missing import: ${importPath}` };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join("\n"));
  return {
    sale: output.contracts["contracts/VCTRSale.sol"].VCTRSale,
    mock: output.contracts["tests/MockToken.sol"].MockToken,
  };
}

let artifacts;
let rpc;
let provider;
let signers;
let wallets;
let addresses;
let vctr;
let usdc;
let sale;

const purchaseTypes = {
  PurchaseAuthorization: [
    { name: "buyer", type: "address" },
    { name: "vctrAmount", type: "uint256" },
    { name: "usdcAmount", type: "uint256" },
    { name: "referenceId", type: "bytes32" },
    { name: "nonce", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "splitVersion", type: "uint64" },
  ],
};
const controlTypes = {
  ControlApproval: [
    { name: "action", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "dataHash", type: "bytes32" },
  ],
};

async function timestamp() {
  const latest = await rpc.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  return BigInt(latest.timestamp);
}

async function advanceTime(seconds) {
  await rpc.request({ method: "evm_increaseTime", params: [Number(seconds)] });
  await rpc.request({ method: "evm_mine", params: [] });
}

function domain() {
  return {
    name: "VCTR Direct Sale",
    version: "1",
    chainId: 31337,
    verifyingContract: sale.target,
  };
}

async function makeAuthorization(options = {}) {
  const buyer = options.buyer ?? addresses[9];
  const amount = options.amount ?? MIN_PURCHASE;
  const usdcAmount = options.usdcAmount ?? (amount / UNIT) * PRICE_MICRO;
  const referenceId = options.referenceId ?? id(`reference-${Math.random()}`);
  const nonce = options.nonce ?? id(`nonce-${Math.random()}`);
  const deadline = options.deadline ?? (await timestamp()) + 300n;
  const splitVersion = options.splitVersion ?? (await sale.splitVersion());
  const signingWallet = options.signingWallet ?? wallets[3];
  const authorization = { buyer, vctrAmount: amount, usdcAmount, referenceId, nonce, deadline, splitVersion };
  const signature = await signingWallet.signTypedData(domain(), purchaseTypes, authorization);
  return { authorization, signature };
}

async function dualApproval(action, dataHash = `0x${"00".repeat(32)}`, signerPair = [wallets[1], wallets[2]]) {
  const deadline = (await timestamp()) + 3600n;
  const nonce = await sale.controlNonce();
  const message = { action, nonce, deadline, dataHash };
  const sellerSignature = await signerPair[0].signTypedData(domain(), controlTypes, message);
  const treasurySignature = await signerPair[1].signTypedData(domain(), controlTypes, message);
  return { deadline, sellerSignature, treasurySignature, message };
}

async function fundVctr(amount) {
  await (await vctr.mint(addresses[1], amount)).wait();
  await (await vctr.connect(signers[1]).approve(sale.target, amount)).wait();
  await (await sale.connect(signers[1]).fundInventory(amount)).wait();
}

async function prepareBuyer(neededUsdc) {
  await (await usdc.mint(addresses[9], neededUsdc)).wait();
  await (await usdc.connect(signers[9]).approve(sale.target, neededUsdc)).wait();
}

async function deploySale({ vctrDecimals = 18, usdcDecimals = 6, payoutWallets = null } = {}) {
  const tokenFactory = new ContractFactory(artifacts.mock.abi, artifacts.mock.evm.bytecode.object, signers[0]);
  vctr = await tokenFactory.deploy("VCTR", "VCTR", vctrDecimals);
  await vctr.waitForDeployment();
  usdc = await tokenFactory.deploy("USD Coin", "USDC", usdcDecimals);
  await usdc.waitForDeployment();
  const walletsArg = payoutWallets ?? addresses.slice(4, 6);
  const saleFactory = new ContractFactory(artifacts.sale.abi, artifacts.sale.evm.bytecode.object, signers[0]);
  sale = await saleFactory.deploy(vctr.target, usdc.target, addresses[1], addresses[2], addresses[3], walletsArg);
  await sale.waitForDeployment();
}

describe("VCTR direct sale on a temporary local EVM only", () => {
  before(() => {
    artifacts = compileContracts();
  });

  beforeEach(async () => {
    rpc = ganache.provider({
      logging: { quiet: true },
      chain: { chainId: 31337, hardfork: "shanghai" },
      wallet: { totalAccounts: 12, defaultBalance: 1000 },
    });
    provider = new BrowserProvider(rpc);
    signers = await Promise.all(Array.from({ length: 12 }, (_, i) => provider.getSigner(i)));
    addresses = await Promise.all(signers.map((signer) => signer.getAddress()));
    const accounts = rpc.getInitialAccounts();
    wallets = addresses.map((address) => new Wallet(accounts[address.toLowerCase()].secretKey));
    await deploySale();
  });

  afterEach(async () => {
    await rpc.disconnect();
  });

  it("sets fixed terms, initial TDS policy, and exact two-wallet quote", async () => {
    assert.equal(await sale.PRICE_USDC_MICRO_PER_VCTR(), PRICE_MICRO);
    assert.equal(await sale.MIN_PURCHASE(), MIN_PURCHASE);
    assert.equal(await sale.MAX_SALE(), MAX_SALE);
    assert.equal(await sale.MAX_PURCHASES(), 30_000_000n);
    assert.equal(await sale.successfulPurchaseCount(), 0n);
    assert.equal(await sale.totalSold(), 0n);
    assert.equal(await sale.paused(), false);
    assert.equal(await sale.closed(), false);
    const config = await sale.activeSplitConfig();
    assert.deepEqual(Array.from(config[0]), addresses.slice(4, 6));
    assert.equal(config[1], 100n);
    assert.equal(config[2], 1n);
    const quote = await sale.quote(MIN_PURCHASE);
    assert.deepEqual(Array.from(quote), [1_809_500n, 18_095n, 1_791_405n, 1n]);
    assert.equal(quote[1] + quote[2], quote[0]);
    await assert.rejects(sale.quote(99n * UNIT));
    await assert.rejects(sale.quote(MIN_PURCHASE + 1n));
  });

  it("stages inventory and atomically completes an authorized purchase with TDS and Sales payouts", async () => {
    const amount = 100n * UNIT;
    const gross = 1_809_500n;
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(gross);
    const beforeBalances = await Promise.all(addresses.slice(4, 6).map((address) => usdc.balanceOf(address)));
    const { authorization, signature } = await makeAuthorization({ amount });
    const receipt = await (await sale.connect(signers[9]).buy(authorization, signature)).wait();

    assert.equal(await vctr.balanceOf(addresses[9]), amount);
    assert.equal(await usdc.balanceOf(addresses[9]), 0n);
    assert.equal(await sale.totalSold(), amount);
    assert.equal(await sale.accountedInventory(), 900n * UNIT);
    assert.equal(await sale.successfulPurchaseCount(), 1n);
    assert.equal(await sale.usedNonces(authorization.nonce), true);
    assert.equal(await sale.usedReferences(authorization.referenceId), true);
    assert.deepEqual(
      await Promise.all(addresses.slice(4, 6).map((address) => usdc.balanceOf(address))),
      beforeBalances.map((balance, index) => balance + [18_095n, 1_791_405n][index]),
    );
    assert.equal(await usdc.balanceOf(sale.target), 0n);
    const purchaseLog = receipt.logs.map((log) => {
      try { return sale.interface.parseLog(log); } catch { return null; }
    }).find((log) => log?.name === "PurchaseCompleted");
    assert.ok(purchaseLog);
    assert.equal(purchaseLog.args.referenceId, authorization.referenceId);
    assert.equal(purchaseLog.args.salesAmount, 1_791_405n);
  });

  it("allows Seller to withdraw only whole, accounted unsold VCTR while paused", async () => {
    await fundVctr(500n * UNIT);
    const sellerBefore = await vctr.balanceOf(addresses[1]);
    await assert.rejects(sale.connect(signers[1]).withdrawInventory(100n * UNIT));
    const pauseApproval = await dualApproval((await sale.controlActionHashes())[0]);
    await (await sale.pause(pauseApproval.deadline, pauseApproval.sellerSignature, pauseApproval.treasurySignature)).wait();
    await assert.rejects(sale.connect(signers[8]).withdrawInventory(100n * UNIT));
    await assert.rejects(sale.connect(signers[1]).withdrawInventory(501n * UNIT));
    await assert.rejects(sale.connect(signers[1]).withdrawInventory(1n));
    await (await sale.connect(signers[1]).withdrawInventory(125n * UNIT)).wait();
    assert.equal(await sale.accountedInventory(), 375n * UNIT);
    assert.equal(await vctr.balanceOf(addresses[1]), sellerBefore + 125n * UNIT);
    assert.equal(await vctr.balanceOf(sale.target), 375n * UNIT);
  });

  it("rejects unauthorized, altered, wrong-caller, under-minimum, fractional, and wrong-price purchases", async () => {
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(10_000_000n);
    const valid = await makeAuthorization({ amount: MIN_PURCHASE });
    await assert.rejects(sale.connect(signers[9]).buy(valid.authorization, "0x"));
    await assert.rejects(sale.connect(signers[8]).buy(valid.authorization, valid.signature));

    const underMinimum = await makeAuthorization({ amount: 99n * UNIT });
    await assert.rejects(sale.connect(signers[9]).buy(underMinimum.authorization, underMinimum.signature));
    const fractional = await makeAuthorization({ amount: MIN_PURCHASE + 1n });
    await assert.rejects(sale.connect(signers[9]).buy(fractional.authorization, fractional.signature));
    const wrongPrice = await makeAuthorization({ amount: MIN_PURCHASE, usdcAmount: 1n });
    await assert.rejects(sale.connect(signers[9]).buy(wrongPrice.authorization, wrongPrice.signature));

    const altered = { ...valid.authorization, referenceId: id("changed-after-signing") };
    await assert.rejects(sale.connect(signers[9]).buy(altered, valid.signature));
    assert.equal(await sale.successfulPurchaseCount(), 0n);
  });

  it("enforces permit expiry, maximum lifetime, nonce replay, reference uniqueness, and version binding", async () => {
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(20_000_000n);
    const expired = await makeAuthorization({ deadline: (await timestamp()) - 1n });
    await assert.rejects(sale.connect(signers[9]).buy(expired.authorization, expired.signature));
    const tooLong = await makeAuthorization({ deadline: (await timestamp()) + 601n });
    await assert.rejects(sale.connect(signers[9]).buy(tooLong.authorization, tooLong.signature));
    const oldVersion = await makeAuthorization({ splitVersion: 0n });
    await assert.rejects(sale.connect(signers[9]).buy(oldVersion.authorization, oldVersion.signature));

    const first = await makeAuthorization({ referenceId: id("same-ref"), nonce: id("nonce-a") });
    await (await sale.connect(signers[9]).buy(first.authorization, first.signature)).wait();
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[9]).buy(first.authorization, first.signature);
      await tx.wait();
    });
    const duplicateRef = await makeAuthorization({ referenceId: id("same-ref"), nonce: id("nonce-b") });
    await assert.rejects(sale.connect(signers[9]).buy(duplicateRef.authorization, duplicateRef.signature));
    const zeroNonce = await makeAuthorization({ nonce: `0x${"00".repeat(32)}` });
    await assert.rejects(sale.connect(signers[9]).buy(zeroNonce.authorization, zeroNonce.signature));
    assert.equal(await sale.successfulPurchaseCount(), 1n);
  });

  it("rejects non-Seller and fractional deposits, over-cap inventory, and unaccounted direct VCTR as sale stock", async () => {
    await (await vctr.mint(addresses[1], 1_000n * UNIT)).wait();
    await (await vctr.connect(signers[1]).approve(sale.target, 1_000n * UNIT)).wait();
    await assert.rejects(sale.connect(signers[8]).fundInventory(100n * UNIT));
    await assert.rejects(sale.connect(signers[1]).fundInventory(100n * UNIT + 1n));
    await (await sale.connect(signers[1]).fundInventory(1_000n * UNIT)).wait();
    await assert.rejects(sale.connect(signers[1]).fundInventory(1n));
    await (await vctr.mint(addresses[9], 100n * UNIT)).wait();
    await (await vctr.connect(signers[9]).transfer(sale.target, 100n * UNIT)).wait();
    assert.equal(await sale.accountedInventory(), 1_000n * UNIT);
    assert.equal(await vctr.balanceOf(sale.target), 1_100n * UNIT);
    const accidentalAction = (await sale.controlActionHashes())[5];
    const accidentalApproval = await dualApproval(accidentalAction, keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [100n * UNIT, addresses[1]])));
    await assert.rejects(sale.connect(signers[8]).recoverUnsolicitedVctr(
      1_000n * UNIT,
      accidentalApproval.deadline,
      accidentalApproval.sellerSignature,
      accidentalApproval.treasurySignature,
    ));
    await (await sale.connect(signers[8]).recoverUnsolicitedVctr(
      100n * UNIT,
      accidentalApproval.deadline,
      accidentalApproval.sellerSignature,
      accidentalApproval.treasurySignature,
    )).wait();
    assert.equal(await sale.accountedInventory(), 1_000n * UNIT);
    assert.equal(await vctr.balanceOf(sale.target), 1_000n * UNIT);

    await prepareBuyer(1_809_500n);
    const auth = await makeAuthorization({ amount: 1_100n * UNIT });
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[9]).buy(auth.authorization, auth.signature);
      await tx.wait();
    });
    assert.equal(await sale.totalSold(), 0n);
  });

  it("sells no more than 3 billion VCTR and auto-closes at the supply cap", async () => {
    await fundVctr(MAX_SALE);
    const gross = (MAX_SALE / UNIT) * PRICE_MICRO;
    await prepareBuyer(gross);
    const auth = await makeAuthorization({ amount: MAX_SALE });
    await (await sale.connect(signers[9]).buy(auth.authorization, auth.signature)).wait();
    assert.equal(await sale.totalSold(), MAX_SALE);
    assert.equal(await sale.successfulPurchaseCount(), 1n);
    assert.equal(await sale.closed(), true);
    assert.equal(await sale.accountedInventory(), 0n);
    assert.equal(await vctr.balanceOf(addresses[9]), MAX_SALE);
    await assert.rejects(sale.connect(signers[1]).fundInventory(UNIT));
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[9]).buy(auth.authorization, auth.signature);
      await tx.wait();
    });
  });

  it("requires both Seller and Project Treasury signatures to pause and resume", async () => {
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(1_809_500n);
    const actions = await sale.controlActionHashes();
    const pauseApproval = await dualApproval(actions[0]);
    await assert.rejects(
      sale.connect(signers[8]).pause(pauseApproval.deadline, pauseApproval.sellerSignature, "0x"),
    );
    await assert.rejects(
      sale.connect(signers[8]).pause(pauseApproval.deadline, pauseApproval.treasurySignature, pauseApproval.sellerSignature),
    );
    await (await sale.connect(signers[8]).pause(
      pauseApproval.deadline,
      pauseApproval.sellerSignature,
      pauseApproval.treasurySignature,
    )).wait();
    assert.equal(await sale.paused(), true);
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[8]).pause(pauseApproval.deadline, pauseApproval.sellerSignature, pauseApproval.treasurySignature);
      await tx.wait();
    });
    const auth = await makeAuthorization();
    await assert.rejects(sale.connect(signers[9]).buy(auth.authorization, auth.signature));

    const resumeApproval = await dualApproval(actions[1]);
    await (await sale.connect(signers[8]).resume(
      resumeApproval.deadline,
      resumeApproval.sellerSignature,
      resumeApproval.treasurySignature,
    )).wait();
    assert.equal(await sale.paused(), false);
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[8]).resume(resumeApproval.deadline, resumeApproval.sellerSignature, resumeApproval.treasurySignature);
      await tx.wait();
    });
    assert.equal(await sale.controlNonce(), 2n);
  });

  it("requires both signatures to terminate, returns staged and unaccounted VCTR, and permanently blocks sales", async () => {
    await fundVctr(1_000n * UNIT);
    await (await vctr.mint(addresses[8], 7n * UNIT)).wait();
    await (await vctr.connect(signers[8]).transfer(sale.target, 7n * UNIT)).wait();
    await (await usdc.mint(addresses[8], 25_000n)).wait();
    await (await usdc.connect(signers[8]).transfer(sale.target, 25_000n)).wait();
    const before = await vctr.balanceOf(addresses[1]);
    const sellerUsdcBefore = await usdc.balanceOf(addresses[1]);
    const action = (await sale.controlActionHashes())[2];
    const approval = await dualApproval(action);
    await assert.rejects(sale.connect(signers[8]).terminate(approval.deadline, approval.sellerSignature, "0x"));
    await (await sale.connect(signers[8]).terminate(
      approval.deadline,
      approval.sellerSignature,
      approval.treasurySignature,
    )).wait();
    assert.equal(await sale.closed(), true);
    assert.equal(await sale.paused(), true);
    assert.equal(await sale.accountedInventory(), 0n);
    assert.equal(await vctr.balanceOf(addresses[1]), before + 1_007n * UNIT);
    assert.equal(await vctr.balanceOf(sale.target), 0n);
    assert.equal(await usdc.balanceOf(addresses[1]), sellerUsdcBefore);
    assert.equal(await usdc.balanceOf(sale.target), 25_000n);
    const usdcAction = (await sale.controlActionHashes())[4];
    const recoveryData = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [25_000n, addresses[1]]));
    const recoveryApproval = await dualApproval(usdcAction, recoveryData);
    await (await sale.connect(signers[8]).recoverUnsolicitedUsdc(
      25_000n,
      recoveryApproval.deadline,
      recoveryApproval.sellerSignature,
      recoveryApproval.treasurySignature,
    )).wait();
    assert.equal(await usdc.balanceOf(addresses[1]), sellerUsdcBefore + 25_000n);
    assert.equal(await usdc.balanceOf(sale.target), 0n);
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[8]).terminate(approval.deadline, approval.sellerSignature, approval.treasurySignature);
      await tx.wait();
    });
    await assert.rejects(sale.connect(signers[1]).fundInventory(UNIT));
  });

  it("schedules, cancels, activates, and applies TDS changes only after 30 days", async () => {
    const walletsNext = addresses.slice(6, 8);
    const effectiveAt = (await timestamp()) + NOTICE + 120n;
    await assert.rejects(sale.connect(signers[8]).scheduleSplit(walletsNext, 200, effectiveAt));
    await assert.rejects(sale.connect(signers[1]).scheduleSplit(walletsNext, 200, (await timestamp()) + NOTICE - 1n));
    await assert.rejects(sale.connect(signers[1]).scheduleSplit(walletsNext, 10_000, effectiveAt));
    await assert.rejects(sale.connect(signers[1]).scheduleSplit(walletsNext, 10_001, effectiveAt));
    await (await sale.connect(signers[1]).scheduleSplit(walletsNext, 200, effectiveAt)).wait();
    await assert.rejects(sale.connect(signers[1]).scheduleSplit(walletsNext, 200, effectiveAt + NOTICE));
    const pending = await sale.pendingSplitConfig();
    assert.equal(pending[0], true);
    assert.deepEqual(Array.from(pending[1]), walletsNext);
    assert.equal(pending[2], 200n);
    assert.equal(pending[3], effectiveAt);
    await assert.rejects(sale.activateScheduledSplit());
    await (await sale.connect(signers[1]).cancelScheduledSplit()).wait();
    assert.equal((await sale.pendingSplitConfig())[0], false);
    await assert.rejects(async () => {
      const tx = await sale.connect(signers[1]).cancelScheduledSplit();
      await tx.wait();
    });

    const nextEffectiveAt = (await timestamp()) + NOTICE + 120n;
    await (await sale.connect(signers[1]).scheduleSplit(walletsNext, 200, nextEffectiveAt)).wait();
    await advanceTime(NOTICE + 3_600n);
    assert.ok((await timestamp()) >= nextEffectiveAt, `now=${await timestamp()} effective=${nextEffectiveAt}`);
    await (await sale.activateScheduledSplit({ gasLimit: 250_000n })).wait();
    const active = await sale.activeSplitConfig();
    assert.deepEqual(Array.from(active[0]), walletsNext);
    assert.equal(active[1], 200n);
    assert.equal(active[2], 2n);
    await assert.rejects(sale.activateScheduledSplit());

    await fundVctr(1_000n * UNIT);
    await prepareBuyer(3_619_000n);
    const auth = await makeAuthorization({ splitVersion: 2n });
    const before = await Promise.all(walletsNext.map((address) => usdc.balanceOf(address)));
    await (await sale.connect(signers[9]).buy(auth.authorization, auth.signature)).wait();
    const after = await Promise.all(walletsNext.map((address) => usdc.balanceOf(address)));
    assert.deepEqual(after.map((value, i) => value - before[i]), [36_190n, 1_773_310n]);
  });

  it("binds quote and EIP-712 digests to this local chain and contract", async () => {
    const auth = await makeAuthorization();
    const onchain = await sale.purchaseDigest(auth.authorization);
    const { TypedDataEncoder } = await import("ethers");
    assert.equal(TypedDataEncoder.hash(domain(), purchaseTypes, auth.authorization), onchain);
    const actions = await sale.controlActionHashes();
    const approval = await dualApproval(actions[0]);
    const onchainControlDigest = await sale.controlDigest(actions[0], `0x${"00".repeat(32)}`, approval.deadline);
    assert.equal(TypedDataEncoder.hash(domain(), controlTypes, approval.message), onchainControlDigest);
  });

  it("dual-approves authorization-signer rotation and accepts only the new signer afterward", async () => {
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(3_619_000n);
    const newSigner = addresses[10];
    const effectiveAt = (await timestamp()) + NOTICE + 120n;
    const dataHash = keccak256(AbiCoder.defaultAbiCoder().encode(["address", "uint64"], [newSigner, effectiveAt]));
    const action = (await sale.controlActionHashes())[3];
    const approval = await dualApproval(action, dataHash);
    await assert.rejects(sale.connect(signers[8]).scheduleAuthorizationSigner(
      newSigner, effectiveAt, approval.deadline, approval.sellerSignature, "0x",
    ));
    await (await sale.connect(signers[8]).scheduleAuthorizationSigner(
      newSigner,
      effectiveAt,
      approval.deadline,
      approval.sellerSignature,
      approval.treasurySignature,
    )).wait();
    assert.equal(await sale.authorizationSigner(), addresses[3]);
    await assert.rejects(async () => {
      const tx = await sale.activateAuthorizationSigner();
      await tx.wait();
    });
    assert.equal(await sale.pendingAuthorizationSigner(), newSigner);
    assert.equal(await sale.pendingAuthorizationSignerAt(), BigInt(effectiveAt));
    const oldPermit = await makeAuthorization({ signingWallet: wallets[3] });
    await (await sale.connect(signers[9]).buy(oldPermit.authorization, oldPermit.signature)).wait();
    const signerChangeAt = await sale.pendingAuthorizationSignerAt();
    const currentTime = await timestamp();
    await advanceTime((signerChangeAt > currentTime ? signerChangeAt - currentTime : 0n) + 3_600n);
    assert.ok((await timestamp()) >= BigInt(effectiveAt));
    await (await sale.activateAuthorizationSigner({ gasLimit: 250_000n })).wait();
    assert.equal(await sale.authorizationSigner(), newSigner);
    const oldAfterRotation = await makeAuthorization({ signingWallet: wallets[3] });
    await assert.rejects(sale.connect(signers[9]).buy(oldAfterRotation.authorization, oldAfterRotation.signature));
    const newPermit = await makeAuthorization({ signingWallet: wallets[10] });
    await (await sale.connect(signers[9]).buy(newPermit.authorization, newPermit.signature)).wait();
  });

  it("recovers only accidentally transferred USDC to the fixed Seller with both signatures", async () => {
    const amount = 50_000n;
    await (await usdc.mint(addresses[9], amount)).wait();
    await (await usdc.connect(signers[9]).transfer(sale.target, amount)).wait();
    assert.equal(await usdc.balanceOf(sale.target), amount);
    assert.equal(await sale.successfulPurchaseCount(), 0n);
    assert.equal(await vctr.balanceOf(addresses[9]), 0n);
    const sellerBefore = await usdc.balanceOf(addresses[1]);
    const dataHash = keccak256(AbiCoder.defaultAbiCoder().encode(["uint256", "address"], [amount, addresses[1]]));
    const action = (await sale.controlActionHashes())[4];
    const approval = await dualApproval(action, dataHash);
    await assert.rejects(sale.connect(signers[8]).recoverUnsolicitedUsdc(amount, approval.deadline, approval.sellerSignature, "0x"));
    await (await sale.connect(signers[8]).recoverUnsolicitedUsdc(
      amount,
      approval.deadline,
      approval.sellerSignature,
      approval.treasurySignature,
    )).wait();
    assert.equal(await usdc.balanceOf(sale.target), 0n);
    assert.equal(await usdc.balanceOf(addresses[1]), sellerBefore + amount);
    assert.equal(await sale.successfulPurchaseCount(), 0n);
  });

  it("rolls back the complete purchase if either USDC payout fails", async () => {
    const amount = MIN_PURCHASE;
    await fundVctr(1_000n * UNIT);
    await prepareBuyer(1_809_500n);
    const auth = await makeAuthorization({ amount });
    const buyerUsdcBefore = await usdc.balanceOf(addresses[9]);

    await (await usdc.setBlocked(addresses[4], true)).wait();
    await assert.rejects(sale.connect(signers[9]).buy(auth.authorization, auth.signature));
    await (await usdc.setBlocked(addresses[4], false)).wait();
    await (await usdc.setBlocked(addresses[5], true)).wait();
    await assert.rejects(sale.connect(signers[9]).buy(auth.authorization, auth.signature));

    assert.equal(await sale.successfulPurchaseCount(), 0n);
    assert.equal(await sale.totalSold(), 0n);
    assert.equal(await sale.usedNonces(auth.authorization.nonce), false);
    assert.equal(await sale.accountedInventory(), 1_000n * UNIT);
    assert.equal(await vctr.balanceOf(addresses[9]), 0n);
    assert.equal(await usdc.balanceOf(addresses[9]), buyerUsdcBefore);
    assert.equal(await usdc.balanceOf(sale.target), 0n);
  });

  it("does not exceed inventory or sale limits when deposit or payment is insufficient", async () => {
    await fundVctr(100n * UNIT);
    await prepareBuyer(1_809_500n);
    const auth = await makeAuthorization({ amount: 200n * UNIT });
    await assert.rejects(sale.connect(signers[9]).buy(auth.authorization, auth.signature));
    await assert.rejects(sale.connect(signers[1]).fundInventory(MAX_SALE));
    assert.equal(await sale.totalSold(), 0n);
  });

  it("validates token decimals, distinct initial signers and distinct payout wallets", async () => {
    await assert.rejects(deploySale({ vctrDecimals: 6 }));
    await assert.rejects(deploySale({ usdcDecimals: 18 }));
    const duplicateWallets = [...addresses.slice(4, 6)];
    duplicateWallets[1] = duplicateWallets[0];
    const tokenFactory = new ContractFactory(artifacts.mock.abi, artifacts.mock.evm.bytecode.object, signers[0]);
    const tokenA = await tokenFactory.deploy("VCTR", "VCTR", 18);
    const tokenB = await tokenFactory.deploy("USDC", "USDC", 6);
    await tokenA.waitForDeployment();
    await tokenB.waitForDeployment();
    const saleFactory = new ContractFactory(artifacts.sale.abi, artifacts.sale.evm.bytecode.object, signers[0]);
    await assert.rejects(saleFactory.deploy(tokenA.target, tokenB.target, addresses[1], addresses[2], addresses[3], duplicateWallets));
    await assert.rejects(saleFactory.deploy(tokenA.target, tokenB.target, addresses[1], addresses[1], addresses[3], addresses.slice(4, 6)));
  });
});
