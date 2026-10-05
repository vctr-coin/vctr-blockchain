# VCTR AI Token

VCTR AI Token is a fixed-supply ERC-20 designed for deployment on Base. Its product vision is to support an autonomous AI-to-AI economy where agents can pay for compute and license vector embeddings or synthetic datasets, with the potential for very small payments and machine-readable settlement.

**That product vision is not a claim about features currently implemented.** The deployed contract is a token and allocation-lock system only. It does not implement an AI-agent protocol, marketplace, compute purchasing, dataset licensing, zero-knowledge proofs, sub-millisecond finality, or fiat-denominated payment guarantees. Those capabilities require separate systems, integrations, and independent evaluation. VCTR does not eliminate Base network fees, confirmation time, or other blockchain constraints. The token does not require human approval for ordinary transfers, but wallet owners remain responsible for their keys and transactions.

## Current release

- Token name: `VCTR AI Token`
- Symbol: `VCTR`
- Decimals: 18
- Fixed supply: 10,000,000,000 VCTR
- Intended production network: Base Mainnet (chain ID `8453`)
- Upgradeable: no
- Administrator, post-deployment mint, pause, blacklist, or transfer tax: none
- Project-operated server or gas sponsorship: none

The contracts are immutable after deployment. There is no administrator or recovery function. An incorrect constructor address, lost key, or contract defect cannot be corrected by upgrading the deployed contracts.

## Allocation and lock rules

| Allocation | Amount | On-chain handling |
| --- | ---: | --- |
| Founder lock | 3,000,000,000 (30%) | Held by the immutable vesting contract. No release during the first 15 × 365 days; then released linearly over 5 × 365 days to the named beneficiary. |
| Liquidity reserve | 1,000,000,000 (10%) | Sent to the configured reserve wallet. A trading pool is optional; the pool amount and paired asset are not set by the token contract. |
| Direct sales | 3,000,000,000 (30%) | Sent to the configured Seller wallet. Sale terms should be published before any sale; unsold tokens remain unsold. |
| Community and ecosystem | 500,000,000 (5%) | Held in an immutable timelock until 3 × 365 days after deployment, then claimable by its named beneficiary. |
| Project treasury | 1,000,000,000 (10%) | Held in a separate immutable timelock until 3 × 365 days after deployment, then claimable by its named beneficiary. |
| Social causes | 1,500,000,000 (15%) | Held in a separate immutable timelock until 3 × 365 days after deployment, then claimable by its named beneficiary. |

The allocations sum to exactly 10 billion VCTR. Constructor recipients are fixed at deployment and cannot be changed. Locked tokens are not transferred automatically: the relevant beneficiary must call `release()` after the applicable schedule permits it. The token accepts positive transfer amounts down to 1 wei and rejects zero-value `transfer` and `transferFrom` calls. A pool or liquidity budget is **not required** to deploy the token; any later pool funding is a separate, optional decision.

## Network and deployment status

VCTR has been deployed and read-only verified on **Ethereum Sepolia**, a public test network, at `0xB43557D42e54875D1526A35317727dE338dfD2ee`. The transaction is [`0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82`](https://sepolia.etherscan.io/tx/0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82). The [deployment report](deployments/ethereum-sepolia.json) records the vesting contract, allocation locks, recipients, and unlock times.

Ethereum Sepolia is not Base. The project has chosen to waive a Base Sepolia rehearsal. As a result, Base-specific testnet RPC and explorer behavior has not been rehearsed. Base Mainnet deployment support exists but has **not** been used; no VCTR Mainnet address is being claimed here. Base documents chain ID `8453` for Mainnet in its [`eth_chainId` reference](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId).

The deployment helper supports Ethereum Sepolia, Base Sepolia, and Base Mainnet:

```sh
npm run deploy:ethereum-sepolia
npm run deploy:base-sepolia
npm run deploy:base-mainnet
```

For testnets, use a dedicated test-only key in the ignored local `.env` as `DEPLOYER_PRIVATE_KEY`. The Base Mainnet helper uses the separate `BASE_MAINNET_DEPLOYER_PRIVATE_KEY` and `BASE_MAINNET_RPC` settings. Before it can submit a transaction, it verifies chain ID `8453`, checks the deployer balance against a padded gas estimate at the current maximum fee, displays and asks you to confirm all six recipient addresses, requires typed network and irreversible-deployment confirmations, and requires `BASE_MAINNET_APPROVED_COMMIT` to match the full current Git commit on a clean working tree. It waits for five confirmations and writes a deployment report after success.

These checks reduce common operator mistakes; they do not make an immutable deployment reversible or guarantee that deployment is safe. Use a dedicated deployment account, independently review the final source and addresses, and never put recovery phrases or production wallet keys in source control or chat. A confirmed deployment spends real Base ETH.

After deployment, run the network-specific read-only verifier, for example:

```sh
npm run verify:ethereum-sepolia
npm run verify:base-sepolia
npm run verify:base-mainnet
```

The verifier checks the chain, deployment receipt, bytecode, token metadata, total supply, allocation balances, recipient addresses, lock schedules, early-release reverts, and transfer behavior. Its call simulations do not change chain state. It does not publish source code to BaseScan; independently verify and publish the deployed source there as a separate launch step.

## Build and test

With Node.js and the pinned dependencies available:

```sh
pnpm install --frozen-lockfile
pnpm run compile:contracts
pnpm run test:evm
```

The Node EVM suite runs against a temporary local chain with simulated accounts, balances, and time. It does not send transactions to a public network or spend real ETH. The Foundry invariant suite requires Foundry:

```sh
forge test
```

The invariant suite fuzzes transfers, delegated transfers, time advances, and lock claims, checking supply and balance conservation and the release schedules. The configured campaign uses 128 runs at depth 128. Tests are evidence about the tested code and scenarios; they are not a substitute for an independent security audit or a guarantee against unknown defects.

## Base Mainnet go-live status

| Launch item | Status | Details |
| --- | --- | --- |
| Token code, fixed supply, and allocation locks | OK | Compiled and locally tested; the contracts have no owner, mint, pause, blacklist, or upgrade path. |
| Deployment wallet addresses | OK | The user confirmed the final wallet inputs. Recheck the exact six addresses displayed by the deployment helper before the irreversible transaction. |
| Local automated tests | OK | Eleven Node tests pass, and the Foundry invariant campaign was previously run with 128 runs at depth 128. Testing does not replace an independent audit. |
| Ethereum Sepolia deployment and verification | OK | Public test deployment passed read-only checks. This does not test Base-specific RPC or explorer behavior. |
| Base Sepolia rehearsal | Pending | Waived at the user's direction. The Base-specific testnet path remains unrehearsed; this gap is currently accepted and is not a go-live gate unless the decision changes. |
| Independent human security review | Pending | No independent human audit is complete. The FirePan free surface scan is automated triage, not an audit. Review the exact source and deployment setup using the [security review request](SECURITY_REVIEW_REQUEST.md); resolve or explicitly accept findings. |
| Reviewed release commit | Pending | After review and fixes, approve the exact clean Git commit and set `BASE_MAINNET_APPROVED_COMMIT` to its full hash. |
| Dedicated Mainnet deployer and Base ETH | Pending | Configure `BASE_MAINNET_DEPLOYER_PRIVATE_KEY` locally and fund the dedicated deployer with enough Base ETH for the live deployment estimate. The helper has a default Base RPC; `BASE_MAINNET_RPC` can override it. Keep the key out of source control and chat. |
| Base Mainnet deployment | Pending | Not deployed. Submit only after the review and release gates are complete, the live gas estimate is acceptable, and the helper's address, network, and irreversible-deployment confirmations are checked. |
| Post-deployment checks and publication | Pending | Run `npm run verify:base-mainnet`, verify token and child-contract sources on BaseScan, and publish the final addresses, transaction, allocation, locks, and risk disclosures. |
| Trading-pool liquidity | OK | Not required to deploy the token. The 1 billion VCTR allocation remains assigned to the reserve wallet; any pool funding is a separate optional decision. No INR liquidity budget is set. |
| Direct-sale terms and public sale disclosures | Pending | Publish accurate terms before selling any tokens. Do not imply unsold tokens were sold or distributed, or promise price, profit, or adoption. |

There is no Mainnet deployment yet. Independent review and the Base-specific testnet rehearsal remain outstanding; the latter was explicitly waived. Liquidity decisions, sale terms, and any future AI-agent services are separate from deploying the token and must be documented independently. The optional `local_tool` FastAPI app is an arithmetic-only allocation checker; it does not connect to a blockchain or affect contract behavior.
