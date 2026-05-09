# Zama SDK: Session Model and Delegated Decryption

How `@zama-fhe/sdk@^3.0.0` reduces wallet prompts: one EIP-712 signature
unlocks decrypts for the configured TTL, decrypted values are cached, and
delegation lets one address authorize another to decrypt without sharing
private keys. Read this when balances are decrypted, when prompts feel
excessive, or when designing dashboards that read multiple users' balances.

## Contents

- TTLs: `keypairTTL` vs `sessionTTL`
- The Two Layers (Keypair + Session)
- Pre-Authorize: `allow` and `userDecrypt`
- The Decrypt Cache
- Session Lifecycle Events
- Delegated Decryption Overview
- Granting / Revoking / Querying Delegation
- Decrypting as a Delegate
- Delegation Errors and States
- Per-Handle Delegation Check
- Common Mistakes

## TTLs: `keypairTTL` vs `sessionTTL`

Two timers control how long the SDK avoids wallet prompts:

| TTL | What it covers | Default | Range |
|---|---|---|---|
| `keypairTTL` | The ML-KEM re-encryption keypair the relayer uses to deliver decrypted values to this client. | `2_592_000` (30 days) | `> 0` and `<= 31_536_000` (365 days). `0` rejected at construction; `> 365d` clamped + console warning |
| `sessionTTL` | The EIP-712 wallet signature that authorizes the keypair for a set of contracts. | `2_592_000` (30 days) | `number` (seconds), `0` (sign-every-op), or `"infinite"` |

```ts
const sdk = new ZamaSDK({
    relayer,
    signer,
    storage,
    keypairTTL: 604_800, /* 7 days */
    sessionTTL: 3_600, /* 1 hour */
});
```

`keypairTTL = 0` throws at construction. The keypair is required to
establish the relayer connection, so a zero TTL has no defensible meaning.

`sessionTTL = 0` is the high-security mode: every operation triggers a
fresh wallet prompt. `"infinite"` keeps the session forever (until
`revokeSession`, wallet disconnect, account change, or chain change).

The 365-day ceiling on `keypairTTL` is enforced by the FHEVM ACL contract -
the contract rejects `durationDays > 365`. If you pass a higher value, the
SDK clamps to 365 days and logs a warning.

## The Two Layers (Keypair + Session)

Decryption uses two cached artifacts, both keyed by `(address, chainId)`:

1. **FHE keypair** - persisted via the `storage` adapter you passed to the
   SDK constructor. Encrypted with the connected wallet's signature so it
   cannot be read without re-authenticating. Survives process restarts.
2. **Session signature** - persisted via `sessionStorage` (defaults to
   in-memory). The EIP-712 signature that authorizes the FHE keypair to
   decrypt for a set of contracts.

A wallet prompt fires when EITHER layer is missing or invalid. Most apps
should pair `indexedDBStorage` with the default in-memory session
(reasonable for browsing) OR with `chromeSessionStorage` (web extensions
that need session survival across SW restarts).

## Pre-Authorize: `allow` and `userDecrypt`

`sdk.allow(contractAddresses)` performs the EIP-712 sign once for a list
of contracts. Subsequent `userDecrypt` calls for handles tied to those
contracts reuse the cached credentials silently.

```ts
/* One prompt for three tokens */
await sdk.allow([cUSDT, cDAI, cWETH]);

const a = await sdk.userDecrypt([{ handle: h1, contractAddress: cUSDT }]);
const b = await sdk.userDecrypt([{ handle: h2, contractAddress: cDAI }]);
```

Per-token convenience equivalents:

```ts
await token.allow();           /* one prompt for THIS token */
await token.revoke();          /* clears session for THIS token */
const ok = await token.isAllowed();
```

`sdk.userDecrypt(handles)` returns `Record<Handle, ClearValueType>`:

```ts
const values = await sdk.userDecrypt([
    { handle: balanceHandle, contractAddress: cUSDT },
    { handle: flagHandle, contractAddress: someContract },
]);
console.log(values[balanceHandle]); /* 1000n */
```

Three behaviors that matter when designing flows:

- Cached values return without a relayer call. If everything is cached,
  no events fire and the function returns instantly.
- Zero handles (32 zero bytes) resolve to `0n` without prompting and
  without hitting the relayer.
- Handles from different contracts are batched per-contract, up to 5
  concurrent relayer requests.

When the relayer IS called, credentials are derived from the full input
handle set (including cached and zero handles), so the credential cache key
stays stable regardless of which handles happen to already be cached. If
every handle is zero or cached, no credentials are acquired and no wallet
prompt is shown.

## The Decrypt Cache

`sdk.cache` is a `DecryptCache` backed by the same `GenericStorage` you
passed for `storage`. So in browser apps it persists in IndexedDB and
survives reloads.

Entries are scoped by `(requester, contractAddress, handle)`. A different
signer cannot read another user's cached entries - this mirrors the
on-chain ACL.

Auto-clear triggers:

- `sdk.revokeSession()` - clears entries for the current signer.
- `sdk.signer.subscribe(...)` lifecycle: disconnect / account change /
  chain change all clear the entire cache.
- A new on-chain handle (after a transfer / shield / unshield) is a new
  cache key - the old entry naturally misses.

Manual control:

```ts
const address = await sdk.signer.getAddress();
await sdk.cache.clearForRequester(address);

await sdk.cache.clearAll();
```

The cache is best-effort: storage failures never throw; the SDK falls back
to a fresh decryption silently.

## Session Lifecycle Events

If `signer.subscribe?` is implemented (`WagmiSigner` always; `ViemSigner`
and `EthersSigner` when `ethereum` is passed), the SDK auto-handles:

- `onDisconnect` -> `revokeSession()` + clear cache.
- `onAccountChange` -> `revokeSession()` + clear cache.
- `onChainChange` -> `revokeSession()` + clear cache (per docs the cache
  clears; per `WagmiSigner` notes, chain switches do NOT trigger
  revocation. The wagmi-specific behavior is the more permissive of the
  two: credentials are keyed by `(address, chainId)`, so each chain
  maintains its own session. Confirm against the runtime build before
  relying on either).

If your custom signer cannot implement `subscribe`, wire wallet events
manually to `sdk.revokeSession()`.

You can additionally subscribe to lifecycle and decryption events for
telemetry:

```ts
import { ZamaSDK, ZamaSDKEvents } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({
    relayer,
    signer,
    storage,
    onEvent: (event) => {
        if (event.type === ZamaSDKEvents.DecryptEnd) {
            console.log(`Decrypted ${event.handles.length} in ${event.durationMs}ms`);
        }
        if (event.type === ZamaSDKEvents.DecryptError) {
            console.error("Decrypt failed:", event.error);
        }
    },
});
```

`onEvent` is a single function. To fan out to multiple listeners, bridge
it into a standard event bus (`window.dispatchEvent` /
`new CustomEvent(...)` in the browser, `EventEmitter` in Node).

## Delegated Decryption Overview

Delegation lets one address (delegator) grant another (delegate) the right
to decrypt the delegator's balance for a specific token. Use cases:

- Portfolio dashboards reading balances without holding keys.
- Fund managers monitoring deposits.
- Auditors verifying holdings without the owner being online.

The delegate never receives the delegator's keys. They use their own FHE
keypair plus a delegated EIP-712 flow. The relayer verifies the on-chain
delegation (recorded in the ACL contract) before serving the decryption.

The ACL address comes from the relayer transport config, which the network
presets (`SepoliaConfig`, `MainnetConfig`, `HardhatConfig`) include
automatically.

## Granting / Revoking / Querying Delegation

```ts
/* Permanent delegation */
await token.delegateDecryption({ delegateAddress: "0xDelegate" });

/* With expiration */
await token.delegateDecryption({
    delegateAddress: "0xDelegate",
    expirationDate: new Date("2027-12-31T00:00:00Z"),
});

/* Both return { txHash, receipt } */
```

`expirationDate` must be at least 1 hour in the future. The SDK validates
client-side and throws `DelegationExpirationTooSoonError` before sending,
mirroring the on-chain `ExpirationDateBeforeOneHour` revert. With no
`expirationDate`, the SDK uses `2^64 - 1` (effectively permanent).

Date handling: the SDK accepts a JS `Date` and converts it to UTC Unix
seconds. `Date.getTime()` returns UTC ms regardless of local timezone, so
all of these produce the same on-chain expiry:

```ts
new Date("2027-12-31T00:00:00Z");
new Date("2027-12-31T00:00:00+05:30");
new Date(2027, 11, 31);
```

**Gateway propagation delay:** the delegation is recorded on L1 immediately,
but the gateway (deployed on Arbitrum) must sync via cross-chain event
propagation. Wait 1-2 minutes after the tx mines before calling
`decryptBalanceAs`, or you will hit `DelegationNotPropagatedError`.

Batch delegation across many tokens:

```ts
import { Token, ZamaError } from "@zama-fhe/sdk";

const tokens = addresses.map((a) => sdk.createToken(a));

const results = await Token.batchDelegateDecryption({
    tokens,
    delegateAddress: "0xDelegate",
    expirationDate: new Date("2027-12-31"),
});

/* results: Map<Address, TransactionResult | ZamaError>. Partial failure
   does not reject the whole batch. */
for (const [address, result] of results) {
    if (result instanceof ZamaError) {
        console.error(`${address} failed:`, result.message);
    }
}
```

Revoke:

```ts
await token.revokeDelegation({ delegateAddress: "0xDelegate" });

const results = await Token.batchRevokeDelegation({
    tokens,
    delegateAddress: "0xDelegate",
});
```

Query (on `Token` AND `ReadonlyToken`):

```ts
const active = await readonlyToken.isDelegated({
    delegatorAddress: "0xDelegator",
    delegateAddress: "0xDelegate",
});

const expiry = await readonlyToken.getDelegationExpiry({
    delegatorAddress: "0xDelegator",
    delegateAddress: "0xDelegate",
});
/* 0n = never set or revoked
   2^64 - 1 = permanent
   otherwise = UTC Unix seconds */

const expiryDate = new Date(Number(expiry) * 1000);
```

## Decrypting as a Delegate

```ts
/* Decrypt the delegator's own balance */
const balance = await readonlyToken.decryptBalanceAs({
    delegatorAddress: "0xDelegator",
});

/* Decrypt a different owner's balance through the delegator's grant.
   ACL is checked against delegatorAddress, not owner. */
const balance = await readonlyToken.decryptBalanceAs({
    delegatorAddress: "0xDelegator",
    owner: "0xOwner",
});
```

Decrypted values are cached scoped by `(token, owner, handle)`. A new
on-chain handle invalidates naturally - no manual clear needed.

Batch:

```ts
const tokens = addresses.map((a) => sdk.createReadonlyToken(a));

const balances = await ReadonlyToken.batchDecryptBalancesAs(tokens, {
    delegatorAddress: "0xDelegator",
    handles: preloadedHandles, /* optional - skip on-chain reads */
    owner: "0xOwner", /* optional - defaults to delegatorAddress */
    maxConcurrency: 3, /* default Infinity */
    onError: (err, addr) => {
        console.error(addr, err);
        return 0n; /* fallback for failed tokens */
    },
});
/* balances: Map<Address, bigint> */
```

`BatchDecryptAsOptions`:

| Property | Type | Notes |
|---|---|---|
| `delegatorAddress` | `Address` | Required. The grantor. |
| `handles` | `Handle[]` | Optional pre-fetched handles to skip the on-chain read. |
| `owner` | `Address` | Defaults to `delegatorAddress`. |
| `maxConcurrency` | `number` | Default `Infinity`. |
| `onError` | `(error, address) => bigint` | Per-token failure recovery. |

## Delegation Errors and States

States of `(delegator, delegate, contract)`:

| State | On-chain expiry | Detect via |
|---|---|---|
| Never set | `0n` | `getDelegationExpiry()` returns `0n` |
| Active | future timestamp | `isDelegated()` returns `true` |
| Expired | past non-zero | `isDelegated()` returns `false`, `getDelegationExpiry()` returns past |
| Revoked | `0n` (reset by contract) | indistinguishable from "Never set" via state reads; query `RevokedDelegationForUserDecryption` events to differentiate |

Pre-flight (client-side) errors caught BEFORE submitting:

| Error | When |
|---|---|
| `DelegationExpirationTooSoonError` | Expiration < 1h in the future |
| `DelegationSelfNotAllowedError` | Delegate equals connected wallet |
| `DelegationDelegateEqualsContractError` | Delegate equals token contract |
| `DelegationExpiryUnchangedError` | New expiry equals current; no on-chain change needed |
| `DelegationNotFoundError` | Revoking a delegation that was never established |

On-chain reverts mapped to typed errors:

| Error | Solidity revert | When |
|---|---|---|
| `DelegationCooldownError` | `AlreadyDelegatedOrRevokedInSameBlock` | One delegate/revoke per `(delegator, delegate, contract)` per block |
| `DelegationContractIsSelfError` | `SenderCannotBeContractAddress` | Contract equals caller |
| `AclPausedError` | `EnforcedPause` | ACL paused |
| `TransactionRevertedError` | (any other revert) | Fallback |

Decrypt-time errors:

| Error | When |
|---|---|
| `DecryptionFailedError` | Delegated decrypt failed or relayer returned no value |
| `SigningRejectedError` | User rejected the prompt - never silently retry |
| `SigningFailedError` | Signing failed for any other reason |
| `NoCiphertextError` | Relayer 400 - account has no ciphertext |
| `RelayerRequestFailedError` | Relayer non-400 HTTP error |
| `DelegationExpiredError` | Delegation expired |
| `DelegationNotPropagatedError` | L1 has the delegation; gateway has not synced. Wait 1-2 min |

`SigningRejectedError` is always propagated. The SDK never silently
retries or falls through to a fresh credential flow when the user
rejected. This guarantees users can always cancel.

Events emitted during delegation operations:

| Event | When |
|---|---|
| `DelegationSubmitted` | Delegation tx sent |
| `RevokeDelegationSubmitted` | Revocation tx sent |

```ts
import { ZamaSDKEvents } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({
    /* ... */
    onEvent: (event) => {
        if (event.type === ZamaSDKEvents.DelegationSubmitted) {
            console.log("Delegation tx:", event.txHash);
        }
        if (event.type === ZamaSDKEvents.RevokeDelegationSubmitted) {
            console.log("Revocation tx:", event.txHash);
        }
    },
});
```

## Per-Handle Delegation Check

```ts
import { isHandleDelegatedContract } from "@zama-fhe/sdk";

const isDelegated = await publicClient.readContract(
    isHandleDelegatedContract(
        aclAddress,
        delegatorAddress,
        delegateAddress,
        tokenAddress,
        handle,
    ),
);
```

This wraps a call to `ACL.isHandleDelegatedForUserDecryption()`. Use it
when a single handle's delegation status is needed without going through
the token API.

ACL delegation events (`DelegatedForUserDecryption`,
`RevokedDelegationForUserDecryption`) are decodable through the SDK's
event decoders. See `references/zama-sdk-activity.md` for the full
decoder list.

## Common Mistakes

- Setting `keypairTTL: 0` - throws at construction. The keypair is
  required.
- Setting `sessionTTL: 0` then complaining about prompts on every op -
  that is the design. Use a positive number for caching.
- Setting `keypairTTL > 365 days` - silently capped to 365 days with a
  console warning. The on-chain ACL rejects longer durations.
- Calling `sdk.userDecrypt` for many contracts without pre-authorizing
  via `sdk.allow(...)` - each contract that misses the credential cache
  creates its own prompt.
- Treating the cache as authoritative across users - the cache is keyed
  by `(requester, contract, handle)`. A different requester cannot read
  another user's entries; this is by design and mirrors the on-chain ACL.
- Calling `decryptBalanceAs` immediately after `delegateDecryption` -
  hit `DelegationNotPropagatedError`. Wait 1-2 minutes for gateway sync.
- Auto-retrying after `SigningRejectedError` - the SDK never does this and
  neither should the app. The user explicitly cancelled.
- Treating `DelegationNotFoundError` from a revoke as a real failure - it
  just means the delegation was never set or was already revoked. Branch
  to a no-op.
- Distinguishing "Revoked" from "Never set" via expiry reads - the contract
  resets to `0n` on revocation. Use `RevokedDelegationForUserDecryption`
  events instead.
- Granting an expiry less than 1 hour in the future - both the SDK
  pre-flight and the contract reject. Use 1 hour or longer.
- Using `delegateDecryption` and `revokeDelegation` for the same
  `(delegator, delegate, contract)` in the same block - second call
  reverts with `AlreadyDelegatedOrRevokedInSameBlock`. Wait at least one
  block.
