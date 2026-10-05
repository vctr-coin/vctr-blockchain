# VCTR AI Token

Fixed-supply ERC-20 development project for a planned Base launch. **This is not
ready for Base Mainnet deployment. Contracts compile and local EVM tests cover
the allocation and lock behavior. A public Ethereum Sepolia test deployment
has been made; nothing has been deployed to Base Sepolia or Base Mainnet.

## Token behavior

- Name: `VCTR AI Token`; symbol: `VCTR`; decimals: 18; supply: 10 billion.
- No owner, post-deployment mint, pause, upgrade, transfer tax, or blacklist.
- Zero-value `transfer` and `transferFrom` calls revert; any positive amount is allowed, down to 1 wei.
- Founder allocation: 3 billion tokens held by `FounderVesting`. It has a
  15 × 365-day cliff followed by continuous linear vesting over 5 × 365 days.
  Only the beneficiary can claim accrued tokens.
- Community and ecosystem: 500 million; project treasury: 1 billion; social
  causes: 1.5 billion. Each allocation is held in a separate immutable
  `AllocationTimelock`, and only its named beneficiary may claim it after
  3 × 365 days from the token deployment timestamp.
- Liquidity reserve: 1 billion tokens sent to its designated wallet. The
  amount and pair used for any initial pool are not yet selected.
- Direct sales: 3 billion tokens sent to the Seller wallet. Publish sale terms
  before selling; unsold tokens remain unsold.

All allocation destinations are constructor inputs. A wrong destination cannot
be changed after deployment. Locked allocations are not automatically
transferred: the beneficiary must call the relevant `release()` function after
the cliff. The vesting and timelock contracts have no admin or recovery path.

## Build and test locally

From this directory, with Node.js and the pinned pnpm dependencies available:

```sh
pnpm install --frozen-lockfile
pnpm run compile:contracts
pnpm run test:evm
```

Tests use a temporary local EVM with simulated accounts, funds, and time. They
do not submit network transactions or spend real ETH.

The Foundry invariant suite requires Foundry to be installed and runs with:

```sh
forge test
```

It fuzzes bounded sequences of transfers, delegated transfers, time advances,
and vesting/timelock claims. The invariants check that total supply and tracked
balances remain conserved, founder releases never exceed accrued vesting, and
allocation locks never release early or lose their locked amounts. The default
campaign uses 128 runs at depth 128.

## Sepolia test deployment

The deployment helper supports Ethereum Sepolia, Base Sepolia, and Base
Mainnet. Testnet deployments check the selected chain ID, print all six
allocation recipients, estimate gas, and require typed confirmations. Run
`npm run deploy:ethereum-sepolia` for Ethereum Sepolia or
`npm run deploy:base-sepolia` for Base Sepolia; the legacy
`npm run deploy:sepolia` command still selects Base Sepolia by default.

VCTR was deployed to **Ethereum Sepolia** (chain ID 11155111) at
`0xB43557D42e54875D1526A35317727dE338dfD2ee` in transaction
[`0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82`](https://sepolia.etherscan.io/tx/0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82).
The [deployment report](deployments/ethereum-sepolia.json) records the founder
vesting contract, all three allocation locks, recipients, and unlock times.
Run `npm run verify:ethereum-sepolia` to check the confirmed receipt, bytecode,
metadata, total supply, balances, lock schedules, early-claim reverts, and
zero/positive transfer simulations against the public chain. The simulations
use `eth_call` and do not modify chain state; local EVM tests cover actual token
transfers and claims.

Ethereum Sepolia is a distinct network from Base. The user has chosen to waive
the Base Sepolia rehearsal after testing on Ethereum Sepolia. This means the
Base RPC and explorer flow has not been rehearsed on a public testnet. Before
any Base Mainnet transaction, the script checks chain ID 8453 and the
read-only verifier can validate the deployed values against the selected
network and tokenomics file. Testnet ETH and VCTR have no real-world value.

Testnet deployments read `DEPLOYER_PRIVATE_KEY` from the ignored local `.env`;
use only a dedicated test-only account. Base Mainnet requires the separate
`BASE_MAINNET_DEPLOYER_PRIVATE_KEY`, verifies the RPC reports chain ID 8453,
checks that the wallet can cover the estimated gas limit at the current max
fee, waits for five confirmations, and asks for three exact typed confirmations
(recipient addresses, network name, and irreversible real-ETH deployment).
It also requires `BASE_MAINNET_APPROVED_COMMIT` to equal the full current Git
commit hash and rejects a dirty working tree, binding deployment to the
reviewed release snapshot. Use a separate deployment-only key and never put a
recovery phrase or a production wallet key in source control or chat. Mainnet
support is implemented but has **not** been used to deploy. The helper writes
a deployment record to `deployments/base-mainnet.json` only after the
transaction confirms.

After a Base Mainnet deployment, run `npm run verify:base-mainnet`. This is a
read-only on-chain check of the receipt, metadata, supply, allocation balances,
recipient addresses, lock schedules, early-claim reverts, and transfer behavior.
It does not publish source code to BaseScan; source verification on BaseScan is
a separate required launch step. Base chain ID 8453 is documented by [Base's
`eth_chainId` reference](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId).

## Remaining before Mainnet

- Complete an independent Solidity review of the final source and resolve or
  explicitly accept all findings. The public [review request](SECURITY_REVIEW_REQUEST.md)
  pins the current contract scope and lists requested evidence.
- Base Sepolia rehearsal is waived by the user after Ethereum Sepolia testing.
  Accept that Base-specific RPC and explorer configuration is not testnet
  rehearsed; the deployment helper's chain-ID guard and post-deployment checks
  do not replace a Base Sepolia rehearsal.
- Finalize whether to provide initial liquidity. The ₹5,000 figure is
  tentative at-risk capital, not an approved deposit; confirm the pair, VCTR
  amount, LP-position custody, and budget at that time.
- Finalize direct-sale terms and publish accurate allocation, lock, and risk
  disclosures before any sale or public launch.
- Complete the independent review before any Mainnet transaction. The helper
  supports Base Mainnet but has not been run; use the separate key, review the
  live gas estimate and all six recipients, then verify source on BaseScan.
- Reconcile the reviewed source, compiler settings, constructor addresses,
  deployment result, and final public documentation before launch.

The optional `local_tool` FastAPI app is an arithmetic-only allocation checker;
it does not connect to a blockchain or affect contract behavior.
