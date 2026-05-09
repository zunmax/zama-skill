# Zama SDK: Auth, Transports, Signers, Storage

How to wire up the three required collaborators of `ZamaSDK`. Read this when
the user is building a project on `@zama-fhe/sdk@^3.0.0`. The high-level map
of the SDK is in `references/zama-sdk-overview.md`; this file covers the
runtime plumbing.

## Contents

- Authentication: backend proxy vs direct API key
- The Three `auth` Shapes
- CSRF, WASM Integrity, Threading
- `RelayerWeb` (Browser)
- `RelayerNode` (Node.js)
- `RelayerCleartext` (Local Dev)
- Network Presets
- Signer Adapters: Viem, Ethers, Wagmi, Generic
- Storage: indexedDB, memory, asyncLocal, chromeSession
- Custom `GenericStorage`
- Web Extensions (MV3)

## Authentication: backend proxy vs direct API key

The Zama-hosted relayer requires an API key on every request. Two patterns:

| Strategy | Use when | API key location |
|---|---|---|
| Backend proxy | Browser apps, dApps | Server-side; never reaches the client |
| Direct API key | Node.js scripts and servers, prototyping | `auth` field on the transport config |

Browser apps MUST proxy. Embedding the key (in `NEXT_PUBLIC_*`, `VITE_*`,
`process.env`, or any client-side code) leaks it to anyone reading network
traffic or the bundle. Sponsored transactions on the Zama-hosted relayer are
billed monthly, so a leaked key is also a financial liability.

### Backend proxy (browser apps)

The proxy attaches `x-api-key` server-side and forwards everything else.
Minimal Express version (`docs.zama.org/protocol/sdk/guides/authentication.md`):

```ts
import express from "express";
import { MainnetConfig, SepoliaConfig } from "@zama-fhe/sdk";

const app = express();
app.use(express.json());

const Configs = {
    [MainnetConfig.chainId]: MainnetConfig,
    [SepoliaConfig.chainId]: SepoliaConfig,
};

app.use("/api/relayer/:chainId", async (req, res) => {
    const config = Configs[req.params.chainId];
    if (!config) {
        res.status(400).send("Unsupported chain");
        return;
    }

    const url = new URL(req.url, config.relayerUrl);
    const body = ["GET", "HEAD"].includes(req.method)
        ? undefined
        : JSON.stringify(req.body);

    const response = await fetch(url, {
        method: req.method,
        headers: {
            "content-type": "application/json",
            "x-api-key": process.env.RELAYER_API_KEY,
        },
        body,
        /* @ts-expect-error: required by the relayer */
        duplex: "half",
    });

    res.status(response.status).send(await response.text());
});

app.listen(3001);
```

Three requirements that any framework substitution (Fastify, Hono, Next.js
`route.ts`) must satisfy:

1. Forward HTTP method, path, and body to the upstream `relayerUrl`.
2. Inject `x-api-key: <key>` before forwarding.
3. Return upstream status and body unchanged.

Two extras the legacy SDK skill already documents that still apply for
non-Zama-hosted upstreams (apply to backend proxies that re-host the path):

- Forward `zama-sdk-version` and `zama-sdk-name` headers from the client.
  Add them to `Access-Control-Allow-Headers` and pass them upstream. The SDK
  attaches both on every request and the relayer rejects requests without
  them on some routes.
- Strip `content-encoding` and `content-length` from the upstream response.
  Node `fetch()` decodes gzip / br before `.arrayBuffer()`. Forwarding the
  original `content-encoding` triggers `ERR_CONTENT_DECODING_FAILED` in the
  browser.

Wire the SDK at the proxy URL, not the upstream:

```ts
import { RelayerWeb, MainnetConfig, SepoliaConfig } from "@zama-fhe/sdk";

const relayer = new RelayerWeb({
    getChainId: () => signer.getChainId(),
    transports: {
        [MainnetConfig.chainId]: {
            ...MainnetConfig,
            relayerUrl: "https://your-app.com/api/relayer/1",
            network: "https://mainnet.infura.io/v3/YOUR_KEY",
        },
        [SepoliaConfig.chainId]: {
            ...SepoliaConfig,
            relayerUrl: "https://your-app.com/api/relayer/11155111",
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
        },
    },
});
```

No `auth` on the client. The proxy authenticates upstream.

### Direct API key (Node.js servers)

Trusted environment, key loaded from `process.env`:

```ts
import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";

const relayer = new RelayerNode({
    getChainId: () => signer.getChainId(),
    transports: {
        [SepoliaConfig.chainId]: {
            ...SepoliaConfig,
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
            auth: {
                __type: "ApiKeyHeader",
                value: process.env.RELAYER_API_KEY,
            },
        },
    },
});
```

### Mainnet API key

Apply at `https://forms.gle/jq84zEek1oiv3kBz9`. Self-hosting is the
alternative (run your own relayer + fund your own gateway wallet). Sepolia
testnet has no API key requirement.

If a key is compromised, mail `support@zama.org` and stop using it. Zama
suspends compromised keys on detection.

## The Three `auth` Shapes

| Shape | Sent as |
|---|---|
| `{ __type: "ApiKeyHeader", value: "..." }` | `x-api-key: <value>` header |
| `{ __type: "ApiKeyCookie", value: "..." }` | Cookie |
| `{ __type: "BearerToken", token: "..." }` | `Authorization: Bearer <token>` header |

`BearerToken` is for backends that issue their own JWTs and validate
upstream. `ApiKeyHeader` is what Zama-hosted relayers expect.

## CSRF, WASM Integrity, Threading

`RelayerWeb` accepts a `security` block:

```ts
const relayer = new RelayerWeb({
    getChainId: () => signer.getChainId(),
    transports: { /* ... */ },
    security: {
        integrityCheck: true, /* default; SHA-384 verify of the WASM bundle */
        getCsrfToken: () => document.cookie.match(/csrf=(\w+)/)?.[1] ?? "",
    },
});
```

When `getCsrfToken` is set, the SDK attaches the returned value to every
relayer request. Use this in tandem with a backend proxy that issues and
validates a CSRF cookie.

`integrityCheck: false` skips the SHA-384 verification - only do this for
debugging.

For multi-threading:

```ts
const relayer = new RelayerWeb({
    /* ... */
    threads: Math.min(navigator.hardwareConcurrency, 8),
});
```

`threads` defaults to `1`. The practical sweet spot is 4-8; beyond that, you
hit diminishing returns and higher memory. Multi-threading uses
`SharedArrayBuffer` and requires:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these the browser blocks `SharedArrayBuffer` and the relayer falls
back to single-threaded mode silently. Use `credentialless` on
`Cross-Origin-Embedder-Policy` if you also load wallet UIs from third-party
origins (RainbowKit, WalletConnect) - see `references/frontend.md`.

## `RelayerWeb` (Browser)

```ts
import { RelayerWeb } from "@zama-fhe/sdk";

const relayer = new RelayerWeb({
    getChainId: () => signer.getChainId(), /* () => Promise<number> */
    transports: { /* Record<chainId, TransportConfig> */ },
    threads: 1, /* optional */
    security: { /* optional */ },
});
```

`getChainId` is called lazily. The relayer re-initializes its worker when
the chain changes.

Each `transports` entry accepts `network` (RPC URL), `relayerUrl` (proxy or
upstream), `auth` (optional, server-side only), and any preset fields you
spread. Use `network: window.ethereum` only if you actually want the wallet
provider to do RPC; pass an HTTP RPC URL otherwise.

## `RelayerNode` (Node.js)

```ts
import { RelayerNode } from "@zama-fhe/sdk/node";
import { SepoliaConfig } from "@zama-fhe/sdk";

const relayer = new RelayerNode({
    getChainId: () => signer.getChainId(),
    poolSize: 4, /* default min(os.cpus().length, 4) */
    transports: {
        [SepoliaConfig.chainId]: {
            ...SepoliaConfig,
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
            auth: { __type: "ApiKeyHeader", value: process.env.RELAYER_API_KEY },
        },
    },
});
```

`RelayerNode` lives at `@zama-fhe/sdk/node`, NOT at the main entry. Importing
it from `@zama-fhe/sdk` returns `undefined` and pollutes a server bundle
with browser code.

`poolSize` controls the worker-thread count. Increase for high-throughput
services; decrease in memory-constrained environments.

`RelayerWeb` in Node throws (no Web Worker / WASM environment). `RelayerNode`
in browser throws (no `worker_threads`). The relayer must match the runtime.

## `RelayerCleartext` (Local Dev)

For local Hardhat / custom testnets where FHEVM contracts are deployed in
cleartext mode (no KMS, no gateway, no real FHE). Implements the same
`RelayerSDK` interface so the rest of the code is unchanged.

```ts
import { RelayerCleartext, hardhatCleartextConfig, hoodiCleartextConfig }
    from "@zama-fhe/sdk/cleartext";

const relayer = new RelayerCleartext(hardhatCleartextConfig);
```

| Preset | Chain ID | Default RPC |
|---|---|---|
| `hardhatCleartextConfig` | `31337` | `http://127.0.0.1:8545` |
| `hoodiCleartextConfig` | `560048` | `https://rpc.hoodi.ethpandaops.io` |

`RelayerCleartext` is **blocked on chain 1 (Mainnet) and chain 11155111
(Sepolia)** at construction. Cleartext mode is dev-only.

For a custom chain, pass a `CleartextConfig`:

```ts
import { RelayerCleartext } from "@zama-fhe/sdk/cleartext";
import type { CleartextConfig } from "@zama-fhe/sdk/cleartext";

const cfg: CleartextConfig = {
    chainId: 12345,
    network: "http://localhost:8545",
    gatewayChainId: 10901,
    aclContractAddress: "0x...",
    executorAddress: "0x...", /* CleartextFHEVMExecutor, NOT FHEVMExecutor */
    verifyingContractAddressDecryption: "0x...",
    verifyingContractAddressInputVerification: "0x...",
    /* Optional: kmsSignerPrivateKey, inputSignerPrivateKey - mock keys used by default */
};

const relayer = new RelayerCleartext(cfg);
```

`RelayerCleartext.requestZKProofVerification(...)` throws a
`ConfigurationError`. ZK proofs are not available in cleartext mode. Use a
real FHE relayer (`RelayerWeb` / `RelayerNode`) for ZK proof flows.

## Network Presets

```ts
import { MainnetConfig, SepoliaConfig, HardhatConfig, DefaultRegistryAddresses }
    from "@zama-fhe/sdk";
```

| Preset | Chain ID | Has registry? |
|---|---|---|
| `MainnetConfig` | `1` | yes |
| `SepoliaConfig` | `11155111` | yes |
| `HardhatConfig` | `31337` | no |

Each preset includes:

- `chainId`, `gatewayChainId`
- `relayerUrl`, `network` (default RPC)
- `aclContractAddress`, `kmsContractAddress`,
  `inputVerifierContractAddress`
- `verifyingContractAddressDecryption`,
  `verifyingContractAddressInputVerification`
- `registryAddress` (`undefined` for Hardhat)

Spread the preset and override what you need:

```ts
{
    ...SepoliaConfig,
    network: "https://sepolia.infura.io/v3/YOUR_KEY",
    relayerUrl: "https://your-app.com/api/relayer/11155111",
}
```

`DefaultRegistryAddresses` is `Record<number, Address>` with built-in
registry addresses (Mainnet, Sepolia, Hoodi). For Hardhat, pass an explicit
`registryAddresses: { [31337]: "0x..." }` on `ZamaSDK` if your local chain
has a registry deployed.

## Signer Adapters

### `ViemSigner`

```ts
import { ViemSigner } from "@zama-fhe/sdk/viem";

/* Full mode: sign + read */
const signer = new ViemSigner({
    walletClient,
    publicClient,
    ethereum: window.ethereum, /* optional - enables subscribe() */
});

/* Read-only mode: getAddress / signTypedData / writeContract throw */
const signer = new ViemSigner({ publicClient });
```

Without `ethereum`, lifecycle events (disconnect, account change) are NOT
auto-subscribed. Wire wallet events to `sdk.revokeSession()` manually, or
switch to `WagmiSigner`.

### `EthersSigner`

```ts
import { EthersSigner } from "@zama-fhe/sdk/ethers";

/* Browser - EIP-1193 provider */
const signer = new EthersSigner({ ethereum: window.ethereum });

/* Node.js - ethers.Signer */
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const signer = new EthersSigner({ signer: wallet });

/* Read-only - ethers.Provider */
const signer = new EthersSigner({ provider });
```

Pass exactly one of `ethereum`, `signer`, `provider`. `subscribe()` is only
available in the browser (`ethereum`) mode.

### `WagmiSigner`

```ts
import { WagmiSigner } from "@zama-fhe/react-sdk/wagmi";

const signer = new WagmiSigner({ config: wagmiConfig });
```

Only exported from `@zama-fhe/react-sdk/wagmi` (not from the base
`@zama-fhe/sdk`). Auto-revokes the session on:

- Disconnect.
- Account change (the EIP-712 signature is address-scoped).

Chain switches do NOT trigger revocation. Credentials are keyed by
`address + chainId`, so each chain maintains an independent session. You
do not wire any events manually; the SDK calls `subscribe()` during
initialization and cleans up on `terminate()`.

### `GenericSigner` (custom)

```ts
import type { GenericSigner } from "@zama-fhe/sdk";

interface GenericSigner {
    getChainId(): Promise<number>;
    getAddress(): Promise<Address>;
    signTypedData(typedData: EIP712TypedData): Promise<Hex>;
    writeContract(config: WriteContractConfig): Promise<Hex>;
    readContract(config: ReadContractConfig): Promise<unknown>;
    waitForTransactionReceipt(hash: Hex): Promise<TransactionReceipt>;
    subscribe?(callbacks: SignerLifecycleCallbacks): () => void;
}
```

`SignerLifecycleCallbacks` exposes `onDisconnect`, `onAccountChange`, and
`onChainChange(newChainId)`. Implement `subscribe` for smart-account /
hardware-wallet integrations - without it, stale sessions persist until TTL
expiry, which creates confusing UX when users switch accounts.

`writeContract` accepts `{ address, abi, functionName, args, value?, gas? }`
(matches viem's shape). `readContract` must work even in read-only signer
modes.

## Storage

`storage` persists the encrypted FHE re-encryption keypair.
`sessionStorage` (optional) persists EIP-712 wallet signatures so users do
not sign on every operation.

| Singleton | Subpath | Use for `storage` | Notes |
|---|---|---|---|
| `indexedDBStorage` | `@zama-fhe/sdk` | Browser apps | Persistent across reloads + browser restart |
| `memoryStorage` | `@zama-fhe/sdk` | Tests, scripts | Lost on process exit |
| `asyncLocalStorage` | `@zama-fhe/sdk/node` | Node.js servers | Per-request isolation via `AsyncLocalStorage` |
| `chromeSessionStorage` | `@zama-fhe/sdk` | Web extensions | Pass as `sessionStorage`, NOT `storage` |

```ts
import { indexedDBStorage, memoryStorage, chromeSessionStorage }
    from "@zama-fhe/sdk";
import { asyncLocalStorage } from "@zama-fhe/sdk/node";
```

### Per-request isolation on a Node.js server

```ts
import express from "express";
import { ZamaSDK } from "@zama-fhe/sdk";
import { asyncLocalStorage } from "@zama-fhe/sdk/node";

app.post("/api/transfer", (req, res) => {
    asyncLocalStorage.run(async () => {
        /* Each request gets a fresh isolated storage scope */
        const sdk = new ZamaSDK({ relayer, signer, storage: asyncLocalStorage });
        const token = sdk.createToken("0xTokenAddress");
        await token.confidentialTransfer("0xRecipient", 100n);
        res.json({ ok: true });
    });
});

process.on("SIGTERM", () => sdk.terminate());
```

Concurrent requests never share keypair state. Always wrap the
`new ZamaSDK(...)` inside `asyncLocalStorage.run(...)` - constructing the
SDK outside that scope leaks state across requests.

## Custom `GenericStorage`

The interface is three async methods (NOT `getItem` / `setItem` /
`removeItem`):

```ts
import type { GenericStorage } from "@zama-fhe/sdk";

interface GenericStorage {
    get<T = unknown>(key: string): Promise<T | null>;
    set<T = unknown>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
}
```

Example Redis-backed implementation:

```ts
const redisStorage: GenericStorage = {
    async get(key) { return redis.get(key); },
    async set(key, value) { await redis.set(key, value); },
    async delete(key) { await redis.del(key); },
};

const sdk = new ZamaSDK({ relayer, signer, storage: redisStorage });
```

`get` returns `null` when the key does not exist (not `undefined`). `set`
overwrites existing values silently. `delete` is a no-op on missing keys.

## Web Extensions (MV3)

The MV3 service worker can be terminated by Chrome after ~30s of
inactivity, wiping any in-memory session. To survive restarts, pair
`indexedDBStorage` (encrypted keypair) with `chromeSessionStorage`
(wallet signature):

```ts
import { ZamaSDK, indexedDBStorage, chromeSessionStorage } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({
    relayer,
    signer,
    storage: indexedDBStorage, /* persistent encrypted keypair */
    sessionStorage: chromeSessionStorage, /* wallet signature, survives SW restart */
});
```

`manifest.json` must include the `"storage"` permission:

```json
{
    "manifest_version": 3,
    "permissions": ["storage"],
    "background": { "service_worker": "background.js" }
}
```

Behavior:

- Popup, background, and content script all read from the same
  `chrome.storage.session` store. One signature in the popup unlocks
  decrypts in the background.
- Service worker restarts retain the session signature.
- Browser close clears `chrome.storage.session` but keeps `indexedDB`. On
  next launch, the user signs once to unlock the existing keypair.

## Common Mistakes

- `RelayerWeb` in Node, or `RelayerNode` in browser - constructor throws.
- `RelayerCleartext` against chain 1 or 11155111 - constructor throws.
  Cleartext mode is dev-only.
- Embedding `RELAYER_API_KEY` in browser code via `NEXT_PUBLIC_*` /
  `VITE_*`. Use a backend proxy.
- Forgetting `--save-exact` on `@zama-fhe/relayer-sdk@0.4.1` (transitive
  dependency of the contract toolchain). The new SDK does NOT change this
  pin requirement.
- Using `getItem` / `setItem` / `removeItem` for a custom `GenericStorage`.
  The interface is `get` / `set` / `delete`.
- Constructing `new ZamaSDK(...)` outside `asyncLocalStorage.run(...)` on a
  Node.js server - state leaks across requests.
- Setting both `relayerUrl` (proxy) AND `auth` on the same transport in a
  browser app - the `auth` field exposes the key to the client. Choose one.
- Running with `Cross-Origin-Embedder-Policy: require-corp` while loading
  cross-origin wallet iframes (RainbowKit, WalletConnect). Use
  `credentialless` instead. See `references/frontend.md`.
