# Zama SDK: Token, ReadonlyToken, Shield / Unshield / Transfer / Balance

The high-level token API in `@zama-fhe/sdk@^3.0.0`. Read this when the user
is interacting with confidential ERC-7984 tokens through the new SDK. The
underlying contract layer is documented in `references/erc7984.md`.

## Contents

- Creating a `Token` instance (with and without a separate wrapper)
- Shield (public ERC-20 -> confidential)
- Unshield (confidential -> public, two-phase, resumable)
- Confidential transfer
- Operator approvals (`approve` / `transferFrom`)
- Balances and the FHE credential session
- ReadonlyToken (read-only + batch decrypt)
- Low-level token methods (when to drop down)
- Common Mistakes

## Creating a `Token` instance

```ts
import { ZamaSDK } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({ relayer, signer, storage });

/* Single-contract deployment: token IS the wrapper */
const token = sdk.createToken("0xEncryptedERC20");

/* Two-contract deployment: separate wrapper */
const token = sdk.createToken("0xTokenAddress", "0xWrapperAddress");
```

To resolve the wrapper from on-chain registry data:

```ts
const result = await sdk.registry.getConfidentialToken("0xPlainERC20");
if (!result) throw new Error("No wrapper registered for this token");
const token = sdk.createToken("0xPlainERC20", result.confidentialTokenAddress);
```

`sdk.registry` is auto-configured for Mainnet and Sepolia. For Hardhat or
custom chains, pass `registryAddresses` to `ZamaSDK` or use
`sdk.createWrappersRegistry({ [31337]: "0x..." })`.

The token instance is cheap; create one per address per render. In React,
use `useToken({ tokenAddress, wrapperAddress? })` so the instance is
memoized across renders.

## Shield (public ERC-20 -> confidential)

```ts
/* Default: exact approval. Two wallet prompts (approve + shield). */
const { txHash } = await token.shield(1000n);

/* Max approval. First call prompts twice; subsequent shields skip approval. */
await token.shield(1000n, { approvalStrategy: "max" });

/* Skip approval. Wrapper is already approved (e.g. via approveUnderlying). */
await token.shield(1000n, { approvalStrategy: "skip" });

/* Progress callbacks */
await token.shield(1000n, {
    onApprovalSubmitted: (txHash) => updateUI("Approval submitted"),
    onShieldSubmitted: (txHash) => updateUI("Shield submitted"),
});

/* Shield to a different recipient */
await token.shield(1000n, { to: "0xRecipient" });

/* Native-ETH wrappers: pass extra ETH via fees */
await token.shield(1000n, { fees: 100n });
```

`ShieldOptions`:

| Field | Type | Default | Notes |
|---|---|---|---|
| `approvalStrategy` | `"exact" \| "max" \| "skip"` | `"exact"` | `exact` is safest; `skip` if `approveUnderlying` already ran |
| `fees` | `bigint` | - | Extra ETH for native wrappers |
| `to` | `Address` | connected wallet | Recipient of shielded tokens |
| `onApprovalSubmitted` | `(Hex) => void` | - | After approval tx |
| `onShieldSubmitted` | `(Hex) => void` | - | After shield tx |

The SDK validates the public ERC-20 balance before submitting. Throws
`InsufficientERC20BalanceError({ requested, available, token })` if the
balance is too low - no transaction is sent. The check is a public read with
no signing requirement, so it works for smart wallets. For native ETH
shields, the balance check is skipped (the chain validates ETH natively).

After a successful shield, all `useConfidentialBalance` queries are
invalidated automatically in React.

## Unshield (confidential -> public, two-phase, resumable)

Unshielding is two on-chain transactions with a decryption-proof wait
between them: `unwrap` (phase 1) -> wait for proof -> `finalizeUnwrap`
(phase 2). The SDK orchestrates both via `unshield`.

```ts
const { txHash, receipt } = await token.unshield(500n);
/* txHash is the FINALIZE tx (second), not the unwrap. */
```

Progress callbacks let the UI track each phase:

```ts
await token.unshield(500n, {
    onUnwrapSubmitted: (txHash) => updateUI("Unwrap submitted..."),
    onFinalizing: () => updateUI("Waiting for decryption proof..."),
    onFinalizeSubmitted: (txHash) => updateUI("Unshield complete!"),
});
```

Callbacks are safe to throw - the unshield still completes.

```ts
/* Unshield the entire confidential balance */
await token.unshieldAll();
```

`UnshieldOptions` shares `skipBalanceCheck` (default `false`) plus the three
phase callbacks. Pass `skipBalanceCheck: true` for smart wallets that
cannot produce EIP-712 signatures - `unshield` will not pre-decrypt the
balance and will rely on the contract to revert if insufficient.

Throws:

- `InsufficientConfidentialBalanceError({ requested, available, token })`
  - balance < amount.
- `BalanceCheckUnavailableError` - balance check needed but no cached
  credentials. Call `token.allow()` first or pass `skipBalanceCheck: true`.

### Resumable unshield (browser navigation between phases)

If the user closes the page after `unwrap` but before `finalizeUnwrap`, the
unwrap is on-chain but the tokens are stuck. The SDK exposes four helpers:

```ts
import {
    savePendingUnshield,
    loadPendingUnshield,
    clearPendingUnshield,
} from "@zama-fhe/sdk";

/* BEFORE finalize: persist the unwrap tx hash in storage.
   The SDK does NOT do this automatically. */
await savePendingUnshield(storage, wrapperAddress, unwrapTxHash);

/* On next page load: detect a pending unshield. */
const pending = await loadPendingUnshield(storage, wrapperAddress);
if (pending) {
    await token.resumeUnshield(pending);
    await clearPendingUnshield(storage, wrapperAddress);
}
```

`token.resumeUnshield(unwrapTxHash, callbacks?)` polls for the proof and
submits the finalize. Same callback shape as `unshield`.

## Confidential transfer

```ts
const { txHash } = await token.confidentialTransfer("0xRecipient", 500n);

/* Smart wallet (no EIP-712 signing) */
await token.confidentialTransfer("0xRecipient", 500n, { skipBalanceCheck: true });

/* Progress callbacks */
await token.confidentialTransfer("0xRecipient", 500n, {
    onEncryptComplete: () => updateUI("Encrypted, sending..."),
    onTransferSubmitted: (txHash) => updateUI("Tx in flight"),
});
```

The amount is encrypted client-side before reaching the chain. Observers
see the transaction but not the value.

Operator transfer (after `approve` from the holder):

```ts
await token.confidentialTransferFrom("0xFrom", "0xTo", 500n);
```

Throws (same as `unshield`): `InsufficientConfidentialBalanceError`,
`BalanceCheckUnavailableError`.

The default balance check decrypts silently when credentials are cached. If
not cached, it prompts a wallet signature - call `token.allow()` first to
batch the prompt with other operations.

## Operator approvals

ERC-7984 uses time-bounded operator approvals, not unbounded allowances.

```ts
/* Approve for 1 hour (default) */
await token.approve("0xSpender");

/* Approve until a specific Unix timestamp (seconds) */
const expiry = Math.floor(Date.now() / 1000) + 86_400;
await token.approve("0xSpender", expiry);

/* Check approval status */
const approved = await token.isApproved("0xSpender");
const approvedFor = await token.isApproved("0xSpender", "0xOwner");
```

Operator transfer approval and operator unshield approval are SEPARATE
concerns. Approving an operator for `confidentialTransferFrom` does NOT
auto-grant `unshield` rights. The owner must call `approve` again with the
unshield-operator semantics (covered upstream by the contract; the SDK
method is the same).

## Balances and the FHE credential session

The first `balanceOf()` for a token prompts a wallet signature to create
FHE decryption credentials. Subsequent calls are silent.

```ts
/* My own balance */
const balance = await token.balanceOf();

/* Someone else's balance (if you have ACL rights) */
const other = await token.balanceOf("0xOwner");

/* Pre-authorize multiple tokens with one signature */
import { ReadonlyToken } from "@zama-fhe/sdk";
const tokenA = sdk.createReadonlyToken("0xTokenA");
const tokenB = sdk.createReadonlyToken("0xTokenB");
await ReadonlyToken.allow(tokenA, tokenB);
/* All later balanceOf() calls on tokenA / tokenB are silent. */
```

Decrypted balances are cached automatically in `sdk.cache`, scoped by
`(token address + owner address + encrypted handle)`. When a transfer /
shield / unshield changes the on-chain handle, the new key naturally misses
the cache and triggers a fresh decryption. The cache is best-effort: if
storage fails, decryption falls back silently.

`token.confidentialBalanceOf()` returns the raw `Hex` handle without
decrypting. Useful when you want to detect "no balance yet" before
prompting for a signature:

```ts
import { isZeroHandle } from "@zama-fhe/sdk";

const handle = await token.confidentialBalanceOf();
if (isZeroHandle(handle)) {
    showEmptyState("Shield tokens to get started");
}
```

`isZeroHandle` is a pure helper (no signing). Combine it with
`NoCiphertextError` from the error hierarchy to distinguish:

- `NoCiphertextError` - account has never shielded; no encrypted balance
  exists. Show "no confidential balance yet".
- Balance of `0n` - account has shielded before but holds zero now. Show
  "Balance: 0".

## ReadonlyToken (read-only + batch decrypt)

Use when the caller does not need to write transactions. Ideal for portfolio
dashboards.

```ts
import { ReadonlyToken } from "@zama-fhe/sdk";

const tokens = addresses.map((a) => sdk.createReadonlyToken(a));

/* One signature covers the whole list */
await ReadonlyToken.allow(...tokens);

/* Decrypt every balance in parallel; partial failure does not reject */
const { results, errors } = await ReadonlyToken.batchBalancesOf(tokens, owner);
for (const [address, balance] of results) console.log(address, balance);
for (const [address, error] of errors) console.warn(address, error);
```

`results` is `Map<Address, bigint>`. `errors` is `Map<Address, ZamaError>`.
A bad token never throws the whole batch.

Per-instance methods:

| Method | Returns |
|---|---|
| `balanceOf(owner?)` | `Promise<bigint>` |
| `confidentialBalanceOf(owner?)` | `Promise<Hex>` (raw handle) |
| `name()` / `symbol()` | `Promise<string>` |
| `decimals()` | `Promise<number>` |
| `isConfidential()` | `Promise<boolean>` (ERC-7984 support) |
| `isWrapper()` | `Promise<boolean>` |
| `underlyingToken()` | `Promise<Address>` (wrappers only) |
| `allowance(wrapperAddr, owner?)` | `Promise<bigint>` (underlying ERC-20 allowance) |
| `allow()` / `revoke()` / `isAllowed()` | session control for THIS token |
| `isZeroHandle(handle)` | `boolean` (pure) |

`ReadonlyToken` does not expose `shield`, `unshield`, `confidentialTransfer`,
`approve`, `confidentialTransferFrom`, `approveUnderlying`, `unwrap`,
`unwrapAll`, or `finalizeUnwrap`.

## Low-level token methods (when to drop down)

`Token.unshield` is built on `unwrap` + `finalizeUnwrap`. If you need
manual control:

```ts
/* Phase 1 */
await token.unwrap(500n);
/* or */
await token.unwrapAll();

/* Phase 2 - after the decryption proof is available */
await token.finalizeUnwrap(burnAmountHandle);
```

Use these only when:

- You orchestrate the proof wait yourself (e.g. cross-system queue).
- You want a different observer to call `finalizeUnwrap` than the unwrap
  initiator.
- You are debugging or instrumenting the protocol.

For everyday flows, `token.unshield` is correct.

`approveUnderlying(amount?)` exists separately from the
`approvalStrategy: "skip"` branch of `shield`. Default is max approval.
Pre-approve to skip the approval prompt during shield:

```ts
await token.approveUnderlying(); /* max approval, one-time */
await token.shield(1000n, { approvalStrategy: "skip" });
```

## Common Mistakes

- Using `Token` when only reads are needed - prefer `ReadonlyToken` so the
  caller cannot accidentally trigger a write transaction.
- Calling `balanceOf()` repeatedly without `ReadonlyToken.allow(...)` first
  on multi-token dashboards - each token prompts its own signature.
- Forgetting to call `savePendingUnshield(...)` BEFORE the unwrap completes,
  then losing the tx hash on browser navigation. The SDK does NOT auto-save.
- Confusing `approveUnderlying` (public ERC-20 allowance) with
  `approve` (confidential operator). They affect different contracts.
- Reusing operator approval for both transfer and unshield - the contract
  treats them as separate scopes.
- Treating `NoCiphertextError` as an error to surface; it is the legitimate
  "never shielded" state. Branch your UI to show an empty-state instead.
- Calling `Token.unshield` from a smart wallet without
  `skipBalanceCheck: true` - the EIP-712 sign required to decrypt the
  balance fails. Skip the check or call `token.allow()` first.
- Treating `txHash` from `unshield` as the unwrap hash. It is the FINALIZE
  hash. The unwrap hash arrives via `onUnwrapSubmitted`.
- Caching `Token` instances across signers - the instance binds to the
  active signer's session. Re-create on signer change (or rely on
  `useToken` in React, which handles this).
- Hard-coding registry addresses for Hardhat instead of passing
  `registryAddresses: { [31337]: "0x..." }` to `ZamaSDK` - the built-in
  registry resolution returns `undefined` for chain 31337.
