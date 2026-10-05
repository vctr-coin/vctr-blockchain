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

The testnet-only deploy helper supports Ethereum Sepolia and Base Sepolia. It
checks the selected chain ID, prints all six allocation recipients, asks for
address confirmation, estimates test-ETH cost, and requires a separate typed
confirmation before sending. To choose Ethereum Sepolia, run
`npm run deploy:ethereum-sepolia`; Base Sepolia remains the default for
`npm run deploy:sepolia`.

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

Ethereum Sepolia is a distinct network from Base Sepolia. This deployment
validates the contracts on a public EVM testnet but does not validate Base's
RPC, chain selection, or explorer configuration. The deployment uses test ETH
and VCTR with no real-world value.

The script reads `DEPLOYER_PRIVATE_KEY` from the ignored local `.env`. Use only
a dedicated test-only account with no real assets; never put a recovery phrase
or a production wallet key in `.env`, and never share secrets in chat. Base
Sepolia deployment is optional for local development but remains a project
readiness gate before any Mainnet release. A Base Sepolia rehearsal remains a
separate readiness item before a Base Mainnet release.

## Remaining before Mainnet

- Complete an independent Solidity review of the final source and resolve or
  explicitly accept all findings. The public [review request](SECURITY_REVIEW_REQUEST.md)
  pins the current contract scope and lists requested evidence.
- Deploy and verify the reviewed token and child-contract sources on Base
  Sepolia, or explicitly document the risks accepted if that rehearsal is
  skipped.
- Finalize whether to provide initial liquidity. The ₹5,000 figure is
  tentative at-risk capital, not an approved deposit; confirm the pair, VCTR
  amount, LP-position custody, and budget at that time.
- Finalize direct-sale terms and publish accurate allocation, lock, and risk
  disclosures before any sale or public launch.
- Prepare a Mainnet deployment and source-verification procedure with secure
  signing-key custody. The current script does not support Base Mainnet.
- Reconcile the reviewed source, compiler settings, constructor addresses,
  deployment result, and final public documentation before launch.

The optional `local_tool` FastAPI app is an arithmetic-only allocation checker;
it does not connect to a blockchain or affect contract behavior.
