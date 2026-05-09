# Zama SDK: Error Taxonomy and `matchZamaError`

Every error thrown by `@zama-fhe/sdk@^3.0.0` and `@zama-fhe/react-sdk@^3.0.0`
extends `ZamaError` and carries a `.code` string. Catch with `instanceof` for
narrow paths or use `matchZamaError` for exhaustive routing. Read this when
the user is wiring up error handling, building a UI for confidential token
flows, or debugging a thrown error.

## Contents

- The `ZamaError` Base
- `matchZamaError` Pattern
- Full Error Class List
- Per-Error Causes and Recovery
- "No balance" vs "Zero balance"
- Common Symptoms and Fixes
- Common Mistakes

## The `ZamaError` Base

```ts
import { ZamaError } from "@zama-fhe/sdk";

class ZamaError extends Error {
    code: ErrorCode; /* SCREAMING_SNAKE_CASE string */
}
```

Every SDK-thrown error is `instanceof ZamaError`. Standard JS `Error`s
(network primitives, ethers internals, viem internals) are NOT - check
those separately at the boundary.

## `matchZamaError` Pattern

```ts
import { matchZamaError } from "@zama-fhe/sdk";

const message = matchZamaError(error, {
    SIGNING_REJECTED: () => "Please approve the transaction in your wallet",
    ENCRYPTION_FAILED: () => "Encryption failed - try again",
    TRANSACTION_REVERTED: (e) => `Transaction failed: ${e.message}`,
    NO_CIPHERTEXT: () => "No confidential balance - shield tokens first",
    INSUFFICIENT_CONFIDENTIAL_BALANCE: (e) =>
        `Insufficient balance: ${e.available} available`,
    INSUFFICIENT_ERC20_BALANCE: (e) =>
        `Not enough tokens: ${e.available} available`,
    BALANCE_CHECK_UNAVAILABLE: () => "Sign to verify your balance first",
    ERC20_READ_FAILED: () =>
        "Could not read token balance - check your connection",
    _: (e) => `Unexpected error: ${e}`,
});
```

Behaviors:

- Returns the handler's return value (typed by the union of return types).
- Returns `undefined` if the error is not a `ZamaError` and no `_` wildcard
  is provided.
- The `_` wildcard catches any `ZamaError` not explicitly handled.
- Specific codes always take precedence over `_`.

In React, `matchZamaError` is re-exported from `@zama-fhe/react-sdk`. A
typical error component:

```tsx
import { matchZamaError } from "@zama-fhe/react-sdk";

function ErrorMessage({ error }: { error: Error | null }) {
    if (!error) return null;
    const msg = matchZamaError(error, {
        SIGNING_REJECTED: () => "Cancelled - approve in your wallet.",
        ENCRYPTION_FAILED: () => "Encryption failed - retry.",
        TRANSACTION_REVERTED: () => "Transaction reverted - check balance.",
        _: () => "Something went wrong.",
    });
    return <p className="error">{msg ?? error.message}</p>;
}
```

The `?? error.message` fallback handles the case where the error is not a
`ZamaError`.

## Full Error Class List

| Class | Code | Thrown by |
|---|---|---|
| `SigningRejectedError` | `SIGNING_REJECTED` | Any operation that prompts EIP-712 |
| `SigningFailedError` | `SIGNING_FAILED` | Any operation that prompts EIP-712 |
| `EncryptionFailedError` | `ENCRYPTION_FAILED` | `confidentialTransfer`, `shield`, raw `encrypt` |
| `DecryptionFailedError` | `DECRYPTION_FAILED` | `balanceOf`, `userDecrypt`, `decryptBalanceAs` |
| `ApprovalFailedError` | `APPROVAL_FAILED` | `shield` (ERC-20 approval phase) |
| `TransactionRevertedError` | `TRANSACTION_REVERTED` | Any on-chain write |
| `InvalidKeypairError` | `INVALID_KEYPAIR` | `userDecrypt`, `balanceOf` |
| `KeypairExpiredError` | `KEYPAIR_EXPIRED` | `userDecrypt`, `balanceOf` |
| `NoCiphertextError` | `NO_CIPHERTEXT` | `balanceOf`, `userDecrypt` |
| `RelayerRequestFailedError` | `RELAYER_REQUEST_FAILED` | Any relayer call |
| `ConfigurationError` | `CONFIGURATION` | Constructor, worker init |
| `InsufficientConfidentialBalanceError` | `INSUFFICIENT_CONFIDENTIAL_BALANCE` | `confidentialTransfer`, `unshield` |
| `InsufficientERC20BalanceError` | `INSUFFICIENT_ERC20_BALANCE` | `shield` |
| `BalanceCheckUnavailableError` | `BALANCE_CHECK_UNAVAILABLE` | `confidentialTransfer`, `unshield`, `shield` |
| `ERC20ReadFailedError` | `ERC20_READ_FAILED` | `shield` |
| `DelegationSelfNotAllowedError` | `DELEGATION_SELF_NOT_ALLOWED` | `delegateDecryption` |
| `DelegationDelegateEqualsContractError` | `DELEGATION_DELEGATE_EQUALS_CONTRACT` | `delegateDecryption` |
| `DelegationExpiryUnchangedError` | `DELEGATION_EXPIRY_UNCHANGED` | `delegateDecryption` |
| `DelegationNotFoundError` | `DELEGATION_NOT_FOUND` | `revokeDelegation` |
| `DelegationExpiredError` | `DELEGATION_EXPIRED` | `decryptBalanceAs` |
| `DelegationCooldownError` | `DELEGATION_COOLDOWN` | `delegateDecryption`, `revokeDelegation` |
| `DelegationContractIsSelfError` | `DELEGATION_CONTRACT_IS_SELF` | `delegateDecryption` |
| `DelegationExpirationTooSoonError` | `DELEGATION_EXPIRATION_TOO_SOON` | `delegateDecryption` |
| `DelegationNotPropagatedError` | `DELEGATION_NOT_PROPAGATED` | `decryptBalanceAs` |
| `AclPausedError` | `ACL_PAUSED` | Any delegation tx |

Importing the classes:

```ts
import {
    ZamaError,
    matchZamaError,
    SigningRejectedError,
    SigningFailedError,
    EncryptionFailedError,
    DecryptionFailedError,
    ApprovalFailedError,
    TransactionRevertedError,
    InvalidKeypairError,
    KeypairExpiredError,
    NoCiphertextError,
    RelayerRequestFailedError,
    ConfigurationError,
    InsufficientConfidentialBalanceError,
    InsufficientERC20BalanceError,
    BalanceCheckUnavailableError,
    ERC20ReadFailedError,
    DelegationSelfNotAllowedError,
    DelegationDelegateEqualsContractError,
    DelegationExpiryUnchangedError,
    DelegationNotFoundError,
    DelegationExpiredError,
    DelegationCooldownError,
    DelegationContractIsSelfError,
    DelegationExpirationTooSoonError,
    DelegationNotPropagatedError,
    AclPausedError,
} from "@zama-fhe/sdk";
```

## Per-Error Causes and Recovery

### `SigningRejectedError`

User clicked Reject in the wallet during EIP-712. Always propagated; the
SDK never silently retries. The operation can be re-attempted immediately.
Re-prompt only on user action (button click), not on a timer.

### `SigningFailedError`

Wallet attempted to sign but failed for a reason other than rejection -
network, hardware wallet firmware, RPC timeout. Check connectivity and
firmware before retrying.

### `EncryptionFailedError`

FHE encryption failed in the Web Worker. Most common cause: missing WASM
support or restrictive CSP. Add `wasm-unsafe-eval` to the CSP `script-src`
directive. Verify the browser actually supports WebAssembly.

### `DecryptionFailedError`

FHE decryption failed. Recovery depends on cause:

- After page reload during unshield: call `loadPendingUnshield(...)` and
  `token.resumeUnshield(...)`.
- Otherwise: `sdk.revokeSession()` then retry forces a fresh keypair.

### `ApprovalFailedError`

ERC-20 `approve` tx failed during `shield`. NOT the confidential operator
approval. Check gas and token contract approvability. Retry the shield.

### `TransactionRevertedError`

On-chain revert. The error `.message` includes the revert reason when
available. Common causes: insufficient balance, expired operator approval,
finalize on already-finalized unwrap. Inspect and re-attempt only after
fixing the root cause.

### `InvalidKeypairError`

Relayer rejected the FHE keypair (malformed or generated for a different
chain). Recovery:

```ts
matchZamaError(error, {
    INVALID_KEYPAIR: () => {
        sdk.revokeSession();
        showPrompt("Session expired - sign again to continue");
    },
});
```

### `KeypairExpiredError`

The FHE keypair exceeded its TTL. The user re-signs to generate a new one.
Adjust `keypairTTL` if 30 days is wrong for your security model.

### `NoCiphertextError`

The account has no encrypted balance for this contract. NOT an error to
surface as a failure - it is the legitimate "never shielded" state. Show
an empty state in the UI.

### `RelayerRequestFailedError`

HTTP error to the relayer. Exposes `.statusCode`:

- `401` - authentication failed (wrong / missing API key, wrong proxy
  routing).
- `5xx` - relayer unavailable.

Verify `relayerUrl` and `auth` (if direct API key). Check service health.

### `ConfigurationError`

SDK config invalid (forbidden chain, unsupported signer, terminated
relayer) or FHE worker failed to initialize (missing WASM, restrictive
CSP). Verify transport config, CSP headers, and that no prior
`sdk.terminate()` ran on the same instance.

### `InsufficientConfidentialBalanceError`

```ts
class InsufficientConfidentialBalanceError extends ZamaError {
    readonly requested: bigint;
    readonly available: bigint;
    readonly token: Address;
}
```

Thrown by `confidentialTransfer` and `unshield` BEFORE submitting (uses
the cached or freshly-decrypted balance). No retry helps until the balance
increases (incoming transfer or shield).

### `InsufficientERC20BalanceError`

Same shape as the confidential variant, but `token` is the underlying
ERC-20. Thrown by `shield` before submitting. Public read, works for all
wallet types including smart wallets.

### `BalanceCheckUnavailableError`

Balance check is required but cannot run:

- For confidential ops: no cached credentials; the SDK cannot decrypt
  without prompting. Call `token.allow()` first or pass
  `skipBalanceCheck: true`.
- For `shield`: the public ERC-20 read failed. Check connectivity.

### `ERC20ReadFailedError`

`shield` could not read the underlying ERC-20 balance. Network or contract
error. Check connectivity. Distinct from `BalanceCheckUnavailableError`,
which indicates missing credentials for confidential decryption.

### Delegation errors

See `references/zama-sdk-session.md` for the full list of delegation
errors with handling. Quick reference:

- `DelegationSelfNotAllowedError`: delegate equals connected wallet. Use a
  different address.
- `DelegationDelegateEqualsContractError`: delegate equals token contract.
  Use a different address.
- `DelegationExpiryUnchangedError`: client-side no-op skip; the requested
  expiry already matches on-chain. Treat as success.
- `DelegationNotFoundError`: revoking a non-existent delegation. Treat as
  no-op.
- `DelegationExpiredError`: re-grant.
- `DelegationCooldownError`: wait one block, retry.
- `DelegationContractIsSelfError`: contract address equals caller. Verify
  parameters.
- `DelegationExpirationTooSoonError`: pick an expiry at least 1 hour in
  the future or omit for permanent.
- `DelegationNotPropagatedError`: gateway sync delay 1-2 minutes after L1.
  Retry later.
- `AclPausedError`: wait for the protocol team to unpause; an
  operator-level event.

## "No balance" vs "Zero balance"

| State | What it means | Detect |
|---|---|---|
| No balance | Account has never shielded. No encrypted handle exists. | `NoCiphertextError` thrown by `balanceOf` |
| Zero balance | Account has shielded before but holds zero now. | `balanceOf` returns `0n` |

```ts
import { NoCiphertextError } from "@zama-fhe/sdk";

try {
    const balance = await token.balanceOf(); /* could be 0n */
    showBalance(balance);
} catch (error) {
    if (error instanceof NoCiphertextError) {
        showEmptyState("Shield tokens to get started");
    }
}
```

UI must distinguish: showing "0" when there is no balance is misleading.

## Common Symptoms and Fixes

| Symptom | Cause | Fix |
|---|---|---|
| `SigningRejectedError` on every decrypt | Wallet doesn't support `eth_signTypedData_v4` | Update wallet / firmware |
| `balanceOf` rejects with `NoCiphertextError` | Account never shielded | Catch + show empty state |
| `ConfigurationError` on first op | FHE worker init failed | Add `wasm-unsafe-eval` to CSP; check transport config |
| `EncryptionFailedError` mid-flow | CSP blocks WASM | Add `wasm-unsafe-eval` |
| `DecryptionFailedError` after reload | Unshield interrupted | `loadPendingUnshield()` + `resumeUnshield()` |
| `TransactionRevertedError` on finalize | Already finalized | Check unwrap state; `clearPendingUnshield()` |
| `RelayerRequestFailedError` `401` | Wrong API key or auth shape | Check `auth` field on transport |
| `RelayerRequestFailedError` `5xx` | Relayer down | Retry with backoff |
| `InsufficientConfidentialBalanceError` | Balance < amount | Show shortfall; wait for incoming or shield more |
| `InsufficientERC20BalanceError` | ERC-20 balance < shield amount | Acquire more underlying tokens |
| `BalanceCheckUnavailableError` (confidential op) | No cached creds | `token.allow()` first OR `skipBalanceCheck: true` |
| `BalanceCheckUnavailableError` (shield) | ERC-20 read failed | Check connectivity |
| `ERC20ReadFailedError` | RPC issue | Check RPC endpoint health |

## Common Mistakes

- Auto-retrying on `SigningRejectedError` - the user explicitly cancelled.
  Re-prompt only on a fresh user action.
- Treating `NoCiphertextError` as a real error to surface - it is the
  empty-state signal. Catch and branch the UI.
- Confusing `ApprovalFailedError` with operator approval failure - it is
  ERC-20 approval failure. Operator approval failure surfaces as
  `TransactionRevertedError` with a revert reason.
- Treating `BalanceCheckUnavailableError` as fatal in smart-wallet flows -
  pass `skipBalanceCheck: true` for accounts that cannot produce EIP-712
  signatures.
- Catching `Error` and assuming it has a `.code` - check
  `instanceof ZamaError` first or use `matchZamaError` with the `_`
  wildcard.
- Showing `error.message` raw to users - the message is for developers.
  Map `.code` to human strings via `matchZamaError`.
- Pattern-matching on string contents (`error.message.includes("...")`)
  instead of error class. The strings change between versions; the
  class / code does not.
- Using `try/catch` around the entire SDK call chain instead of routing
  via `matchZamaError`. The wildcard is cleaner for cross-cutting concerns
  like toast notifications.
