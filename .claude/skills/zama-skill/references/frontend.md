# FHEVM Frontend Integration (legacy `@zama-fhe/relayer-sdk` primitives + shared bundler / COOP / COEP / mainnet concerns)

## Pick the right SDK family BEFORE reading the rest of this file

| If you are building... | Read this instead | Falls back here for... |
|---|---|---|
| ERC-7984 dApp - shield / unshield / confidentialTransfer / balanceOf, React hooks, sessions, delegation, activity feeds | the `references/zama-sdk-*.md` family (start with `zama-sdk-overview.md`) | bundler config, COOP / COEP, mainnet API-key proxy |
| Custom (non-ERC-7984) confidential contract on raw `createInstance` / `createEncryptedInput` / `userDecrypt` / `publicDecrypt` / `createEIP712` | this file | nothing - you are in the right place |
| Hardhat test (Node) | `references/testing.md` | nothing |

The new SDK files for confidential-token dApps:

- `references/zama-sdk-overview.md` - package map, `ZamaSDK`, presets
- `references/zama-sdk-auth-storage.md` - relayer transports, signers, storage, web extensions
- `references/zama-sdk-tokens.md` - `Token` / `ReadonlyToken`, shield / unshield / transfer / balance
- `references/zama-sdk-session.md` - sessions, TTLs, delegation
- `references/zama-sdk-react.md` - `ZamaProvider`, hooks catalog, SSR, Vite
- `references/zama-sdk-errors.md` - error taxonomy, `matchZamaError`
- `references/zama-sdk-activity.md` - activity feeds, event decoders, `WrappersRegistry`, builders, FHE artifact cache

This file covers the LEGACY `@zama-fhe/relayer-sdk` primitive layer (`createInstance`, `createEncryptedInput`, `userDecrypt`, `publicDecrypt`, `createEIP712`) plus shared concerns that apply to BOTH SDK families: WASM init, COOP / COEP, Vite / Next.js bundler quirks, mainnet API key.

The new SDK is built on top of the legacy primitives (it re-exports types from `@zama-fhe/relayer-sdk/bundle`). Both packages still ship; the contract toolchain (`@fhevm/mock-utils@0.4.2`, `@fhevm/hardhat-plugin@0.4.2`) requires `@zama-fhe/relayer-sdk@0.4.1` exact as a transitive install regardless of which client SDK you use. Latest published `@zama-fhe/relayer-sdk` is `0.4.3`, but the toolchain pin is still `0.4.1` exact.

## Contents

- SDK: @zama-fhe/relayer-sdk
- Installation
- Wallet Connector (RainbowKit + wagmi)
- Import - Sub-path REQUIRED
- Initialization (Browser Only)
- Create Instance
- Encrypting Inputs
- Public Decryption
- User Decryption (Private, EIP-712)
- Complete React Example
- Relayer Configuration
- Critical Gotchas

## SDK: @zama-fhe/relayer-sdk

The relayer SDK provides browser and Node.js APIs for encrypting inputs, decrypting values,
and interacting with FHEVM contracts.

---

## Installation

```bash
# Pin EXACT. The contract toolchain (@fhevm/mock-utils@0.4.2, @fhevm/hardhat-plugin@0.4.2)
# requires @zama-fhe/relayer-sdk@0.4.1 exact, so the frontend must match the wire format.
# --save-exact stops npm from rewriting "0.4.1" to "^0.4.1".
npm install --save-exact @zama-fhe/relayer-sdk@0.4.1
```

---

## Wallet Connector (RainbowKit + wagmi)

The relayer SDK does not ship a wallet connector. Pair it with a React wallet kit so the user can sign EIP-712 user-decrypt requests and on-chain transactions. The default-recommended stack (used by https://github.com/zunmax/fhevm-template) is **RainbowKit + wagmi + TanStack Query**:

```bash
npm install \
  @rainbow-me/rainbowkit@^2.2.10 \
  wagmi@^2.14.0 \
  @tanstack/react-query@^5.99.0 \
  viem
```

`viem` is a transitive of `wagmi`; declare it explicitly only if you import from it directly. `wagmi >= 2` and `@tanstack/react-query >= 5` are the same peer ranges declared by `@zama-fhe/react-sdk@^3.0.0`, so the new and legacy SDK families share a single wagmi tree.

Pattern (`getDefaultConfig` from RainbowKit returns a wagmi config with the standard connector set):

```ts
/* wagmi.ts */
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";

const PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
if (!PROJECT_ID) {
    console.warn("VITE_WALLETCONNECT_PROJECT_ID missing - WalletConnect connectors will not initialize, only injected (MetaMask) connectors will work");
}

export const wagmiConfig = getDefaultConfig({
    appName: "My FHEVM dApp",
    projectId: PROJECT_ID || "YOUR_PROJECT_ID",
    chains: [sepolia, mainnet],
    transports: {
        /* Override the default transport: wagmi's built-in mainnet RPC `https://eth.merkle.io`
         * does not send CORS headers, so wagmi `readContract` / `getBalance` calls fail in the
         * browser with no clear error. Use any CORS-friendly RPC (publicnode, your own, Alchemy, Infura). */
        [mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
        [sepolia.id]: http("https://ethereum-sepolia-rpc.publicnode.com"),
    },
});
```

Required environment:
- **WalletConnect Cloud project ID** (free at https://cloud.walletconnect.com/). Without it, the WalletConnect connector silently no-ops; only injected (MetaMask) connectors work. The frontend should warn at startup, not throw.
- Browser headers per the `Initialization` section: COOP `same-origin` + COEP `credentialless` (NOT `require-corp` - it blocks the RainbowKit modal's wallet-icon iframes and the WalletConnect QR popup).

Wrap the React tree with three providers; **order matters**: `WagmiProvider` -> `QueryClientProvider` -> `RainbowKitProvider`:

```tsx
import { WagmiProvider } from "wagmi";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { wagmiConfig } from "./wagmi";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider>{children}</RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
```

For Next.js App Router: the same providers, but the file containing `wagmiConfig` and `<Providers>` MUST start with `"use client"`. wagmi's persistent storage opens an `IndexedDB` connection at module load, which crashes during SSR prerender with `ReferenceError: indexedDB is not defined`. See `Next.js / Remix SSR` below.

**Alternatives**: `connectkit@^1.x` and `@web3modal/wagmi@^5.x` also work. The skill does not mandate RainbowKit - it is recommended because it ships the connect-button UI plus 60+ wallet adapters in one install and is what the official template uses. If your project already standardized on a different kit, keep it; the FHEVM relayer SDK is connector-agnostic. **Ask before swapping** an existing project's wallet kit.

**For the new SDK (`@zama-fhe/react-sdk@^3`)**: pair this wagmi tree with `WagmiSigner` from `@zama-fhe/react-sdk/wagmi` (NOT the base `@zama-fhe/react-sdk` import path). The wagmi-aware signer auto-revokes the FHEVM session when wagmi reports an account or chain change. Full pattern in `references/zama-sdk-react.md`.

---

## Import - Sub-path REQUIRED

The SDK uses conditional exports. A bare import will fail.

```typescript
/* Browser + bundler (Vite, Next.js, webpack) */
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';

/* Browser via CDN script tag */
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/bundle';

/* Node.js (server-side, scripts) */
import { createInstance } from '@zama-fhe/relayer-sdk/node';
```

**WRONG imports that will fail:**
```typescript
import { createInstance } from '@zama-fhe/relayer-sdk';     /* bare - fails */
import { createInstance } from '@fhevm/sdk';                 /* wrong package */
import { createInstance } from 'fhevmjs';                    /* deprecated */
```

---

## Initialization (Browser Only)

```typescript
/* Call before createInstance in browser environments to pre-load WASM modules.
   All parameters are optional. If omitted, createInstance will handle initialization
   internally, but calling initSDK() first gives you control over WASM loading timing. */
await initSDK();

/* NOT initFhevm() - that function does not exist in @zama-fhe/relayer-sdk */
```

**Browser headers required** (WASM SharedArrayBuffer needs these):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**IMPORTANT - wallet connector conflict**: `require-corp` blocks cross-origin resources that don't
send a `Cross-Origin-Resource-Policy` header. Wallet connectors like RainbowKit/WalletConnect load
external iframes and images that lack this header, so the browser blocks the wallet modal.
**Fix**: Use `credentialless` instead of `require-corp` when using external wallet connectors.
`credentialless` still enables SharedArrayBuffer but allows cross-origin resources to load:

```
Cross-Origin-Embedder-Policy: credentialless    /* use this with RainbowKit/WalletConnect */
Cross-Origin-Embedder-Policy: require-corp      /* use this ONLY if no external wallet UI */
```

### Vite Configuration

**CRITICAL - WASM loading**: The relayer SDK loads WASM files at runtime using
`new URL('tfhe_bg.wasm', import.meta.url)` and `new URL('kms_lib_bg.wasm', import.meta.url)`.
Vite's dependency pre-bundler (`optimizeDeps`) breaks these URL references by bundling the SDK
into a single file - after bundling, `import.meta.url` points to Vite's cache, not the original
module where the `.wasm` files live. The browser fetches a URL that doesn't exist, Vite returns
its SPA HTML fallback, and the WASM loader fails with:
`WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f`
(`3c 21 44 4f` = `<!DO` = start of `<!DOCTYPE html>` - a 404 page, not a WASM binary).

**Fix**: Exclude `@zama-fhe/relayer-sdk` from `optimizeDeps` and set worker format to `"es"`:

```typescript
/* vite.config.ts */
export default defineConfig({
    server: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            /* Use "credentialless" if using RainbowKit/WalletConnect/external wallet UIs */
            /* Use "require-corp" only if no external cross-origin resources are loaded */
            "Cross-Origin-Embedder-Policy": "credentialless",
        },
    },
    optimizeDeps: {
        /* Preserve new URL('*.wasm', import.meta.url) references in the SDK */
        exclude: ["@zama-fhe/relayer-sdk"],
    },
    worker: {
        format: "es",
    },
});
```

### Next.js Configuration
```typescript
/* next.config.js - default to credentialless to keep RainbowKit / WalletConnect / wagmi working */
module.exports = {
    async headers() {
        return [{
            source: "/(.*)",
            headers: [
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
            ],
        }];
    },
};
```

### Next.js / Remix SSR: `indexedDB is not defined`

The relayer SDK opens an `IndexedDB` cache on `initSDK()` / `createInstance()`. Wagmi's persistent
storage does the same. Neither exists during Node-side prerender, so importing or calling them at
module scope crashes the server build with:

```
Warning: BAILOUT_TO_CLIENT_SIDE_RENDERING
ReferenceError: indexedDB is not defined
```

**Fix**: mark the file `"use client"` and gate `initSDK` / `createInstance` behind `useEffect`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";

export function useFhevmInstance() {
    const [instance, setInstance] = useState<Awaited<ReturnType<typeof createInstance>>>();
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await initSDK();
            const i = await createInstance({ ...SepoliaConfig, network: window.ethereum });
            if (!cancelled) setInstance(i);
        })();
        return () => { cancelled = true; };
    }, []);
    return instance;
}
```

For provider trees, render a `mounted` flag that flips after the first `useEffect` and return
`null` until then; Wagmi + relayer SDK both then evaluate only on the client.

---

## Create Instance

```typescript
const instance = await createInstance({
    ...SepoliaConfig,
    network: window.ethereum,  /* or any EIP-1193 provider */
});
```

`SepoliaConfig` (from `@zama-fhe/relayer-sdk/web`) contains the correct v0.9 contract addresses,
relayer URL, and chain config. Do NOT hardcode addresses - always spread `SepoliaConfig`.

**WARNING - naming collision**: `SepoliaConfig` in the relayer SDK (frontend) is CORRECT and should
be used. `SepoliaConfig` in Solidity (from `@fhevm/solidity`) was the v0.8 config contract and is
REMOVED in v0.9. In Solidity, use `ZamaEthereumConfig` instead. They are completely different things:
- Frontend: `import { SepoliaConfig } from '@zama-fhe/relayer-sdk/web'` - CORRECT
- Solidity: `import { SepoliaConfig } from "@fhevm/solidity/..."` - WRONG, removed in v0.9

---

## Encrypting Inputs

```typescript
const contractAddress = "0x...";
const userAddress = "0x...";  /* connected wallet address */

/* Step 1: Create encrypted input bound to contract + user */
const input = instance.createEncryptedInput(contractAddress, userAddress);

/* Step 2: Add values to encrypt */
input.addBool(true);          /* ebool */
input.add8(42);               /* euint8 */
input.add16(1000);            /* euint16 */
input.add32(100000);          /* euint32 */
input.add64(1000000n);        /* euint64 - use BigInt for large values */
input.add128(999999999n);     /* euint128 */
input.add256(largeValue);     /* euint256 */
input.addAddress("0x...");    /* eaddress */

/* Step 3: Encrypt (async!) */
const encrypted = await input.encrypt();

/* Step 4: Send to contract */
const tx = await contract.myFunction(
    encrypted.handles[0],     /* bytes32 handle for first value */
    encrypted.handles[1],     /* bytes32 handle for second value */
    encrypted.inputProof      /* single proof for all values */
);
```

**Limits**: Max 2048 bits AND max 256 variables per input. Both enforced; variable cap usually binds first (see Critical Gotcha #7).

---

## Public Decryption

For values marked with `FHE.makePubliclyDecryptable()` on-chain:

```typescript
/* Get handles - publicDecrypt accepts string | Uint8Array.
   The result keys, however, are always lowercase hex strings (`0x${string}`),
   so look up by hex - indexing with a Uint8Array returns undefined.

   NOTE: `Buffer` is a Node global, not present in browser bundles. In a Vite/Next.js
   browser app, either (a) configure a Buffer polyfill (e.g. `vite-plugin-node-polyfills`)
   or (b) replace with the polyfill-free helper:
     const toHex = (b: Uint8Array) => '0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
   or (c) use `ethers.hexlify(handle)`. */
const handle1Hex = '0x' + Buffer.from(handle1).toString('hex') as `0x${string}`;
const handle2Hex = '0x' + Buffer.from(handle2).toString('hex') as `0x${string}`;
const handles = [handle1Hex, handle2Hex];

/* Decrypt */
const results = await instance.publicDecrypt(handles);

/* Access clear values - keys are the hex-string handles */
const value1 = results.clearValues[handle1Hex];  /* bigint | boolean | `0x${string}` */
const value2 = results.clearValues[handle2Hex];

/* Get proof data for on-chain verification */
const abiEncoded = results.abiEncodedClearValues;
const proof = results.decryptionProof;

/* Send back to contract for verification */
const tx = await contract.finalize(value1, value2, proof);
```

**CRITICAL**: Use `results.clearValues[handle]` - NOT `results.values[handle]`.
Result keys are always `0x${string}` hex; convert any `Uint8Array` handle before lookup.

**Return type:**
```typescript
type PublicDecryptResults = {
    clearValues: Record<`0x${string}`, bigint | boolean | `0x${string}`>;
    abiEncodedClearValues: `0x${string}`;
    decryptionProof: `0x${string}`;
};
```

---

## User Decryption (Private, EIP-712)

For values the user has ACL access to but are not publicly decryptable:

```typescript
/* Step 1: Generate ephemeral NaCl keypair */
const keypair = instance.generateKeypair();

/* Step 2: Create EIP-712 typed data */
const eip712 = instance.createEIP712(
    keypair.publicKey,
    [contractAddress],    /* contracts to decrypt from */
    startTimestamp,        /* when permission starts (unix seconds) */
    durationDays           /* how long permission lasts */
);

/* Step 3: User signs the EIP-712 message.
   Drop `EIP712Domain` from types (ethers v6 derives it from `domain`)
   and cast away the SDK's readonly tuple typing. */
const { EIP712Domain: _omit, ...typesWithoutDomain } = eip712.types;
const signature = await signer.signTypedData(
    eip712.domain,
    typesWithoutDomain as unknown as Record<string, Array<{ name: string; type: string }>>,
    eip712.message
);

/* Step 4: Decrypt */
const clearValues = await instance.userDecrypt(
    [{ handle: encHandle, contractAddress }],  /* handle-contract pairs to decrypt */
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [contractAddress],
    userAddress,
    startTimestamp,
    durationDays
);
```

---

## Complete React Example

```typescript
import { useState, useEffect } from 'react';
import { ethers, BrowserProvider } from 'ethers';
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';

function App() {
    const [instance, setInstance] = useState(null);

    useEffect(() => {
        async function init() {
            await initSDK();
            const inst = await createInstance({
                ...SepoliaConfig,
                network: window.ethereum,
            });
            setInstance(inst);
        }
        init();
    }, []);

    async function handleDeposit() {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const userAddr = await signer.getAddress();

        const input = instance.createEncryptedInput(CONTRACT_ADDR, userAddr);
        input.add64(1000n);
        const encrypted = await input.encrypt();

        const contract = new ethers.Contract(CONTRACT_ADDR, ABI, signer);
        const tx = await contract.deposit(encrypted.handles[0], encrypted.inputProof);
        await tx.wait();
    }

    return <button onClick={handleDeposit}>Deposit 1000</button>;
}
```

---

## Relayer Configuration

The SDK communicates with the Zama relayer for decryption operations.

| Setting | Value |
|---------|-------|
| Sepolia Relayer URL | `https://relayer.testnet.zama.org` |
| Gateway Chain ID | `10901` |

These are included in `SepoliaConfig` - you should NOT need to set them manually.

**WRONG URL**: `https://relayer.testnet.zama.cloud` (this was v0.8).

---

## Critical Gotchas

> Non-obvious SDK behaviors that agents consistently get wrong. Applies to `@zama-fhe/relayer-sdk@^0.4.1`.

### 1. `encrypt()` Returns `Uint8Array[]` Handles, NOT Hex Strings

```typescript
const encrypted = await input.encrypt();
/* encrypted.handles is Uint8Array[] - raw bytes, NOT '0x...' strings */
/* encrypted.inputProof is Uint8Array - raw bytes */

/* When passing to ethers.js contract calls, Uint8Array works for bytes32 params.
   But if you need hex, convert manually: */
const hexHandle = '0x' + Buffer.from(encrypted.handles[0]).toString('hex');
```

### 2. Handle Order in `encrypt()` Matches `add*()` Call Order

```typescript
input.add64(1000n);    /* -> encrypted.handles[0] */
input.add8(42);        /* -> encrypted.handles[1] */
input.addBool(true);   /* -> encrypted.handles[2] */
```

Order is guaranteed and critical - passing handles in wrong order corrupts decryption.

### 3. `userDecrypt` Returns Bare Record, NOT an Object With `.clearValues`

Both result types use `Record<`0x${string}`, ...>` keyed by hex strings. If your handle is a `Uint8Array`, convert before lookup (see "Public Decryption" above).

```typescript
const handleHex = '0x' + Buffer.from(handle).toString('hex') as `0x${string}`;

/* publicDecrypt - has .clearValues, .abiEncodedClearValues, .decryptionProof */
const pubResults = await instance.publicDecrypt([handleHex]);
const val1 = pubResults.clearValues[handleHex];  /* CORRECT for publicDecrypt */

/* userDecrypt - returns the record DIRECTLY, no wrapper */
const userResults = await instance.userDecrypt(...);
const val2 = userResults[handleHex];  /* CORRECT for userDecrypt - no .clearValues */
/* userResults.clearValues === undefined */
```

### 4. `SepoliaConfig` Omits `network` - You MUST Supply It

```typescript
/* SepoliaConfig type is Omit<FhevmInstanceConfig, 'network'> */
const instance = await createInstance({
    ...SepoliaConfig,
    network: window.ethereum,  /* REQUIRED - not included in SepoliaConfig */
});
```

The `network` field accepts an EIP-1193 provider object (`window.ethereum`) OR a plain URL string
(`"https://sepolia.infura.io/v3/YOUR_KEY"`).

### 5. Mainnet: `MainnetConfig` + API Key Authentication

Zama mainnet launched Dec 30, 2025. Available configs:
`SepoliaConfig`, `SepoliaConfigV1`, `SepoliaConfigV2`,
`MainnetConfig`, `MainnetConfigV1`, `MainnetConfigV2`.

Unlike Sepolia (open relayer), the **mainnet relayer requires authentication**. You have two options:

| Option | Description | Auth required |
|---|---|---|
| **Zama-hosted relayer** | Use Zama's managed relayer, pay monthly usage-based fees | YES - API key |
| **Self-hosted relayer** | Run your own relayer, fund your own gateway wallet | No key (you run it) |

Most teams pick Zama-hosted. For self-hosting, see the [SELF_HOSTING.md](https://github.com/zama-ai/fhevm/blob/main/relayer/docs/SELF_HOSTING.md) reference.

#### 5a. Obtaining the API key

Apply via Zama's form: https://forms.gle/jq84zEek1oiv3kBz9 - the Zama team reviews and contacts
applicants with next steps. **Before applying, end-to-end tests MUST pass on Sepolia testnet.**

#### 5b. Server-side / Node usage (RECOMMENDED)

Store the key in an environment variable and pass it via the `auth` field:

```typescript
import { createInstance, MainnetConfig } from '@zama-fhe/relayer-sdk/node';

const ZAMA_FHEVM_API_KEY = process.env.ZAMA_FHEVM_API_KEY;
if (!ZAMA_FHEVM_API_KEY) throw new Error('ZAMA_FHEVM_API_KEY not set');

const instance = await createInstance({
    ...MainnetConfig,
    network: 'https://ethereum-rpc.publicnode.com', /* or any mainnet RPC */
    auth: { __type: 'ApiKeyHeader', value: ZAMA_FHEVM_API_KEY },
});
```

#### 5c. Browser usage - NEVER PUT THE KEY IN THE CLIENT

The API key grants sponsored relayer operations billed to your account. Exposing it in
frontend/mobile code = anyone on the internet can drain your quota.

**RULES (all mandatory):**
- Never ship the key in bundled JS, env vars prefixed `NEXT_PUBLIC_*`/`VITE_*`, or mobile binaries.
- Never commit the key to git. Keep it out of `.env.example`.
- For browsers: **proxy through your own backend**. The SDK's `auth` field is OMITTED on the client;
  instead, point `relayerUrl` at your proxy, and the proxy injects the `x-api-key` header
  before forwarding to Zama's relayer.

**Client (browser) - no `auth` field, AND `relayerRouteVersion` MUST be set:**

For non-Zama `relayerUrl` values (any backend proxy), the SDK ignores the URL path suffix and falls back to `defaultRelayerVersion: 2` (camelCase response). Mainnet/testnet at `/v1` returns snake_case, so the camelCase validator throws `RelayerGetKeyUrlInvalidResponseError("Invalid relayer response.")`. Pin the version explicitly:

```typescript
import { createInstance, MainnetConfig } from '@zama-fhe/relayer-sdk/web';

const instance = await createInstance({
    ...MainnetConfig,
    network: window.ethereum,
    /* Include /v1 (or /v2) in the path so the proxy can hit the right upstream
       route. The path is concatenated as `${relayerUrl}/keyurl` etc.; it is NOT
       what the SDK uses to pick the validator version. */
    relayerUrl: 'https://your-backend.example.com/relayer/v1',
    /* REQUIRED for non-Zama URLs - must match the upstream version (1 or 2). */
    relayerRouteVersion: 1,
    /* NO auth field - the proxy adds `x-api-key` server-side. */
});
```

**Backend proxy (minimal Node/Express sketch):**
```typescript
/* Six requirements:
     (1) forward method, path, and body unchanged,
     (2) inject `x-api-key`,
     (3) return upstream status + body,
     (4) emit CORS for the dApp origin AND list the SDK's custom headers in
         Access-Control-Allow-Headers (preflight rejection otherwise),
     (5) strip `content-encoding` / `content-length` from the response (Node's
         fetch decodes gzip/br before .arrayBuffer(); copying the header lies
         to the browser -> ERR_CONTENT_DECODING_FAILED),
     (6) gate the request on origin / rate-limit / auth. */
import express from 'express';

const UPSTREAM = 'https://relayer.mainnet.zama.org'; /* confirm from Zama onboarding email */
const API_KEY = process.env.ZAMA_FHEVM_API_KEY?.trim();
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN!; /* e.g. https://app.example.com */
/* `trim()` only strips outer whitespace; an internal space (paste artifact)
   slips through and produces 401 from upstream. Reject it at startup. */
if (!API_KEY || /\s/.test(API_KEY)) throw new Error('ZAMA_FHEVM_API_KEY missing or contains whitespace');

/* The SDK adds these on every request (relayer-sdk/lib/web.js: ZAMA-SDK-VERSION,
   ZAMA-SDK-NAME). They MUST appear in the preflight allow-list AND be forwarded. */
const REQUEST_ALLOW = new Set(['content-type', 'accept', 'zama-sdk-version', 'zama-sdk-name']);
const RESPONSE_DENY = new Set([
    'content-encoding', 'content-length',
    'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'set-cookie',
]);

const app = express();
app.use(express.raw({ type: '*/*', limit: '10mb' }));

/* CORS: echo ONLY the configured origin; never reflect arbitrary `Origin`. */
app.use((req, res, next) => {
    if (req.headers.origin === ALLOWED_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'content-type, zama-sdk-version, zama-sdk-name');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
});

/* `app.use(prefix, ...)` works on Express 4 AND 5. `/relayer/*` parse-errors
   on Express 5 because `path-to-regexp` v8+ rejects bare wildcards. */
app.use('/relayer', async (req, res) => {
    if (req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).end();

    /* Forward only the headers the SDK actually relies on. */
    const headers: Record<string, string> = { 'x-api-key': API_KEY };
    for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string' && REQUEST_ALLOW.has(k.toLowerCase())) headers[k] = v;
    }

    const upstream = await fetch(`${UPSTREAM}${req.url}`, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : (req.body as Buffer),
    });

    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
        if (!RESPONSE_DENY.has(k.toLowerCase())) res.setHeader(k, v);
    });
    res.send(Buffer.from(await upstream.arrayBuffer()));
});
```

These protect your budget, not the upstream key:
- **CORS allowlist**: known dApp origins only; preflight blocks the rest.
- **Origin gate** in the handler: CORS is browser-advisory; curl ignores it.
- **Rate limit** (per-IP or per-user): a public proxy without one is a drain.
- **Per-user auth** (cookie / JWT / signed nonce): origin is not user identity.

#### 5d. `Auth` type reference

```typescript
type Auth = BearerToken | ApiKeyHeader | ApiKeyCookie;

type ApiKeyHeader = {
    __type: 'ApiKeyHeader';
    header?: string;  /* default: 'x-api-key' */
    value: string;    /* the API key itself */
};

type ApiKeyCookie = {
    __type: 'ApiKeyCookie';
    cookie?: string;  /* default: 'x-api-key' */
    value: string;
};

type BearerToken = {
    __type: 'BearerToken';
    token: string;    /* sent as `Authorization: Bearer <token>` */
};
```

For the Zama-hosted mainnet relayer, **use `ApiKeyHeader`**. Do not guess other shapes.

#### 5e. If a key is compromised

1. Email `support@zama.org` immediately.
2. Request a replacement key.
3. Stop using the compromised key in every environment (rotate CI secrets, re-deploy backend).

Zama may suspend a key automatically if abuse is detected.

#### 5f. Common mistakes on mainnet

- Using `SepoliaConfig` on chain 1 - decryption silently targets the wrong gateway.
- Omitting the `auth` field server-side - requests return `401 unauthorized`.
- Putting the key in a `NEXT_PUBLIC_*` / `VITE_*` env var - the key ships to every visitor.
- Skipping testnet validation - mainnet relayer usage is billed; bugs cost real money.
- Hardcoding `https://relayer.testnet.zama.org` in mainnet config - always spread `MainnetConfig`.
- Omitting `relayerRouteVersion` on a non-Zama proxy URL - SDK defaults to v2 (camelCase) but upstream `/v1` returns snake_case -> `Invalid relayer response.` See anti-pattern #25h.
- Allow-listing only `content-type` in proxy CORS - SDK adds `zama-sdk-version` and `zama-sdk-name` headers; preflight fails. See #25d, #25f.
- Forwarding upstream `content-encoding` from the proxy - browser `ERR_CONTENT_DECODING_FAILED`. See #25g.
- API key with internal whitespace - 401 despite being "set"; `trim()` keeps internal spaces. See #25i.

### 6. `publicDecrypt` Throws on Unresolved Handles - No Partial Results

If any handle in the array hasn't been marked `makePubliclyDecryptable` on-chain,
the entire `publicDecrypt` call throws. There is no graceful partial-success mode.

### 7. Two Per-Input Limits - `MAX_VAR_COUNT` Binds Before `MAX_FHE_BITS`

```typescript
/* MAX_FHE_BITS  = 2048   total ciphertext bit budget */
/* MAX_VAR_COUNT = 256    max add*() calls in one input */

const input = instance.createEncryptedInput(c, u);
for (let i = 0; i < 256; i++) input.addBool(true);   /* OK */
input.addBool(true);
/* throws: Packing more than 256 variables in a single input ciphertext is unsupported */
```

`addBool` costs 2 bits AND 1 variable slot. The 256-variable cap binds first: max 256 bools per input, not 1024.
