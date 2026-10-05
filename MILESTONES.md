# VCTR milestones and launch gates

**Project root:** `~/Projects/Blockchain-VCTR`  
**Goal:** launch a simple Base token that needs no owner action after deployment, does not sponsor users' gas, and has no recurring service to operate.  
**Status:** the contracts implement the 10-billion-token allocation, a 15 × 365-day founder cliff followed by five years of continuous linear vesting, and three-year locks for community, treasury, and social-causes allocations. Eight local contract EVM checks and three deployment-config checks pass; the Foundry invariant campaign previously completed two tests with 128 runs at depth 128. The token is deployed and read-only verified on Ethereum Sepolia. The user has waived the Base Sepolia rehearsal. Base Mainnet deployment support is implemented but has not been used. An independent human review has not been performed; it is optional risk reduction, not a technical deployment prerequisite. See `README.md` and `config/tokenomics.json` for the minimum deployment inputs.

## The product boundary

The hands-off version is a fixed-supply ERC-20 on Base. It has no owner role, mint function, transfer tax, pause, blacklist, upgrade, automation, server, or required website. Each sender pays Base ETH for their own transaction. The contract continues operating onchain without a VCTR-operated service.

This version does not include an agent API, hosted marketplace, revenue collection, or a promise that agents will use VCTR. A hosted service would need someone to keep it online and handle outages, abuse, updates, and hosting costs. That is a different product and conflicts with the current no-ongoing-operations goal. A token contract alone cannot make agents want VCTR or generate revenue for its creator.

## Milestones

### 0. Confirm scope and budget — planning gate

- Choose the hands-off token-only path, or change the goal to include an operated agent service.
- Have enough Base ETH available for the deployment gas estimate. A paid review is optional and is not required by the deployment helper.
- Decide separately whether to provide initial liquidity. No liquidity amount, VCTR quantity, or paired asset is specified here; document and approve any such decision before a pool deposit. Liquidity can lose value, and the token can deploy without project-provided trading liquidity.
- Confirm Base as the chain and 0% transfer/application fees with senders paying their own gas.

**Exit evidence:** token-only scope confirmed and enough Base ETH available for the deployment gas estimate. Paid review and liquidity are optional choices.

### 1. Finalize tokenomics and authority

- Confirmed metadata: `VCTR AI Token`, symbol `VCTR`, 18 decimals, and 10 billion total supply.
- Record the confirmed allocation amounts: Founder lock 3 billion (30%); liquidity 1 billion (10%); direct sales 3 billion (30%); community and ecosystem 500 million (5%); project treasury 1 billion (10%); social causes 1.5 billion (15%). These sum to exactly 10 billion.
- Define every allocation and destination wallet before deployment. Specify the initial distribution and what happens to any unsold allocation.
- Implement the specified founder lock: transfer all 3 billion founder tokens to a vesting contract at token launch; no release for 15 × 365 days; then continuous linear vesting across the following 5 × 365 days, averaging about 50 million per month; no discretionary early release. The beneficiary claims accrued tokens.
- Lock 500 million community, 1 billion treasury, and 1.5 billion social-causes allocations in separate contracts until 3 × 365 days after token deployment; each beneficiary may claim its full allocation after the cliff.
- Keep the liquidity allocation in its reserve wallet. A trading-pool deposit is optional and separate from token deployment; if one is considered later, document the amount, paired asset, custody, and risks first. Keep sale inventory in Seller and publish terms before sales; do not state that unsold sale tokens were sold, treat treasury tokens as operating cash, or assign donation value to social-cause tokens.
- Confirm that the deployed token has no administrator and cannot be changed or paused. Lost keys, allocation mistakes, and contract bugs will not have an admin recovery path.

**Exit evidence:** supply table adds up exactly; all wallets and founder-lock terms are approved and recorded.

### 2. Build the minimal immutable token

- Implement only a fixed-supply ERC-20 with the approved distribution and immutable lock contracts for the founder, community, treasury, and social-causes allocations. Reject zero-value transfers; allow any positive amount (minimum 1 wei).
- Exclude owner privileges, post-deployment minting, transfer/application fees, automatic swaps, fee vaults, gas sponsorship, bots, and project-operated APIs.
- Pin compiler and dependency versions; record reproducible source and deployment settings.

**Exit evidence:** source matches the approved specification; supply is created once; no privileged or hidden controls remain.

### 3. Verify locally and on Ethereum Sepolia; Base Sepolia rehearsal waived

- Compile and inspect the contracts in a local environment. Eight Node EVM checks cover allocations, positive-only transfer behavior, absence of owner/mint/pause/upgrade functions, founder vesting, three-year allocation locks, and invalid recipients. Foundry invariant campaigns fuzz transfers, delegated transfers, time advances, and lock claims while asserting supply conservation and release schedules (128 runs at depth 128).
- Deploy to Ethereum Sepolia using test ETH; the deployment report and
  `npm run verify:ethereum-sepolia` record/check the token, founder vesting,
  and all three allocation locks.
- The user has explicitly chosen to skip Base Sepolia. This accepts that the
  Base RPC/explorer path is not rehearsed on a testnet; do not present Ethereum
  Sepolia as a Base-specific deployment test.

**Exit evidence:** recorded Ethereum Sepolia addresses and transaction; public-chain values match the allocation table; no real funds used. Base Sepolia remains waived.

### 4. Optional independent security review

- An independent review is recommended risk reduction for immutable contracts, but is not required by Base or by the deployment helper. The optional public request in `SECURITY_REVIEW_REQUEST.md` asks a reviewer to inspect the source and deployment setup; the FirePan free surface scan is automated triage, not an audit.
- If a review is obtained, resolve or document findings and record the exact reviewed commit. The deployment helper itself only checks that the configured commit hash matches the clean current Git commit; it does not check for an audit.

**Exit evidence:** optional reviewer findings and response recorded, if this review is pursued.

### 5. Prepare the launch package

- Publish the token rules, supply/allocation table, founder vesting terms, contract source, Base chain details, and clear risk/utility description.
- Prepare wallet and transaction steps; keep recovery phrases out of project files and online services.
- Do not promise a price, profit, agent adoption, or a success percentage.
- A public website is optional. If used, keep it informational and static; a hosted API or continuously operated site is outside the token-only scope and may introduce recurring costs.

**Exit evidence:** any public information is consistent with the deployed contract and actual allocations.

### 6. Deploy to Base Mainnet — spending gate

- Obtain a live gas estimate and confirm the deployer has enough Base ETH to cover the helper's estimate and fee headroom.
- Run `npm run deploy:base-mainnet` with the finalized source and recipients.
  The helper enforces chain ID, a Mainnet deployer key, an exact commit hash
  on a clean Git tree, a balance check against the estimated gas limit and
  max fee, and typed irreversible-deployment confirmations. It does not
  require an independent audit or a Base Sepolia deployment.
- After deployment, run `npm run verify:base-mainnet` and verify token and
  child-contract source on BaseScan as recommended post-deployment checks.
- Make no liquidity deposit unless the amount, paired asset, custody, and risks have been explicitly documented and approved.

**Exit evidence:** verified mainnet addresses, final balances, documented launch expenses, and no unexpected contract authority.

### 7. Hand off and stop operating

- Remove project-controlled admin keys from the token design; there should be no admin to renounce because the token has no owner role.
- Stop here for the token-only model. Holders submit their own transactions and pay their own gas. No project server, relayer, bot, or periodic transaction is required.
- If liquidity was explicitly funded, document who owns the LP position. Do not describe it as hands-off income: some pool designs need monitoring/actions, fees may require collection, and pool value can fall.

**Exit evidence:** post-launch responsibility statement says who controls each wallet and LP position, what actions remain optional, and which ongoing expenses are zero or still possible.

## Testing versus production

| Stage | Status | Network/assets | What it demonstrates |
|---|---|---|---|
| Local | OK | Temporary local chain and generated test wallets | Contract logic and repeatable walkthrough; no persistent chain state or real funds |
| Public test: Ethereum Sepolia | OK | Ethereum Sepolia test ETH and test VCTR | Public test deployment and contract behavior completed and read-only verified. |
| Base Sepolia rehearsal | Pending | Base Sepolia test ETH | Waived at the user's direction; Base-specific RPC/explorer behavior remains untested. The gap is accepted and is not a launch gate unless that decision changes. |
| Production | Pending | Base Mainnet and real ETH | No production deployment yet. Real contract deployment and user transactions; fees and mistakes are real and irreversible. |

## Cost categories

- **Optional review or service cost:** only applies if paid external help is chosen; it is not a deployment prerequisite.
- **Deployment gas:** real Base ETH for mainnet transactions; varies, so obtain a live quote near deployment.
- **Liquidity capital:** optional, separate from fees and gas, and at risk. Decide and document the amount, VCTR quantity, paired asset, and LP-position custody before any mainnet deposit.
- **Ordinary holder transfers:** paid by the transaction sender in Base ETH; the project does not sponsor them.
- **Recurring infrastructure:** ₹0 for the token-only design because it has no required server or hosted service. Optional domains, hosting, paid monitoring, support, and future transactions can add costs if chosen later.

## Start condition

Before deployment, configure the Mainnet deployer key, fund enough Base ETH for the live gas estimate, pin the exact clean Git commit in `BASE_MAINNET_APPROVED_COMMIT`, and confirm the helper's chain and all six recipient addresses. A human review, Base Sepolia rehearsal, and liquidity pool are optional; none is enforced by the deployment helper.
