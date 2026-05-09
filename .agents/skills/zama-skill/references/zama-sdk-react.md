# Zama SDK: React (`@zama-fhe/react-sdk@^3.0.0`)

`ZamaProvider`, the full hook surface (59 hooks), TanStack Query
integration, `zamaQueryKeys` cache control, Next.js SSR, Vite, and web
extensions. Read this when the user is building a React app on top of
the new SDK.

## Contents

- Provider Setup (wagmi, viem, ethers)
- Next.js SSR / App Router
- Vite
- Web Extensions (MV3)
- Hook Catalog by Category
- `zamaQueryKeys` Cache Control
- `matchZamaError` in React
- Encrypt / Decrypt for Custom (Non-Token) FHE Contracts
- Common Mistakes

## Provider Setup (wagmi, viem, ethers)

`ZamaProvider` injects the SDK into the React tree. It must be wrapped by
a `QueryClientProvider` because every hook is built on TanStack Query.

```tsx
"use client";

import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider, RelayerWeb, indexedDBStorage } from "@zama-fhe/react-sdk";
import { WagmiSigner } from "@zama-fhe/react-sdk/wagmi";

const wagmiConfig = createConfig({
    chains: [sepolia],
    transports: {
        [sepolia.id]: http("https://sepolia.infura.io/v3/YOUR_KEY"),
    },
});

const signer = new WagmiSigner({ config: wagmiConfig });
const relayer = new RelayerWeb({
    getChainId: () => signer.getChainId(),
    transports: {
        [sepolia.id]: {
            relayerUrl: "/api/relayer/11155111",
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
        },
    },
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <ZamaProvider relayer={relayer} signer={signer} storage={indexedDBStorage}>
                    {children}
                </ZamaProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
```

`ZamaProvider` props:

| Prop | Type | Notes |
|---|---|---|
| `relayer` | `RelayerWeb \| RelayerNode` | Required |
| `signer` | `WagmiSigner \| ViemSigner \| EthersSigner \| GenericSigner` | Required |
| `storage` | `GenericStorage` | Required. Encrypted FHE keypair. `indexedDBStorage` for browsers; `memoryStorage` for tests |
| `sessionStorage` | `GenericStorage` | Optional. Wallet signature cache. Defaults to in-memory. Use `chromeSessionStorage` for MV3 extensions |
| `keypairTTL` | `number` | Seconds; default `2_592_000` (30d) per the SDK source. (The provider page documents `86_400` (1d); the constructor default is the source-correct value of 30 days. Pass explicitly to remove ambiguity.) |
| `sessionTTL` | `number \| "infinite"` | Seconds, `0` for sign-every-op, or `"infinite"` |
| `onEvent` | `ZamaSDKEventListener` | Lifecycle / decrypt / transaction events |

For the viem path without wagmi, swap `WagmiSigner` for `ViemSigner` from
`@zama-fhe/sdk/viem` and drop the `WagmiProvider`. For ethers, use
`EthersSigner` from `@zama-fhe/sdk/ethers`.

## Next.js SSR / App Router

The relayer runs FHE in a Web Worker and stores keypairs in IndexedDB.
Neither exists during SSR, so:

1. Anything importing from `@zama-fhe/react-sdk` must be in a Client
   Component (`"use client"`).
2. Do not create the relayer / signer at module level in a file imported
   by Server Components.

The pattern is to keep all SDK objects inside a `"use client"` provider
component:

```tsx
/* app/providers.tsx - "use client" version above */

/* app/layout.tsx - this file stays a Server Component */
import { Providers } from "./providers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body><Providers>{children}</Providers></body>
        </html>
    );
}
```

Pages can stay Server Components and import client leaf components:

```tsx
/* app/portfolio/page.tsx - Server Component */
import { TokenBalance } from "@/components/token-balance";

export default function PortfolioPage() {
    return (
        <div>
            <h1>My Portfolio</h1>
            <TokenBalance address="0xEncryptedERC20" />
        </div>
    );
}

/* components/token-balance.tsx - Client Component */
"use client";

import { useConfidentialBalance } from "@zama-fhe/react-sdk";

export function TokenBalance({ address }: { address: `0x${string}` }) {
    const { data: balance, isLoading } = useConfidentialBalance({ tokenAddress: address });
    if (isLoading) return <span>Decrypting...</span>;
    return <span>{balance?.toString()}</span>;
}
```

Anti-pattern - never put SDK construction in a shared module:

```ts
/* lib/sdk.ts - DO NOT */
import { RelayerWeb } from "@zama-fhe/sdk";
export const relayer = new RelayerWeb({ /* ... */ }); /* crashes during SSR */
```

If you must hold the relayer in a non-component module, gate behind a
dynamic import:

```ts
export async function getRelayer() {
    const { RelayerWeb } = await import("@zama-fhe/sdk");
    return new RelayerWeb({ /* ... */ });
}
```

Add COOP / COEP headers via `next.config.js` for FHE multi-threading:

```js
const nextConfig = {
    async headers() {
        return [{
            source: "/(.*)",
            headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
            ],
        }];
    },
};
```

If you load wallet UIs from cross-origin iframes (RainbowKit,
WalletConnect), use `credentialless` instead of `require-corp`. See
`references/frontend.md`.

## Vite

```ts
/* vite.config.ts */
export default defineConfig({
    server: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "credentialless", /* require-corp if no external wallet UI */
        },
    },
    optimizeDeps: {
        exclude: ["@zama-fhe/relayer-sdk"], /* legacy SDK still relevant for transitive types */
    },
    worker: { format: "es" },
});
```

`optimizeDeps.exclude` and `worker.format: "es"` are inherited from the
legacy SDK setup and remain necessary for the WASM loader.

## Web Extensions (MV3)

```ts
import { ZamaProvider, RelayerWeb, indexedDBStorage, chromeSessionStorage } from "@zama-fhe/react-sdk";

<ZamaProvider
    relayer={relayer}
    signer={signer}
    storage={indexedDBStorage} /* persistent encrypted keypair */
    sessionStorage={chromeSessionStorage} /* survives SW restarts */
>
    {children}
</ZamaProvider>
```

`manifest.json` must include `"storage"` in `permissions`. See
`references/zama-sdk-auth-storage.md` for the full extension setup.

## Hook Catalog by Category

All hooks ship from `@zama-fhe/react-sdk`. Hook return shapes follow
TanStack Query conventions: queries return
`{ data, isLoading, error, ... }`; mutations return
`{ mutateAsync, mutate, isPending, isSuccess, error, ... }`.

### Token instances and metadata

| Hook | Purpose |
|---|---|
| `useZamaSDK()` | Access the underlying `ZamaSDK` instance from context |
| `useToken({ tokenAddress, wrapperAddress? })` | Memoized `Token` instance bound to current signer |
| `useReadonlyToken({ tokenAddress })` | Memoized `ReadonlyToken` instance |
| `useMetadata("0xToken")` | Returns `{ name, symbol, decimals }` in one call |

### Balances

| Hook | Purpose |
|---|---|
| `useConfidentialBalance({ tokenAddress, owner? }, options?)` | Decrypt a single token balance. Pass `refetchInterval` to poll |
| `useConfidentialBalances({ tokenAddresses, owner? })` | Decrypt multiple tokens in parallel; auto-batches the EIP-712 signature; returns `{ results: Map, errors: Map }` |
| `useUnderlyingAllowance({ tokenAddress, owner?, wrapperAddress })` | Read public ERC-20 allowance for the wrapper |

### Token mutations: shield / unshield / transfer

| Hook | Purpose |
|---|---|
| `useShield({ tokenAddress, wrapperAddress? })` | Public ERC-20 -> confidential. Mutate args: `{ amount, approvalStrategy?, fees?, to? }` |
| `useConfidentialTransfer({ tokenAddress })` | Encrypted transfer. Mutate args: `{ to, amount, skipBalanceCheck? }` |
| `useConfidentialTransferFrom({ tokenAddress })` | Operator transfer. Mutate args: `{ from, to, amount }` |
| `useUnshield({ tokenAddress, wrapperAddress? })` | Confidential -> public, full two-phase orchestration. Mutate args: `{ amount, skipBalanceCheck?, onUnwrapSubmitted?, onFinalizing?, onFinalizeSubmitted? }` |
| `useUnshieldAll({ tokenAddress, wrapperAddress? })` | Unshield the full balance |
| `useResumeUnshield({ tokenAddress, wrapperAddress? })` | Resume an interrupted unshield. Mutate args: `{ unwrapTxHash }` |
| `useUnwrap({ tokenAddress, wrapperAddress? })` | Phase 1 only |
| `useUnwrapAll({ tokenAddress, wrapperAddress? })` | Phase 1, full balance |
| `useFinalizeUnwrap({ tokenAddress, wrapperAddress? })` | Phase 2 with the burn-amount handle |

### Session and credentials

| Hook | Purpose |
|---|---|
| `useAllow()` | Mutation: `mutate(contractAddresses)` to pre-authorize a set of contracts with one signature |
| `useIsAllowed({ contractAddresses })` | Query: returns `boolean` indicating cached credentials cover the set |
| `useRevoke()` | Mutation: revoke per-contract authorization |
| `useRevokeSession()` | Mutation: revoke entire session and clear cache |

### Operator approvals (ERC-7984)

| Hook | Purpose |
|---|---|
| `useConfidentialApprove({ tokenAddress })` | Approve an operator. Args: `{ spender, until? }` (default 1h) |
| `useConfidentialIsApproved({ tokenAddress, spender, holder? })` | Query approval status |

In the pre-release SDK these are renamed to `useConfidentialSetOperator`
and `useConfidentialIsOperator`. Stable 3.0.0 keeps the `Approve` names.

### Wrappers registry

| Hook | Purpose |
|---|---|
| `useWrappersRegistryAddress()` | Resolve the registry contract for the current chain |
| `useWrapperDiscovery({ tokenAddress })` | Find the confidential wrapper for a plain ERC-20 |
| `useListPairs({ page?, pageSize?, metadata? })` | Paginated pair listing, optionally enriched with name / symbol / decimals / supply |
| `useTokenPairsRegistry()` | All pairs at once |
| `useTokenPairsLength()` | `bigint` count |
| `useTokenPairsSlice({ from, to })` | Index range |
| `useTokenPair({ index })` | Single pair |
| `useConfidentialTokenAddress({ tokenAddress })` | Forward lookup (plain -> confidential) |
| `useTokenAddress({ confidentialTokenAddress })` | Reverse lookup |
| `useIsConfidentialTokenValid({ confidentialTokenAddress })` | Validity check |

### Activity feed

| Hook | Purpose |
|---|---|
| `useActivityFeed({ tokenAddress, logs, userAddress, decrypt })` | Full pipeline (parse + decrypt + sort) returning a UI-ready feed |

`decrypt: false` returns classified events without amounts (no signature
required).

### Delegated decryption

| Hook | Purpose |
|---|---|
| `useDelegateDecryption({ tokenAddress })` | Mutation: `{ delegateAddress, expirationDate? }` |
| `useRevokeDelegation({ tokenAddress })` | Mutation: `{ delegateAddress }` |
| `useDelegationStatus({ tokenAddress, delegatorAddress, delegateAddress })` | Query: `{ active, expiry }` |
| `useDecryptBalanceAs({ tokenAddress })` | Mutation: `{ delegatorAddress, owner? }` |
| `useBatchDecryptBalancesAs()` | Mutation: `{ tokens, delegatorAddress, handles?, owner?, maxConcurrency?, onError? }`. Returns `Map<Address, bigint>` |

### Low-level encrypt / decrypt (custom FHE contracts)

For confidential contracts that are NOT ERC-7984 wrappers:

| Hook | Purpose |
|---|---|
| `useEncrypt()` | Mutation: `{ values: [{ value, type }], contractAddress, userAddress }`. Returns `{ handles: Uint8Array[], inputProof: Uint8Array }` |
| `useUserDecrypt({ handles })` | Query that decrypts one or more `[{ handle, contractAddress }]` once `useAllow` has cached creds. `enabled: !!isAllowed` is a useful pattern |
| `useGenerateKeypair()` | Mutation: returns a fresh FHE keypair via the relayer |

`usePublicDecrypt()` (mentioned in the encrypt-decrypt guide) is
available for handles flagged publicly decryptable on-chain - no signature
required, returns `{ clearValues: { [handle]: bigint } }`.

### Encrypt / decrypt example for a custom contract

```tsx
import { useEncrypt, useUserDecrypt, useZamaSDK, useAllow, useIsAllowed }
    from "@zama-fhe/react-sdk";
import { bytesToHex } from "viem";

function ConfidentialRoundTrip() {
    const sdk = useZamaSDK();
    const encrypt = useEncrypt();
    const { mutate: allow } = useAllow();
    const [handles, setHandles] = useState<{ handle: string; contractAddress: `0x${string}` }[]>([]);
    const { data: isAllowed } = useIsAllowed({ contractAddresses: ["0xMyContract"] });
    const { data: decrypted } = useUserDecrypt({ handles }, { enabled: !!isAllowed });

    const handleSubmit = async () => {
        const userAddress = await sdk.signer.getAddress();
        const contractAddress = "0xMyContract" as const;

        const enc = await encrypt.mutateAsync({
            values: [{ value: 42n, type: "euint64" }],
            contractAddress,
            userAddress,
        });

        await sdk.signer.writeContract({
            address: contractAddress,
            abi: myContractABI,
            functionName: "store",
            args: [bytesToHex(enc.handles[0]), bytesToHex(enc.inputProof)],
        });

        const handle = (await sdk.signer.readContract({
            address: contractAddress,
            abi: myContractABI,
            functionName: "getHandle",
            args: [userAddress],
        })) as string;

        setHandles([{ handle, contractAddress }]);
    };

    return (
        <>
            {!isAllowed && <button onClick={() => allow(["0xMyContract"])}>Authorize</button>}
            <button onClick={handleSubmit}>Encrypt -> Store -> Decrypt</button>
            {decrypted && handles[0] && (
                <output>{decrypted[handles[0].handle]?.toString()}</output>
            )}
        </>
    );
}
```

The `useAllow` -> `useIsAllowed` -> `enabled: !!isAllowed` pattern lets
you sign once at app start and decrypt anywhere in the tree without
extra prompts.

## `zamaQueryKeys` Cache Control

Mutations auto-invalidate balance queries. For manual control of the
TanStack Query cache:

```ts
import { zamaQueryKeys } from "@zama-fhe/react-sdk";
```

| Key path | Scope |
|---|---|
| `zamaQueryKeys.confidentialBalance.all` | All decrypted balances |
| `zamaQueryKeys.confidentialBalance.token(addr)` | One token's balances |
| `zamaQueryKeys.confidentialBalance.owner(addr, owner)` | One owner-token balance |
| `zamaQueryKeys.confidentialBalances.all` | All batch balance queries |
| `zamaQueryKeys.confidentialBalances.tokens(addrs, owner)` | Batch query for a set |
| `zamaQueryKeys.isAllowed.all` | All session-allowed queries |
| `zamaQueryKeys.underlyingAllowance.all` | All allowance queries |
| `zamaQueryKeys.underlyingAllowance.token(addr)` | Allowances for one token |
| `zamaQueryKeys.underlyingAllowance.scope(addr, owner, wrapper)` | Specific owner + wrapper |
| `zamaQueryKeys.activityFeed.all` | All feed queries |
| `zamaQueryKeys.activityFeed.token(addr)` | Feed for one token |
| `zamaQueryKeys.activityFeed.scope(addr, userAddress, logsKey, decrypt)` | Fully scoped feed |
| `zamaQueryKeys.wrappersRegistry.all` | All registry queries |
| `zamaQueryKeys.wrappersRegistry.chainId()` | Chain ID resolution |
| `zamaQueryKeys.wrappersRegistry.tokenPairs(registryAddr)` | All pairs |
| `zamaQueryKeys.wrappersRegistry.tokenPairsLength(registryAddr)` | Pair count |
| `zamaQueryKeys.wrappersRegistry.tokenPairsSlice(registryAddr, from, to)` | Index slice |
| `zamaQueryKeys.wrappersRegistry.tokenPair(registryAddr, index)` | Single pair |
| `zamaQueryKeys.wrappersRegistry.confidentialTokenAddress(registryAddr, tokenAddr)` | Forward lookup |
| `zamaQueryKeys.wrappersRegistry.tokenAddress(registryAddr, confidentialAddr)` | Reverse lookup |
| `zamaQueryKeys.wrappersRegistry.isConfidentialTokenValid(registryAddr, confidentialAddr)` | Validity |
| `zamaQueryKeys.wrappersRegistry.listPairs(registryAddr, page, pageSize, metadata)` | Paginated listing |

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { zamaQueryKeys } from "@zama-fhe/react-sdk";

const qc = useQueryClient();

/* Invalidate after an external transfer */
qc.invalidateQueries({
    queryKey: zamaQueryKeys.confidentialBalance.token("0xToken"),
});

/* Prefetch on hover */
qc.prefetchQuery({
    queryKey: zamaQueryKeys.confidentialBalance.owner("0xToken", "0xOwner"),
    queryFn: () => fetchBalance("0xToken", "0xOwner"),
});

/* Clear all cache on disconnect */
qc.removeQueries({ queryKey: zamaQueryKeys.confidentialBalance.all });
```

## `matchZamaError` in React

```tsx
import { matchZamaError } from "@zama-fhe/react-sdk";

function ErrorMessage({ error }: { error: Error | null }) {
    if (!error) return null;
    const msg = matchZamaError(error, {
        SIGNING_REJECTED: () => "Cancelled - approve in your wallet.",
        ENCRYPTION_FAILED: () => "Encryption failed - retry.",
        TRANSACTION_REVERTED: () => "Transfer reverted - check balance.",
        _: () => "Something went wrong.",
    });
    return <p className="error">{msg ?? error.message}</p>;
}
```

The hook `error` field returns `Error | null`. `matchZamaError` returns
`undefined` if the error is not a `ZamaError` and no `_` wildcard is
provided - fall back to `error.message`.

Full error taxonomy in `references/zama-sdk-errors.md`.

## Encrypt / Decrypt for Custom (Non-Token) FHE Contracts

When the project's confidential contract is not an ERC-7984 wrapper
(voting, sealed-bid auction, custom bool / flag storage), use:

- `useEncrypt()` for encrypted inputs.
- `useAllow()` + `useIsAllowed()` to pre-authorize the contract for
  decryption.
- `useUserDecrypt()` (gated on `enabled: !!isAllowed`) to decrypt
  handles read off-chain.
- `useGenerateKeypair()` if you need a fresh keypair without the SDK's
  TTL / session machinery.

The `useEncrypt` mutation accepts:

```ts
{
    values: Array<{ value: bigint | boolean | Address; type: "euint8" | "euint16" | "euint32" | "euint64" | "euint128" | "euint256" | "ebool" | "eaddress" }>,
    contractAddress: Address,
    userAddress: Address,
}
```

It returns `{ handles: Uint8Array[], inputProof: Uint8Array }`. Pass each
handle (hex-encoded) and the proof to your contract:

```ts
await sdk.signer.writeContract({
    address: contractAddress,
    abi,
    functionName: "yourFn",
    args: [bytesToHex(handles[0]), bytesToHex(inputProof)],
});
```

The handles array order matches the `values` array order. The proof is
shared across all values in the same `encrypt.mutateAsync` call.

## Common Mistakes

- Putting `RelayerWeb` / `ZamaProvider` in a Server Component. Crashes
  during SSR with "Web Worker not available". Wrap in `"use client"`.
- Creating the relayer / signer at module level in a file imported by
  Server Components. Same crash. Use a `"use client"` provider component
  or a dynamic import.
- Forgetting `QueryClientProvider` around `ZamaProvider`. Hooks throw
  "No QueryClient set".
- Using `WagmiSigner` without wrapping the tree in `WagmiProvider`. The
  signer reads the wagmi config at call time.
- Calling `useEncrypt` before the wallet is connected. `userAddress`
  will be `undefined` and the relayer returns empty handles. Gate with
  `if (!address) return null;`.
- Using `useUserDecrypt` without `enabled: !!isAllowed` - every render
  triggers a wallet prompt until cached. Pre-authorize via `useAllow`
  and gate the query.
- Pointing `relayerUrl` at the upstream relayer in the browser. Always
  point at a backend proxy. See `references/zama-sdk-auth-storage.md`.
- Mixing `useShield` / `useUnshield` and stale `useConfidentialBalance`
  data without trusting auto-invalidation. Mutations auto-invalidate;
  do NOT manually re-call `refetch()` unless you really need it.
- Using `keypairTTL: 0` in the provider props - rejected at construction
  by the underlying `ZamaSDK`. Same for trying `> 365 days`.
- Deriving `contractAddress` for `useUserDecrypt` from a local `useState`
  before the user has connected. The query enables before credentials
  exist.
- Forgetting COOP / COEP headers in Vite or Next.js - the FHE worker
  silently drops to single-threaded mode (slow) or fails entirely.
- Using `useConfidentialApprove` and assuming it grants ERC-20 spending
  rights - it grants the ERC-7984 operator role, not a public allowance.
  Use `useUnderlyingAllowance` to read the underlying ERC-20 allowance.
- Subscribing to wagmi events manually AND using `WagmiSigner`. The
  signer already calls `subscribe()` internally and revokes on
  disconnect / account change. Do not double-handle.
- Building a feed with `useActivityFeed` before fetching `logs` - pass
  `logs: undefined` and the hook stays disabled. Provide `logs` once
  ready.
