# VCTR AI Token

<img src="assets/vctr-logo.png" alt="VCTR token logo" width="256" height="256">

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

## Fixed-price direct sale (prepared; not deployed)

The separate `VCTRFixedSale` contract is designed for Base Mainnet and has no owner, upgrade, manual pause, or early-close function. Its immutable sale terms are 0.018095 native Base USDC per whole VCTR, a 100 VCTR minimum, a limit of 3,000,000 successful purchase calls, and a maximum of 3,000,000,000 VCTR sold. The sale closes permanently when either limit is reached. Failed or reverted calls do not count. Purchases must be integer VCTR amounts; fractional VCTR purchases are not supported.

The full 3 billion VCTR inventory must be transferred from the Seller wallet to the sale contract before the first purchase; purchases revert unless the full remaining inventory is present. USDC is forwarded directly to the Seller wallet. If the purchase-call limit closes the sale before all tokens sell, remaining escrowed VCTR is automatically returned to the Seller wallet. Buyers must approve the sale contract to spend their USDC before calling `buy`; approve only the amount they intend to pay. No sale website or purchase UI is included. Do not transfer USDC directly to the sale contract because it has no recovery function.

The intended Base Mainnet addresses are VCTR `0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc`, native Circle USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and Seller `0x7c98B0aF272Ae8e2f51bC16AaF19a82f6F2248cc`. These are pinned by the deployment preflight. Circle publishes the native Base USDC address on its [Base USDC page](https://www.circle.com/multi-chain-usdc/base). The contract source and deployment tooling are prepared, but no sale contract is claimed as deployed and no sale should be advertised until deployment, full inventory funding, and on-chain balance verification are complete.

At exactly 100 VCTR per purchase, 3 million successful purchases sell 300 million VCTR; larger purchases can reach the 3 billion VCTR cap sooner. The maximum gross payment if all 3 billion VCTR sell at the fixed price is 54,285,000 USDC. This contract does not create or fund a liquidity pool.

## Network and deployment status

VCTR is deployed on **Base Mainnet** (chain ID `8453`) at [`0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc`](https://basescan.org/address/0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc). The deployment transaction is [`0xadabc9c93d10bfddf2fb3bb385119f5eefe4a18712e069ac4dcbabd5a8ff720f`](https://basescan.org/tx/0xadabc9c93d10bfddf2fb3bb385119f5eefe4a18712e069ac4dcbabd5a8ff720f), in block `52220907`. The [Base Mainnet deployment report](deployments/base-mainnet.json) records the vesting contract, allocation locks, recipients, and unlock times. The token was also deployed and read-only verified on **Ethereum Sepolia**, a public test network, at `0xB43557D42e54875D1526A35317727dE338dfD2ee`; its transaction is [`0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82`](https://sepolia.etherscan.io/tx/0xd35fc512a6d22f0c5d6184440c7695210e7ce006bd934d67cef8272812197e82). The [Sepolia deployment report](deployments/ethereum-sepolia.json) records its contracts and allocation details.

Ethereum Sepolia is not Base. The project has chosen to waive a Base Sepolia rehearsal, so Base-specific testnet RPC and explorer behavior has not been rehearsed. Base documents chain ID `8453` for Mainnet in its [`eth_chainId` reference](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId).

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

After the sale source is reviewed and merged into a clean `main` release commit, `pnpm run check:fixed-sale` performs read-only Base Mainnet checks for the chain, VCTR and native USDC addresses and metadata, Seller address, and full Seller inventory. `pnpm run check:fixed-sale-signer` additionally checks the configured local deployer key's derived address and Base ETH balance and estimates deployment gas without signing. `pnpm run deploy:fixed-sale` repeats the checks, requires the reviewed commit pin and matching previously confirmed deployer account, estimates gas, displays all immutable constructor values, and asks for typed account, network, and irreversible-deployment confirmations. Deployment alone does not fund the sale; the Seller must then transfer the full 3 billion VCTR inventory and verify it on BaseScan before purchases can succeed.

The Node EVM suite runs against a temporary local chain with simulated accounts, balances, and time. It does not send transactions to a public network or spend real ETH. The Foundry invariant suite requires Foundry:

```sh
forge test
```

The invariant suite fuzzes transfers, delegated transfers, time advances, and lock claims, checking supply and balance conservation and the release schedules. The configured campaign uses 128 runs at depth 128. Tests are evidence about the tested code and scenarios; they are not a substitute for an independent security audit or a guarantee against unknown defects.

## Base Mainnet deployment prerequisites

This table tracks only what is needed to submit the Base Mainnet deployment transaction using the repository's helper. It does not include optional assurance or post-deployment publication work.

| Required item | Status | Details |
| --- | --- | --- |
| Final deployment recipient addresses | OK | The user confirmed the final wallet inputs. Check all six addresses displayed by the helper before confirming; constructor recipients cannot be changed afterward. |
| Clean Git release commit | Pending | Commit the final deployment source with a clean working tree and set `BASE_MAINNET_APPROVED_COMMIT` to that exact full commit hash. The helper enforces this release pin; it does not verify that an independent audit occurred. |
| Base Mainnet deployer key | Pending | Set `BASE_MAINNET_DEPLOYER_PRIVATE_KEY` locally and keep it out of source control and chat. The helper has a default Base RPC; `BASE_MAINNET_RPC` is an optional override. |
| Sufficient Base ETH for gas | Pending | Fund the deployer with enough Base ETH to cover the helper's live estimate and fee headroom. Actual gas is determined at deployment time. |
| Deployment confirmations and transaction | Pending | The helper checks chain ID 8453 and requires typed confirmation of all recipient addresses, Base Mainnet, and the irreversible deployment before submission. |

An independent human review, Base Sepolia rehearsal, and liquidity pool are **not prerequisites enforced by Base or this deployment helper**. The Base Sepolia rehearsal was waived. Review and post-deployment verification remain prudent, but are separate from the minimum transaction prerequisites above. A liquidity pool is optional; the 1 billion VCTR allocation remains assigned to its reserve wallet. If tokens are sold, publish accurate sale terms before the sale. The optional `local_tool` FastAPI app is an arithmetic-only allocation checker; it does not connect to a blockchain or affect contract behavior.
