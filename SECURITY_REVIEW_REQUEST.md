# Independent Smart Contract Security Review Request

**Status:** Optional review request; no independent human audit has been completed. A human review is not a technical requirement enforced by Base or the deployment helper.

## Review target

- Repository: <https://github.com/vctr-coin/vctr-blockchain>
- Contract source snapshot: commit `c56e0ae2ab806bfd9a7c8a49676a4e2160f50690`
- Solidity: `0.8.30`
- EVM target: Shanghai
- Optimizer: enabled, 200 runs
- Dependencies: OpenZeppelin Contracts `5.7.0`

Review the source at the pinned commit above. The current `main` may later include this request document or other non-contract changes; please report the exact commit reviewed.

## Project summary

VCTR is a planned fixed-supply ERC-20 for a future Base launch. The source creates a 10 billion token supply once in the constructor, then assigns it to six destinations. It has no owner, post-deployment mint function, pause, proxy, upgrade path, fee, or blacklist. Ordinary positive-value transfers are allowed; zero-value `transfer` and `transferFrom` calls revert.

Three billion tokens are held by `FounderVesting`: nothing vests for 15 fixed 365-day years, followed by linear vesting over another five fixed 365-day years. Three other allocations, totalling 3 billion, are held in separate `AllocationTimelock` contracts for three fixed 365-day years. Beneficiaries claim vested or unlocked tokens themselves.

## In-scope source

- `contracts/VCTRToken.sol`
- `contracts/FounderVesting.sol`
- `contracts/AllocationTimelock.sol`
- Constructor allocation values and recipient configuration in `config/tokenomics.json`
- Relevant tests and build configuration used to validate the contracts

Please assess the deployed/tested design as written, including whether the actual code and documented token rules agree. The project is not yet deployed on Base Mainnet.

## Questions for the reviewer

1. Can any caller increase supply or alter balances beyond the stated ERC-20 behavior? Are the allocations complete, conserved, and routed only to their intended destinations?
2. Can zero-address, duplicate, malformed, or otherwise unsafe recipient inputs cause a deployment or allocation flaw?
3. Can any caller bypass the founder cliff, accelerate vesting, claim for another beneficiary, over-release, or exploit timestamp, integer-width, or rounding boundaries?
4. Can any caller release a three-year allocation early, release it more than once, redirect it, or prevent its beneficiary from claiming after unlock?
5. Do transfer and delegated-transfer edge cases, including zero-value rejection and one-wei transfers, create ERC-20 compatibility or allowance issues?
6. Are there reentrancy, access-control, initialization, unchecked-call, denial-of-service, or other exploitable issues in the contracts or their interactions?
7. Are the existing tests meaningful for the security properties they claim, and what important cases are missing?

## Out of scope

This source review does not assess Base sequencer or consensus security, exchange or liquidity-pool behavior, wallet/private-key custody, legal or tax compliance, token price or demand, or unrelated off-chain infrastructure. There is no bridge or price oracle in the in-scope contracts. Review of deployment tooling can be noted separately from the contract findings.

## Requested report

Please provide a written report that identifies:

- Reviewer name or organization, relevant Solidity security experience, and any relationship or conflict with the project.
- Exact commit, files, dependencies, compiler settings, threat model, tools, and manual methods reviewed; also list exclusions and limitations.
- Each finding's severity, affected file and lines, preconditions, impact, reproducible exploit or test where practical, and recommended mitigation.
- Any assumptions or design trade-offs that are not vulnerabilities but should be understood before launch.
- A final finding status after fixes and retesting, including unresolved or accepted risks.

Please coordinate potentially exploitable findings privately before publishing technical exploit details. Use GitHub's private vulnerability reporting if enabled; otherwise contact the maintainers before posting sensitive details publicly.

## Existing evidence (not an audit)

FirePan's free surface scan completed against the pinned commit with zero reported findings and no risk score. Its result is automated triage, not a security pass or human audit. Scan ID: `scan_e8bd2d9846e443edac69d9478fb1c5c2`.

To reproduce the project checks, install the pinned JavaScript dependencies and run:

```sh
pnpm install --frozen-lockfile
pnpm run compile:contracts
pnpm run test:evm
forge test
```

These checks are project-maintained tests and do not replace an independent review.
