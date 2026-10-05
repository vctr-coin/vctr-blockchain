# VCTR milestones and launch gates

**Project root:** `~/Projects/Blockchain-VCTR`  
**Goal:** launch a simple Base token that needs no owner action after deployment, does not sponsor users' gas, and has no recurring service to operate.  
**Status:** draft contracts implement the 10-billion-token allocation, a 15 × 365-day founder cliff followed by five years of continuous linear vesting, and three-year locks for community, treasury, and social-causes allocations. Compilation, seven local EVM tests, and two Foundry invariants pass; the invariant campaign uses 128 runs at depth 128. A guarded Base Sepolia deployment helper is prepared but has not been run. The user reports verifying all six recipient addresses in MetaMask; recheck the exact constructor values at deployment. Independent review and Base Sepolia deployment/verification remain. Reconfirm the liquidity budget and pool parameters before any mainnet deposit. See `README.md` and `config/tokenomics.json`.

## The product boundary

The hands-off version is a fixed-supply ERC-20 on Base. It has no owner role, mint function, transfer tax, pause, blacklist, upgrade, automation, server, or required website. Each sender pays Base ETH for their own transaction. The contract continues operating onchain without a VCTR-operated service.

This version does not include an agent API, hosted marketplace, revenue collection, or a promise that agents will use VCTR. A hosted service would need someone to keep it online and handle outages, abuse, updates, and hosting costs. That is a different product and conflicts with the current no-ongoing-operations goal. A token contract alone cannot make agents want VCTR or generate revenue for its creator.

## Milestones

### 0. Confirm scope and budget — planning gate

- Choose the hands-off token-only path, or change the goal to include an operated agent service.
- Confirm the maximum one-time launch budget, including deploy gas and any paid review.
- Current planning placeholder: ₹5,000 as **tentative at-risk liquidity capital**, subject to explicit reconfirmation at actual Base Mainnet pool deployment. This does not authorize a deposit or fix the VCTR amount or paired asset. Pool liquidity can lose value. If not reconfirmed then, skip the pool; the token can deploy without project-provided trading liquidity.
- Confirm Base as the chain and 0% transfer/application fees with senders paying their own gas.

**Exit evidence:** written scope and a rupee budget split into service/review costs, network gas, and optional at-risk liquidity.

### 1. Finalize tokenomics and authority

- Confirmed metadata: `VCTR AI Token`, symbol `VCTR`, 18 decimals, and 10 billion total supply.
- Record the confirmed allocation amounts: Founder lock 3 billion (30%); liquidity 1 billion (10%); direct sales 3 billion (30%); community and ecosystem 500 million (5%); project treasury 1 billion (10%); social causes 1.5 billion (15%). These sum to exactly 10 billion.
- Define every allocation and destination wallet before deployment. Specify the initial distribution and what happens to any unsold allocation.
- Implement the specified founder lock: transfer all 3 billion founder tokens to a vesting contract at token launch; no release for 15 × 365 days; then continuous linear vesting across the following 5 × 365 days, averaging about 50 million per month; no discretionary early release. The beneficiary claims accrued tokens.
- Lock 500 million community, 1 billion treasury, and 1.5 billion social-causes allocations in separate contracts until 3 × 365 days after token deployment; each beneficiary may claim its full allocation after the cliff.
- Follow the stated current rules: deposit only the amount actually needed for the initial pool and hold the remainder in a separate liquidity reserve; keep sale inventory in Seller and publish terms before sales; do not state that unsold sale tokens were sold, treat treasury tokens as operating cash, or assign donation value to social-cause tokens.
- Confirm that the deployed token has no administrator and cannot be changed or paused. Lost keys, allocation mistakes, and contract bugs will not have an admin recovery path.

**Exit evidence:** supply table adds up exactly; all wallets and founder-lock terms are approved and recorded.

### 2. Build the minimal immutable token

- Implement only a fixed-supply ERC-20 with the approved distribution and immutable lock contracts for the founder, community, treasury, and social-causes allocations. Reject zero-value transfers; allow any positive amount (minimum 1 wei).
- Exclude owner privileges, post-deployment minting, transfer/application fees, automatic swaps, fee vaults, gas sponsorship, bots, and project-operated APIs.
- Pin compiler and dependency versions; record reproducible source and deployment settings.

**Exit evidence:** source matches the approved specification; supply is created once; no privileged or hidden controls remain.

### 3. Verify locally, then on Base Sepolia

- Compile and inspect the contracts in a local environment. Eight Node EVM checks cover allocations, positive-only transfer behavior, absence of owner/mint/pause/upgrade functions, founder vesting, three-year allocation locks, and invalid recipients. Foundry invariant campaigns fuzz transfers, delegated transfers, time advances, and lock claims while asserting supply conservation and release schedules (128 runs at depth 128).
- Deploy to Base Sepolia using test ETH and verify the token, founder vesting,
  and all three allocation-lock sources.
- Check total supply, all initial balances, each cliff and beneficiary claim, 0% transfers, sender-paid gas, and absence of owner/mint/pause functions.
- Exercise transfers between separate wallets and document the exact production steps.

**Exit evidence:** recorded testnet addresses and transactions; results match the allocation table; no real funds used.

### 4. Independent review and irreversible-launch check

- Have an independent Solidity reviewer inspect the final source, compiler settings, allocation destinations, and vesting setup.
- Reconcile the compiled bytecode and verified testnet source with the reviewed release.
- Review the final launch transaction details on a separate device/session.
- Do not proceed with unresolved critical findings.

**Exit evidence:** reviewer findings resolved or explicitly accepted, with final source hash and deployment checklist saved.

### 5. Prepare the launch package

- Publish the token rules, supply/allocation table, founder vesting terms, contract source, Base chain details, and clear risk/utility description.
- Prepare wallet and transaction steps; keep recovery phrases out of project files and online services.
- Do not promise a price, profit, agent adoption, or a success percentage.
- A public website is optional. If used, keep it informational and static; a hosted API or continuously operated site is outside the token-only scope and may introduce recurring costs.

**Exit evidence:** final public information is consistent with the reviewed contract and actual allocations.

### 6. Deploy to Base Mainnet — spending gate

- Obtain a live gas estimate and confirm it fits the approved one-time budget.
- Deploy the exact reviewed token and any separately reviewed vesting contracts.
- Verify source and publish addresses and transaction records.
- Make no liquidity deposit unless Milestone 0 explicitly kept the ₹5,000 risk-capital allocation.

**Exit evidence:** verified mainnet addresses, final balances, documented launch expenses, and no unexpected contract authority.

### 7. Hand off and stop operating

- Remove project-controlled admin keys from the token design; there should be no admin to renounce because the token has no owner role.
- Stop here for the token-only model. Holders submit their own transactions and pay their own gas. No project server, relayer, bot, or periodic transaction is required.
- If liquidity was explicitly funded, document who owns the LP position. Do not describe it as hands-off income: some pool designs need monitoring/actions, fees may require collection, and pool value can fall.

**Exit evidence:** post-launch responsibility statement says who controls each wallet and LP position, what actions remain optional, and which ongoing expenses are zero or still possible.

## Testing versus production

| Stage | Network/assets | What it demonstrates |
|---|---|---|
| Local | Temporary local chain and generated test wallets | Contract logic and repeatable walkthrough; no persistent chain state or real funds |
| Public test | Base Sepolia test ETH and test VCTR | Wallet/RPC/deployment/source-verification flow; no real market demand or production security guarantee |
| Production | Base Mainnet and real ETH | Real contract deployment and real user transactions; fees and mistakes are real and irreversible |

## Cost categories

- **One-time service/review cost:** only applies if paid external help is selected; scope and quote must be approved in Milestone 0.
- **Deployment gas:** real Base ETH for mainnet transactions; varies, so obtain a live quote near deployment.
- **Liquidity capital:** tentatively ₹5,000, optional, separate from fees and gas, and at risk; reconfirm before any mainnet deposit. The actual VCTR amount and paired asset remain undecided.
- **Ordinary holder transfers:** paid by the transaction sender in Base ETH; the project does not sponsor them.
- **Recurring infrastructure:** ₹0 for the token-only design because it has no required server or hosted service. Optional domains, hosting, paid monitoring, support, and future transactions can add costs if chosen later.

## Start condition

Do not deploy or spend launch funds until Milestone 0 and Milestone 1 have written answers. In particular, resolve the service-versus-hands-off choice, confirm the final constructor addresses, and reconfirm whether the ₹5,000 liquidity allocation is still allowed.
