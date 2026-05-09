# Zama SDK: Activity Feeds, Event Decoders, Registry, Builders, Operator Approvals

The reference layer for everything the SDK does outside the `Token`
high-level API: parsing on-chain events, building activity feeds,
querying the on-chain wrappers registry, calling raw contract builders,
and managing operator approvals. Read this when the user is implementing
dashboards, custom UI surfaces, or integrating with non-token confidential
contracts.

## Contents

- Event Decoders (Token + ACL)
- Activity Feed Pipeline
- WrappersRegistry Class
- Contract Builders (low-level call configs)
- Operator Approvals (full surface)
- FHE artifact cache (FHE pubkey + CRS)
- Common Mistakes

## Event Decoders (Token + ACL)

Token contracts and the ACL contract emit different event sets. The SDK
exports decoders for both.

```ts
import {
    /* Token events */
    TOKEN_TOPICS,
    decodeOnChainEvents,
    decodeConfidentialTransfer,
    decodeWrapped,
    decodeUnwrapRequested,
    decodeUnwrappedFinalized,
    decodeUnwrappedStarted,
    findWrapped,
    findUnwrapRequested,

    /* ACL delegation events */
    ACL_TOPICS,
    AclTopics,
    decodeDelegatedForUserDecryption,
    decodeRevokedDelegationForUserDecryption,
    decodeAclEvent,
    decodeAclEvents,
    findDelegatedForUserDecryption,
    findRevokedDelegationForUserDecryption,
} from "@zama-fhe/sdk";
```

### Token decoders

`decodeOnChainEvents(logs)` decodes an array of logs into typed events
each with a `.type` discriminator: `"ConfidentialTransfer"`, `"Wrapped"`,
`"UnwrapRequested"`, `"UnwrappedFinalized"`, `"UnwrappedStarted"`.

Single-log decoders return the typed event or `null` if the log does not
match. Use these to filter a `receipt.logs`:

```ts
for (const log of receipt.logs) {
    const transfer = decodeConfidentialTransfer(log);
    if (transfer) {
        console.log(`Transfer ${transfer.from} -> ${transfer.to}`);
    }
}
```

`findWrapped(logs)` and `findUnwrapRequested(logs)` return the first
matching event in an array. Useful right after a tx mines:

```ts
const receipt = await walletClient.waitForTransactionReceipt({ hash: txHash });
const wrapped = findWrapped(receipt.logs);
if (wrapped) console.log(`Wrapped ${wrapped.amount}`);
```

`TOKEN_TOPICS` is a `Hex[]` of all five topic hashes. Pass it as the
nested topic filter to `eth_getLogs` to fetch every relevant token event
in one RPC:

```ts
const logs = await publicClient.getLogs({
    address: tokenAddress,
    topics: [TOKEN_TOPICS],
    fromBlock: deployBlock,
    toBlock: "latest",
});
```

### ACL decoders

ACL events live on the ACL contract, NOT the token. They are
**not** included in `TOKEN_TOPICS` or `decodeOnChainEvents`.

```ts
const aclLogs = await publicClient.getLogs({
    address: aclAddress, /* from SepoliaConfig.aclContractAddress, MainnetConfig.aclContractAddress, or HardhatConfig.aclContractAddress */
    topics: [ACL_TOPICS],
    fromBlock: startBlock,
    toBlock: "latest",
});

const events = decodeAclEvents(aclLogs);
```

Two event types:

`DelegatedForUserDecryptionEvent`:

| Field | Type |
|---|---|
| `eventName` | `"DelegatedForUserDecryption"` |
| `delegator` | `Address` |
| `delegate` | `Address` |
| `contractAddress` | `Address` |
| `delegationCounter` | `bigint` (monotonic) |
| `oldExpirationDate` | `bigint` (0 if first) |
| `newExpirationDate` | `bigint` |

`RevokedDelegationForUserDecryptionEvent`: same shape minus
`newExpirationDate`. Use this to distinguish the "revoked" state from
"never set" (the on-chain ACL resets expiry to `0n` on revocation, so
state reads cannot tell them apart).

`decodeAclEvent(log)` tries both decoders and returns the first match.
`findDelegatedForUserDecryption(logs)` and
`findRevokedDelegationForUserDecryption(logs)` return the first matching
event or `undefined`.

## Activity Feed Pipeline

The `parseActivityFeed` -> `extractEncryptedHandles` ->
`sdk.userDecrypt` -> `applyDecryptedValues` -> `sortByBlockNumber`
pipeline turns raw token logs into a UI-ready feed.

```ts
import {
    parseActivityFeed,
    extractEncryptedHandles,
    applyDecryptedValues,
    sortByBlockNumber,
    TOKEN_TOPICS,
} from "@zama-fhe/sdk";

/* 1. Fetch logs */
const logs = await publicClient.getLogs({
    address: tokenAddress,
    topics: [TOKEN_TOPICS],
    fromBlock: startBlock,
    toBlock: "latest",
});

/* 2. Parse into classified items relative to userAddress.
   Each item has .type, .direction, .from, .to, .encryptedHandle (or
   .amount for plaintext events like Wrapped), .blockNumber. */
const items = parseActivityFeed(logs, userAddress);

/* 3. Pull out unique handles that need decrypting */
const handles = extractEncryptedHandles(items);

/* 4. Decrypt all handles in one userDecrypt batch */
const decrypted = await sdk.userDecrypt(
    handles.map((handle) => ({ handle, contractAddress: tokenAddress })),
);

/* 5. Attach decrypted amounts to the items.
   The decrypted record from sdk.userDecrypt is passed directly. */
const enriched = applyDecryptedValues(items, decrypted);

/* 6. Sort newest first */
const feed = sortByBlockNumber(enriched);
```

Each item's `direction` is one of `"incoming"`, `"outgoing"`, or
`"self"`. `applyDecryptedValues` adds `.amount.decryptedValue: bigint`
(for events that had encrypted amounts).

In React, the entire pipeline collapses into `useActivityFeed`:

```tsx
const { data: feed, isLoading } = useActivityFeed({
    tokenAddress: "0xToken",
    logs,
    userAddress,
    decrypt: true, /* false to skip decryption (metadata only) */
});
```

## WrappersRegistry Class

The on-chain registry that maps public ERC-20 addresses to their
confidential wrappers (and vice versa). `sdk.registry` is the
auto-configured shared instance. For one-off use, instantiate directly.

```ts
import { WrappersRegistry, DefaultRegistryAddresses } from "@zama-fhe/sdk";

const registry = new WrappersRegistry({
    signer,
    registryAddresses: { [31337]: "0xYourHardhatRegistry" }, /* optional */
    registryTTL: 3600, /* optional, default 24h */
});
```

Constructor:

| Field | Type | Notes |
|---|---|---|
| `signer` | `GenericSigner` | Required. Used for read calls. |
| `registryAddresses` | `Record<number, Address>` | Merged on top of `DefaultRegistryAddresses`. Pass for custom or local chains. |
| `registryTTL` | `number` | Cached read TTL in seconds. Default `86_400` (24h). |

Methods you will actually use:

| Method | Returns |
|---|---|
| `getRegistryAddress()` | `Promise<Address>`. Throws `ConfigurationError` if no address for the current chain. |
| `listPairs(opts?)` | Paginated. `{ page, pageSize, metadata }`. With `metadata: true` enriches each pair with name/symbol/decimals/totalSupply. |
| `getConfidentialToken(tokenAddr)` | `{ confidentialTokenAddress, isValid } \| null`. Negative lookups cached for 5 min. |
| `getUnderlyingToken(confidentialAddr)` | `{ tokenAddress, isValid } \| null`. Reverse lookup. |
| `getTokenPairs()` | Full unsorted list. |
| `getTokenPairsLength()` | `bigint` count. |
| `getTokenPairsSlice(from, to)` | `[from, to)` index range. |
| `getTokenPair(index)` | Single pair by index. |
| `getConfidentialTokenAddress(tokenAddr)` | `[found, address]` tuple - low-level shape for direct on-chain ABI calls. |
| `getTokenAddress(confidentialAddr)` | `[found, address]` reverse tuple. |
| `isConfidentialTokenValid(confidentialAddr)` | `boolean` - registered AND valid. |
| `refresh()` | Synchronous. Force-invalidates the in-memory cache. Next read fetches fresh. |

`DefaultRegistryAddresses`:

```ts
import { DefaultRegistryAddresses } from "@zama-fhe/sdk";
/* { 1: "0xeb5015fF021DB115aCe010f23F55C2591059bBA0",
     11155111: "0xDEbdfa25...",
     560048 (Hoodi): "0x..." } */
```

Hardhat (`31337`) is NOT in the defaults. Pass it via
`registryAddresses` when constructing.

## Contract Builders (low-level call configs)

Every builder returns a `ReadContractConfig` or `WriteContractConfig`
shape:

```ts
type ReadContractConfig = {
    address: Address;
    abi: Abi;
    functionName: string;
    args: readonly unknown[];
};

type WriteContractConfig = ReadContractConfig & {
    value?: bigint;
    gas?: bigint;
};
```

Use builders only for raw contract control: custom transaction pipelines,
batch executors, integrations with non-viem/non-ethers stacks. The
`Token` API wraps these.

Full builder list:

ERC-20 basics: `nameContract`, `symbolContract`, `decimalsContract`,
`balanceOfContract`, `allowanceContract`, `approveContract`.

Confidential ops: `confidentialBalanceOfContract`,
`confidentialTransferContract`, `confidentialTransferFromContract`,
`isOperatorContract`, `setOperatorContract`,
`confidentialTotalSupplyContract`, `rateContract`.

Wrapping: `wrapContract`, `unwrapContract`, `unwrapFromBalanceContract`,
`finalizeUnwrapContract`, `underlyingContract`,
`inferredTotalSupplyContract`, `totalSupplyContract` (deprecated alias).

Discovery: `supportsInterfaceContract`, `isConfidentialTokenContract`,
`isConfidentialWrapperContract`.

Registry: `getTokenPairsContract`, `getTokenPairsLengthContract`,
`getTokenPairsSliceContract`, `getTokenPairContract`,
`getConfidentialTokenAddressContract`, `getTokenAddressContract`,
`isConfidentialTokenValidContract`.

Delegation: `delegateForUserDecryptionContract`,
`revokeDelegationContract`, `getDelegationExpiryContract`,
`isHandleDelegatedContract`.

Executing builders:

```ts
/* viem-typed helpers from /viem subpath */
import {
    readConfidentialBalanceOfContract,
    writeWrapContract,
} from "@zama-fhe/sdk/viem";

const handle = await readConfidentialBalanceOfContract(publicClient, tokenAddr, userAddr);
const txHash = await writeWrapContract(walletClient, wrapperAddr, recipient, amount);

/* ethers-typed helpers from /ethers subpath */
import {
    readConfidentialBalanceOfContract,
    writeWrapContract,
} from "@zama-fhe/sdk/ethers";

const handle = await readConfidentialBalanceOfContract(provider, tokenAddr, userAddr);
const txHash = await writeWrapContract(signer, wrapperAddr, recipient, amount);

/* Raw config destructuring for any execution layer */
import { wrapContract } from "@zama-fhe/sdk";

const { address, abi, functionName, args } = wrapContract(wrapperAddr, recipient, amount);
```

All builders validate addresses at call time. A malformed address throws
immediately, not at call resolution.

## Operator Approvals (full surface)

ERC-7984 uses time-bounded operator approvals (no unbounded allowances).
The `Token` API exposes:

```ts
/* Default 1 hour expiration */
await token.approve("0xSpender");

/* Custom expiry (Unix seconds) */
const expiry = Math.floor(Date.now() / 1000) + 86_400;
await token.approve("0xSpender", expiry);

/* Check approval status */
const ok = await token.isApproved("0xSpender");
const okFor = await token.isApproved("0xSpender", "0xOwner");

/* Operator transfer */
await token.confidentialTransferFrom("0xFrom", "0xTo", 500n);
```

Two scopes that are commonly conflated:

- Transfer-operator approval: lets the approved address call
  `confidentialTransferFrom`.
- Unshield-operator approval: lets the approved address call `unshield` /
  `unwrap` / `unwrapAll` on the holder's behalf.

These are SEPARATE - approving for transfer does NOT auto-grant
unshield rights. Approve again with the unshield-operator semantics on
the contract side.

For low-level operator-set checks via raw ABI calls, use builders:

```ts
import { isOperatorContract, setOperatorContract } from "@zama-fhe/sdk";

const cfg = isOperatorContract(tokenAddr, holderAddr, spenderAddr);
/* read with publicClient.readContract(cfg) */
```

In React, the matching hooks are `useConfidentialApprove` and
`useConfidentialIsApproved` (note: the pre-release SDK renames these to
`useConfidentialSetOperator` / `useConfidentialIsOperator`; the stable
3.0.0 line still uses the `Approve` names).

## FHE artifact cache (FHE pubkey + CRS)

Persistent cache for the FHE network public key and public parameters
(CRS - common reference string). Multi-MB binaries, so caching matters.
There is **no public `FheArtifactCache` class**; the cache is created
internally by `RelayerWeb` and `RelayerNode`. The only knobs you control
are `fheArtifactStorage` and `fheArtifactCacheTTL` on the relayer config.
The string `"FheArtifactCache"` you may see in DevTools is just the
default IndexedDB database name, not an importable identifier.

Defaults:

- `RelayerWeb` -> internally uses `new IndexedDBStorage("FheArtifactCache", 1, "artifacts")`.
  Caching enabled automatically; survives reloads.
- `RelayerNode` -> `MemoryStorage()`. In-process only; lost on restart.
  Pass a `GenericStorage`-compatible Redis / filesystem adapter for
  cross-restart persistence. Pass `fheArtifactStorage: null` to disable.

```ts
import { RelayerWeb, IndexedDBStorage, SepoliaConfig } from "@zama-fhe/sdk";

const relayer = new RelayerWeb({
    getChainId: () => signer.getChainId(),
    transports: { /* ... */ },
    fheArtifactStorage: new IndexedDBStorage("MyAppArtifacts", 1, "fhe"),
    fheArtifactCacheTTL: 43_200, /* 12h, default 24h */
});
```

`fheArtifactCacheTTL: 0` revalidates on every operation.

How it works:

1. First load: SDK fetches pubkey + CRS, persists as base64 in storage,
   memoizes in memory.
2. Subsequent loads: read from storage instantly, skip the multi-MB
   download.
3. Periodically (per `ttl`) the cache issues conditional requests
   (`If-None-Match` / `If-Modified-Since`) to the artifact CDN. 304 ->
   refresh timestamps. 200 -> clear cache, re-fetch on next use. 405 ->
   fall back to GET.
4. Network errors fail open: serve stale, retry revalidation after 5
   minutes.

Storage keys (scoped by chain ID):

| Key | Content |
|---|---|
| `fhe:pubkey:{chainId}` | Public key + metadata, base64 |
| `fhe:params:{chainId}:{bits}` | Public parameters (CRS) for a bit size |
| `fhe:params-index:{chainId}` | Array of cached bit sizes |

This is distinct from `ZamaProvider.storage` (which holds credentials and
decrypted balances). Do not point both at the same `localStorage` - the
artifact cache exceeds the ~5MB localStorage cap.

To opt into a custom cache backend, supply your own `GenericStorage` to
`fheArtifactStorage` and let the relayer drive it. There is no
user-callable `getPublicKey` / `getPublicParams` / `revalidateIfDue` API
exported from `@zama-fhe/sdk`; those are internal to the relayer
class.

## Common Mistakes

- Pulling ACL events with `TOKEN_TOPICS` - they live on the ACL contract,
  not the token. Use `ACL_TOPICS` against the ACL address from the
  per-chain config (`SepoliaConfig.aclContractAddress`,
  `MainnetConfig.aclContractAddress`, or `HardhatConfig.aclContractAddress`).
- Trying to distinguish "revoked" from "never set" via state reads. The
  contract resets expiry to `0n` on revocation. Use
  `RevokedDelegationForUserDecryption` events.
- Using contract builders for everyday flows. The `Token` API handles
  encryption + multi-step orchestration. Builders are for custom
  pipelines only.
- Approving an operator for transfer and assuming they can also unshield.
  Two separate scopes.
- Treating `useConfidentialApprove` as same as ERC-20 `approve`. ERC-7984
  operator approvals are time-bounded (1 hour default) and do not
  reference an amount.
- Pointing `fheArtifactStorage` at `localStorage`. CRS exceeds the ~5MB
  cap. Use IndexedDB or a backend store.
- Pointing `fheArtifactStorage` and `ZamaProvider.storage` at the same
  storage namespace. They are independent caches; mixing keys causes
  surprising behavior.
- Forgetting `registryAddresses: { [31337]: ... }` on Hardhat. The
  default registry returns no address for chain 31337, and
  `getRegistryAddress()` throws `ConfigurationError`.
- Calling `applyDecryptedValues` with a different decrypted shape than
  what `sdk.userDecrypt` returns. Pass the record directly.
- Building activity feeds without batching the `userDecrypt` call.
  `extractEncryptedHandles` collects unique handles for a single batch -
  using it preserves cache hits and minimizes relayer calls.
- Calling `decodeOnChainEvents` on a mixed log array (token + ACL).
  `decodeOnChainEvents` only handles token events. Use `decodeAclEvents`
  for the ACL contract's logs.
