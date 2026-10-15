# VCTR Direct-Sale Contract

This document describes the intended behavior of the separate, non-upgradeable VCTR sale contract. Confirm the actual network and contract addresses against the deployment record and verified explorer source before interacting with a deployed instance. This document is not an independent security audit or tax opinion.

The sale is a separate, non-upgradeable contract. It does not change the existing VCTR token or restrict ordinary VCTR transfers outside this contract.

## Finalized sale rules encoded in this draft

| Rule | Contract behavior |
| --- | --- |
| Payment asset | Constructor-fixed ERC-20 with 6 decimals. The exact USDC contract address is fixed at deployment and must be checked on the selected network. |
| Sale token | Constructor-fixed ERC-20 with 18 decimals, intended to be VCTR. |
| Fixed price | 0.018095 USDC per whole VCTR (`18,095` USDC micro-units). Price cannot be changed after deployment. |
| Minimum order | 100 whole VCTR. Fractional VCTR orders are rejected. No per-order maximum. |
| Lifetime sale cap | 3,000,000,000 VCTR. |
| Successful-purchase cap | 30,000,000. Only completed atomic purchases count. With a 100 VCTR minimum, the count cap and supply cap meet at 3 billion VCTR; larger orders hit the supply cap sooner. |
| Inventory | Seller deposits in stages through `fundInventory`. Only deposited/accounted VCTR is sellable. Total staged plus sold inventory cannot exceed 3 billion VCTR. |
| Buyer authorization | Every purchase needs an unexpired EIP-712 permit signed by the configured authorization EOA. Permit is tied to buyer, exact quantities, unique reference, one-time nonce, deadline, and split-policy version. |
| Permit lifetime | At most 10 minutes. Buyer submits and pays gas; caller must be the wallet named in the permit. |
| Audit reference | Backend generates a unique random `bytes32` reference for each verified purchase and saves its mapping to the protected verification record before issuing a permit. The reference is emitted publicly in `PurchaseCompleted`, contains no identity itself, and is separate from the one-use nonce. |
| Initial payout policy | TDS wallet receives 1% of gross USDC; Sales wallet receives the remainder. Other taxes are not separately withheld or sent by this contract and require separate accounting/payment outside it. |
| TDS and wallet changes | Seller may schedule a new TDS rate and two payout addresses no earlier than 30 days after scheduling. A pending schedule may be cancelled by Seller; anyone may activate it after its effective time. A purchase also activates a due schedule before checking its policy version. |
| Inventory withdrawal | Seller may withdraw accounted unsold VCTR only while the sale is paused. Withdrawal does not reduce lifetime VCTR sold or reset the purchase counter. |
| Pause/resume | Both Seller and Project Treasury signer must sign the same action, nonce, deadline, and contract domain. A paused sale rejects purchases. |
| Termination | Both Seller and Project Treasury signer must approve. It permanently closes the sale and returns all VCTR held by the contract to Seller. Unsolicited USDC is recoverable separately with both signatures, including after closure, so USDC transfer issues cannot block termination. |
| Automatic close | Sale permanently closes when either global limit is reached and emits `SaleClosedAtCap`. |
| Signer rotation | Both Seller and Project Treasury signer approve a replacement authorization signer; rotation has a 30-day notice period. |
| Stray-token recovery | Both signers approve recovery of unaccounted VCTR or directly transferred USDC. VCTR that has been staged as sale inventory cannot be recovered while the sale remains active. Recovery does not count as a purchase. |
| Identity data | Contract stores no identity documents, ID numbers, IP addresses, or encrypted identity data. Wallet, purchase, split, and reference data remain public on-chain. |
| Code upgrades | No proxy or general upgrade function. Fixed price, cap, token addresses, Seller, and Project Treasury signer cannot be changed. |

The three configured signers (Seller, Project Treasury signer, and purchase authorization signer) must be distinct EOAs. The Project Treasury signing address must be an account capable of ECDSA signing; a lock contract address cannot sign this control message. The two payout addresses must be nonzero and distinct. Confirm every configured address and chain before signing or submitting a transaction.

## Payment split and rounding

USDC uses six decimal places. The contract computes each purchase in integer micro-USDC and floors the TDS amount per purchase:

```text
TDS   = floor(gross × tdsBps / 10,000)
Sales = gross − TDS
```

At the minimum order of 100 VCTR, gross is 1.8095 USDC (1,809,500 micro-USDC). At the initial 1% TDS rate, the TDS wallet receives 18,095 micro-USDC and the Sales wallet receives 1,791,405 micro-USDC. Sales receives all rounding remainder, so the two payouts equal the buyer’s payment exactly.

At 30 million purchases of exactly 100 VCTR, total gross is 54,285,000 USDC: 542,850 USDC goes to the TDS wallet and 53,742,150 USDC to the Sales wallet. Different order sizes can create small per-purchase rounding differences; the Sales transfer always receives the remainder.

These are contract allocation settings, not a determination of tax owed, statutory withholding, or final LLP tax. Rates/bases must be approved by the LLP’s tax adviser before any production launch. A reserve transfer is not a tax payment or filing.

## Public functions and access rules

| Function | Who may call | Effect / restriction |
| --- | --- | --- |
| `fundInventory(amount)` | Seller | Pulls whole VCTR into sale escrow; staged plus sold inventory cannot exceed the cap. Requires Seller approval to the sale contract. |
| `withdrawInventory(amount)` | Seller while paused | Returns whole VCTR from accounted unsold inventory to Seller. Cannot withdraw during active sales or withdraw more than the accounted inventory. |
| `quote(vctrAmount)` | Anyone, read-only | Returns exact gross USDC micro-units, TDS, Sales remainder, and effective policy version. Rejects below-minimum/fractional quantities. |
| `buy(authorization, signature)` | Buyer named in permit | Validates signature/domain, permit deadline, exact price, policy version, unique nonce/reference, caps, pause/closure, and inventory; atomically collects and distributes USDC to TDS and Sales, then transfers VCTR. |
| `scheduleSplit(wallets, tdsBps, effectiveAt)` | Seller | Schedules a TDS rate and two payout wallets at least 30 days ahead. Cannot change price or code. |
| `cancelScheduledSplit()` | Seller | Cancels the not-yet-activated policy schedule. |
| `activateScheduledSplit()` | Anyone after effective time | Activates a previously announced policy; purchase calls also activate a due schedule. |
| `activeSplitConfig()` / `pendingSplitConfig()` | Anyone, read-only | Returns active or scheduled TDS wallet/rate configuration and version/time. |
| `pause(deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Pauses future sales; one signer alone is insufficient. |
| `resume(deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Resumes a paused, non-terminated sale. |
| `terminate(deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Permanently closes and returns all VCTR then held to Seller. Unsolicited USDC recovery is a separate dual-approved action so a USDC transfer failure cannot block termination. |
| `scheduleAuthorizationSigner(newSigner, effectiveAt, deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Schedules a distinct EOA signer change at least 30 days ahead. |
| `activateAuthorizationSigner()` | Anyone after effective time | Makes the scheduled permit signer active. |
| `recoverUnsolicitedUsdc(amount, deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Transfers the specified USDC balance to the fixed Seller. It is not a sale and delivers no VCTR. Can be used after closure for later accidental transfers. |
| `recoverUnsolicitedVctr(amount, deadline, sellerSig, treasurySig)` | Any relayer with both valid signatures | Transfers only VCTR balance above accounted sale inventory to Seller. |
| `purchaseDigest`, `controlDigest`, `controlActionHashes` | Anyone, read-only | Helpers for reproducing and checking EIP-712 digests/action identifiers. |

Administration signatures are EIP-712 domain-bound to chain ID and sale address, have deadlines no more than 24 hours ahead, and use a shared incrementing control nonce. Any relayer may submit signatures; this does not bypass the requirement for both authorized signers. Permit signatures are domain-bound and use separate one-use nonces.

Direct USDC transfers cannot be blocked by this contract. They never deliver VCTR or increment purchase counters; they can be swept to Seller only with both control signatures. Do not treat such a transfer as a purchase without separate accounting review.

## Events

The contract emits `InventoryFunded`, `InventoryWithdrawn`, `PurchaseCompleted`, `SalePaused`, `SaleResumed`, `SaleTerminated`, `SaleClosedAtCap`, `SplitScheduled`, `SplitScheduleCancelled`, `SplitActivated`, `AuthorizationSignerChangeScheduled`, `AuthorizationSignerChanged`, `UnsolicitedUsdcRecovered`, and `UnsolicitedVctrRecovered`. Purchase events contain the public reference, buyer, amounts, policy version, TDS, and Sales payout. The contract does not store an explorer transaction hash; index the event’s transaction hash and log index off-chain.

## Python application integration draft

Use a separate FastAPI backend for identity-provider checks, records, and permit signing. The Python/web/mobile client must not contain the backend authorization private key or either admin signing key. Keep Seller and Project Treasury approval in separate signing devices/workflows. Treat provider callbacks and request IDs as untrusted until authenticated and matched server-side. Persist the reference-to-record map securely before issuing a permit.

Install compatible `web3.py` and `eth-account` versions in the consuming application. The ABI can be generated from the local Solidity artifact after compile. The following illustrates EIP-712 payload construction; it intentionally has no RPC URL, private key, or deployment address.

```python
import secrets
from eth_account import Account
from eth_account.messages import encode_typed_data

DOMAIN = {
    "name": "VCTR Direct Sale",
    "version": "1",
    "chainId": chain_id,                 # Read from the connected chain.
    "verifyingContract": sale_address,  # Verify against the deployed address.
}

PURCHASE_TYPES = {
    "PurchaseAuthorization": [
        {"name": "buyer", "type": "address"},
        {"name": "vctrAmount", "type": "uint256"},
        {"name": "usdcAmount", "type": "uint256"},
        {"name": "referenceId", "type": "bytes32"},
        {"name": "nonce", "type": "bytes32"},
        {"name": "deadline", "type": "uint64"},
        {"name": "splitVersion", "type": "uint64"},
    ]
}

def make_purchase_permit(backend_signer, buyer, whole_vctr, quote, version, chain_timestamp):
    # Run only after backend verification succeeds and its durable record is saved.
    # The API maps this random reference to its protected off-chain record.
    ref = secrets.token_bytes(32)
    nonce = secrets.token_bytes(32)
    message = {
        "buyer": buyer,
        "vctrAmount": whole_vctr * 10**18,
        "usdcAmount": quote["gross_usdc_micro"],
        "referenceId": "0x" + ref.hex(),
        "nonce": "0x" + nonce.hex(),
        "deadline": chain_timestamp + 180,  # Read chain time; must be <= 10 minutes from execution.
        "splitVersion": version,
    }
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            **PURCHASE_TYPES,
        },
        "primaryType": "PurchaseAuthorization",
        "domain": DOMAIN,
        "message": message,
    }
    encoded = encode_typed_data(full_message=typed)
    signature = Account.sign_message(encoded, backend_signer).signature
    return message, signature
```

The backend first reads `sale.functions.quote(whole_vctr * 10**18).call()`; quote fields 0 and 3 are gross USDC micro-units and policy version (fields 1 and 2 are TDS and Sales amounts). Pass the gross quote in `quote["gross_usdc_micro"]` to the example. The backend returns the permit and signature to the verified buyer. A wallet flow then approves the exact `usdcAmount` to the sale contract and submits `buy(permit_tuple, signature)` from the permit’s buyer address. A Python service can prepare the unsigned calls without holding the buyer key:

```python
buyer = permit["buyer"]
permit_tuple = (
    permit["buyer"], permit["vctrAmount"], permit["usdcAmount"],
    permit["referenceId"], permit["nonce"], permit["deadline"], permit["splitVersion"],
)
approval_tx = usdc.functions.approve(sale.address, permit["usdcAmount"]).build_transaction(
    {"from": buyer, "chainId": chain_id}
)
purchase_tx = sale.functions.buy(permit_tuple, signature).build_transaction(
    {"from": buyer, "chainId": chain_id}
)
# Pass these unsigned transaction requests to the buyer's wallet for review/signing.
```

The wallet pays gas. Verify the connected chain ID, token address, sale address, buyer address, quote, and split version immediately before signing/submitting. Wait for a successful finalized receipt and index `PurchaseCompleted`; do not treat a submitted transaction or API response as a completed purchase.

### Joint-control signature format

For pause, resume, termination, signer rotation, and recovery, both signers sign the same typed object independently. One application should not hold both private keys.

```python
CONTROL_TYPES = {
    "ControlApproval": [
        {"name": "action", "type": "bytes32"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint64"},
        {"name": "dataHash", "type": "bytes32"},
    ]
}

def sign_control(account, action_hash, onchain_control_nonce, deadline, data_hash):
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            **CONTROL_TYPES,
        },
        "primaryType": "ControlApproval",
        "domain": DOMAIN,
        "message": {
            "action": action_hash,
            "nonce": onchain_control_nonce,
            "deadline": deadline,
            "dataHash": data_hash,
        },
    }
    return Account.sign_message(encode_typed_data(full_message=typed), account).signature
```

`action_hash` must be read from `controlActionHashes()`. Use zero `dataHash` for pause, resume, and termination. For signer rotation, use `keccak256(abi.encode(newSigner, effectiveAt))`. For USDC/VCTR recovery, use `keccak256(abi.encode(amount, sellerAddress))`. Fetch the current `controlNonce` immediately before signing. Both signatures must use the same action, nonce, deadline, and data hash. Submit the corresponding contract function with both signatures before the deadline. Build and inspect each transaction with the exact ABI; do not guess selectors or encode with a stale ABI.
