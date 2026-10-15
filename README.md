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

## Network and deployment status

VCTR is live on **Base Mainnet** (chain ID `8453`) at [`0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc`](https://basescan.org/address/0xA6cFE683cC1886A2dcb1f403F906C0615befbCDc). Its deployment transaction is [`0xadabc9c93d10bfddf2fb3bb385119f5eefe4a18712e069ac4dcbabd5a8ff720f`](https://basescan.org/tx/0xadabc9c93d10bfddf2fb3bb385119f5eefe4a18712e069ac4dcbabd5a8ff720f), in block `52220907`. The [Base Mainnet deployment report](deployments/base-mainnet.json) records the vesting contract, allocation locks, recipients, and unlock times. The deployed token source is verified on BaseScan.

The token contract and its allocation locks are immutable. This repository also contains a separate direct-sale contract design in [SalesReadme.md](SalesReadme.md); that design is not part of the deployed VCTR token contracts. A sale must not be represented as active until its own deployment and terms are independently confirmed.

The liquidity reserve is held separately from the token contract. A trading pool is optional, and no liquidity amount or paired asset is configured by the VCTR token contract. Publish accurate sale terms before any sale; unsold tokens remain unsold. The optional `local_tool` FastAPI app is an arithmetic-only allocation checker and does not connect to a blockchain or affect contract behavior.
