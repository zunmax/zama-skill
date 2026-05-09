# Zama SDK (`@zama-fhe/sdk` v3.x) Overview

The TypeScript surface for confidential dApps built on FHEVM. This file is the entry
point for any task that touches `@zama-fhe/sdk` or `@zama-fhe/react-sdk`. The Solidity
side (`@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@fhevm/mock-utils`) is unchanged
and is documented in the rest of `references/`.

## Contents

- New SDK vs Legacy Relayer SDK
- Packages and Versions
- Subpath Exports
- The Three Required Pieces (Relayer, Signer, Storage)
- ZamaSDK Constructor Reference
- ZamaSDK Methods
- Network Presets
- Quick Start
- Where to Read Next

## New SDK vs Legacy Relayer SDK

There are now TWO TypeScript SDK families. Both still ship from npm; both are
maintained.

| Family | npm | Latest | Role |
|---|---|---|---|
| New high-level SDK | `@zama-fhe/sdk` | `3.0.0` (2026-04-22) | `ZamaSDK`, `Token`, sessions, storage, hooks |
| New React variant | `@zama-fhe/react-sdk` | `3.0.0` | TanStack-Query hooks + `ZamaProvider` |
| Legacy primitive SDK | `@zama-fhe/relayer-sdk` | `0.4.3` (2026-05-06) | `createInstance`, `createEncryptedInput`, `userDecrypt`, `publicDecrypt`, `createEIP712` |

`@zama-fhe/sdk@3.x` is built on top of `@zama-fhe/relayer-sdk` (it re-exports types
from `@zama-fhe/relayer-sdk/bundle`). The legacy package is NOT deprecated and is
still required as a transitive install for the contract toolchain
(`@fhevm/mock-utils@0.4.2` peers `@zama-fhe/relayer-sdk` at exact `0.4.1`).

When to use which:

- Building a confidential ERC-7984 dApp (shield / unshield / transfer / balance)
  -> `@zama-fhe/sdk` or `@zama-fhe/react-sdk`. Use the high-level `Token` API.
- Building a custom confidential contract that is NOT an ERC-7984 wrapper (raw
  encrypted inputs, custom decrypt flows) -> still works with `@zama-fhe/sdk`
  via `sdk.userDecrypt(...)` and `sdk.relayer.createEncryptedInput(...)`, OR
  drop directly into `@zama-fhe/relayer-sdk` if you do not want the session
  layer. See `references/inputs-decryption.md` for the legacy path.
- Hardhat tests -> still `@fhevm/hardhat-plugin` + `@zama-fhe/relayer-sdk@0.4.1`
  exact (the new SDK is for runtime apps, not for `hardhat test`).

## Packages and Versions

```bash
# React app (Browser, hooks)
npm install @zama-fhe/react-sdk@^3.0.0 @tanstack/react-query@^5

# Vanilla TypeScript / Node.js
npm install @zama-fhe/sdk@^3.0.0
```

Peer requirements (verified against the published `package.json`):

- `@zama-fhe/sdk@3.0.0`: `viem >= 2`, `ethers >= 6`, `@tanstack/query-core >= 5`.
- `@zama-fhe/react-sdk@3.0.0`: `viem ^2.47.0`, `react >= 18`, `wagmi >= 2`,
  `@zama-fhe/sdk ^3.0.0`, `@tanstack/react-query >= 5`.
- Both packages declare `engines.node` `>= 22`. Node 20 is NOT supported by
  the new SDK runtime path (the contract toolchain still works on Node 20).

## Subpath Exports

```ts
/* Core SDK entry - browser, vanilla, and shared types */
import { ZamaSDK, RelayerWeb, indexedDBStorage } from "@zama-fhe/sdk";

/* Node.js relayer + per-request storage */
import { RelayerNode, asyncLocalStorage } from "@zama-fhe/sdk/node";

/* viem signer adapter */
import { ViemSigner } from "@zama-fhe/sdk/viem";

/* ethers signer adapter */
import { EthersSigner } from "@zama-fhe/sdk/ethers";

/* TanStack Query keys factory */
import { zamaQueryKeys } from "@zama-fhe/sdk/query";

/* Handle helpers (re-exported from main entry, NOT from /cleartext) */
import { isZeroHandle, ZERO_HANDLE } from "@zama-fhe/sdk";
```

```ts
/* React */
import { ZamaProvider, useShield, useUnshield } from "@zama-fhe/react-sdk";
import { WagmiSigner } from "@zama-fhe/react-sdk/wagmi";
```

The new SDK uses conditional exports. A bare import of a non-published path
fails at install / build time. The exact entry list is `.`, `./node`,
`./viem`, `./ethers`, `./query`, `./cleartext`, `./package.json` for
`@zama-fhe/sdk`, and `.`, `./wagmi`, `./package.json` for the React variant.

## The Three Required Pieces (Relayer, Signer, Storage)

A `ZamaSDK` instance always needs three collaborators. Picking the right one
per environment is the single most common source of breakage.

### Relayer

| Class | Subpath | Use when |
|---|---|---|
| `RelayerWeb` | `@zama-fhe/sdk` | Browser, React Native, any environment with a Web Worker. FHE runs in WASM in the worker. |
| `RelayerNode` | `@zama-fhe/sdk/node` | Node.js servers, scripts. FHE runs on native worker threads (`poolSize` defaults to `min(cpuCount, 4)`). |
| `RelayerCleartext` | `@zama-fhe/sdk` (dev only) | Local Hardhat or custom chain without a KMS / gateway. Operates in cleartext mode for local development. See `references/zama-sdk-auth-storage.md`. |

`RelayerWeb` in Node and `RelayerNode` in browser both throw at construction.
The relayer must match the runtime.

### Signer

| Class | Subpath | Use when |
|---|---|---|
| `ViemSigner` | `@zama-fhe/sdk/viem` | viem-based apps. Pass `{ walletClient, publicClient }`. |
| `EthersSigner` | `@zama-fhe/sdk/ethers` | ethers v6 apps. Pass `{ ethereum }` (EIP-1193) in browser, or `{ signer }` (`ethers.Signer`) in Node. |
| `WagmiSigner` | `@zama-fhe/react-sdk/wagmi` | React + wagmi. Auto-revokes session on account / chain change via the wagmi config subscription. |
| `GenericSigner` interface | `@zama-fhe/sdk` | Custom wallet (smart account, keystore, hardware). Implement `getAddress`, `getChainId`, `signTypedData`, `signMessage`, `subscribe?`. |

### Storage

`storage` persists the FHE re-encryption keypair. `sessionStorage` (optional)
persists wallet EIP-712 signatures so users do not sign on every operation.

| Singleton | Subpath | Use for `storage` |
|---|---|---|
| `indexedDBStorage` | `@zama-fhe/sdk` | Browser apps. Persistent across reloads. |
| `memoryStorage` | `@zama-fhe/sdk` | Tests, scripts, throwaway sessions. Lost on process exit. |
| `asyncLocalStorage` | `@zama-fhe/sdk/node` | Node.js servers. Per-request keypair isolation. |
| `chromeSessionStorage` | `@zama-fhe/sdk` | MV3 web extensions; pair with `indexedDBStorage` for the `storage` slot and pass this for `sessionStorage`. |

Custom backends implement `GenericStorage` (async key-value: `get`, `set`,
`delete` - NOT the DOM `getItem` / `setItem` / `removeItem` shape).

## ZamaSDK Constructor Reference

```ts
import { ZamaSDK, indexedDBStorage } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({
    relayer,
    signer,
    storage: indexedDBStorage,

    /* Optional fields - all defaults shown */
    sessionStorage: undefined, /* defaults to in-memory */
    keypairTTL: 2_592_000, /* 30 days; max 31_536_000 (365); 0 rejected; > max auto-capped with warn */
    sessionTTL: 2_592_000, /* number | "infinite"; 0 = sign every op */
    registryAddresses: undefined, /* Record<chainId, Address> overrides */
    registryTTL: 86_400, /* 24h cached registry results */
    onEvent: undefined, /* (event: ZamaSDKEvent) => void */
    signerLifecycleCallbacks: undefined, /* { onDisconnect?, onAccountChange?, onChainChange? } */
});
```

`keypairTTL = 0` throws at construction (the keypair is required for the
relayer). Values above `31_536_000` (365 days) are silently clamped with a
console warning, because the FHEVM ACL contract rejects `durationDays > 365`.

`sessionTTL = 0` is the high-security mode: every operation triggers a wallet
signature prompt. `"infinite"` keeps the session forever (until `revokeSession`
or wallet disconnect).

## ZamaSDK Methods

| Method | Purpose |
|---|---|
| `createToken(tokenAddr, wrapperAddr?)` | Read/write `Token` (shield, unshield, transfer, balance). When the token IS the wrapper (most ERC-7984), omit the second arg. |
| `createReadonlyToken(tokenAddr)` | `ReadonlyToken` (queries + batch decrypt; no wallet writes). |
| `createWrappersRegistry(addresses?)` | New `WrappersRegistry` instance. Mainnet / Sepolia auto-resolve; Hardhat needs `addresses`. |
| `allow(contractAddresses[])` | Pre-authorize a set of contracts for decryption with one signature; the credential cache is reused for any later `userDecrypt` on those contracts. |
| `userDecrypt([{ handle, contractAddress }])` | Decrypts FHE handles; cached results return without a relayer call; zero-handles resolve to `0n` without prompting. |
| `revokeSession()` | Clears session signature AND `sdk.cache`. Next decrypt prompts again. |
| `dispose()` | Unsubscribe from signer lifecycle. Keeps the relayer alive. |
| `terminate()` | `dispose()` + terminates the Web Worker / thread pool. |

Properties:

- `sdk.cache` (`DecryptCache`) - persistent decrypted-value cache scoped by
  `(requester, contractAddress, handle)`. Cleared automatically on
  `revoke` / `revokeSession` / disconnect / account change / chain change.
- `sdk.registry` (`WrappersRegistry`) - shared registry tied to the SDK's
  signer + `registryAddresses` + `registryTTL`. Prefer over
  `createWrappersRegistry()` for cache reuse.

## Network Presets

```ts
import { MainnetConfig, SepoliaConfig, HardhatConfig, DefaultRegistryAddresses }
    from "@zama-fhe/sdk";
```

| Preset | Chain ID |
|---|---|
| `MainnetConfig` | `1` (Ethereum) |
| `SepoliaConfig` | `11155111` |
| `HardhatConfig` | `31337` |

Each preset includes `chainId`, `gatewayChainId`, `relayerUrl`, `network`
(default RPC), `aclContractAddress`, `kmsContractAddress`,
`inputVerifierContractAddress`, `verifyingContractAddressDecryption`,
`verifyingContractAddressInputVerification`, and `registryAddress`
(`undefined` for `HardhatConfig`).

`DefaultRegistryAddresses` is a `Record<number, Address>` with the built-in
registry addresses for Mainnet, Sepolia, and Hoodi. `HardhatConfig` has no
default registry; pass `registryAddresses: { [31337]: "0x..." }` if your
local chain has one deployed.

## Quick Start

```ts
import { ZamaSDK, RelayerWeb, indexedDBStorage, MainnetConfig, SepoliaConfig }
    from "@zama-fhe/sdk";
import { ViemSigner } from "@zama-fhe/sdk/viem";

const signer = new ViemSigner({ walletClient, publicClient });

const sdk = new ZamaSDK({
    relayer: new RelayerWeb({
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
    }),
    signer,
    storage: indexedDBStorage,
});

const token = sdk.createToken("0xEncryptedERC20");
await token.shield(1000n); /* deposit public ERC-20 -> confidential */
const balance = await token.balanceOf(); /* decrypt my balance */
await token.confidentialTransfer("0xRecipient", 500n);
await token.unshield(500n); /* withdraw back to public */
```

`token.shield`, `token.unshield`, and `token.confidentialTransfer` each return
`{ txHash, receipt }` (unshield's `txHash` is the finalize tx, the second of
two on-chain steps). Full token API in `references/zama-sdk-tokens.md`.

## Where to Read Next

| File | When to load |
|---|---|
| `references/zama-sdk-auth-storage.md` | Setting up relayer + signer + storage, backend proxy, `RelayerCleartext`, network presets |
| `references/zama-sdk-tokens.md` | `Token` / `ReadonlyToken`, shield, unshield (resumable), confidentialTransfer, balances |
| `references/zama-sdk-session.md` | Session model, `allow` / `userDecrypt` / `revokeSession`, full delegation API |
| `references/zama-sdk-react.md` | `ZamaProvider`, 59 hooks grouped by category, Next.js SSR, web extensions, wagmi |
| `references/zama-sdk-errors.md` | Error taxonomy, `matchZamaError`, common recovery flows |
| `references/zama-sdk-activity.md` | Activity feeds + event decoders + operator approvals + wrappers registry |
| `references/inputs-decryption.md` | Legacy `@zama-fhe/relayer-sdk` primitives (still valid for non-token contracts) |
| `references/frontend.md` | Browser-specific WASM / COOP / COEP / Vite / Next.js setup (applies to both SDK families) |

Trust hierarchy stays the same as the rest of the skill:

```
installed source > skill references > Zama docs > training knowledge
```

`node_modules/@zama-fhe/sdk/dist/...` is the source of truth. The Zama docs
at `https://docs.zama.org/protocol/sdk/` are second. Training knowledge is
last; the SDK released its first stable major in 2026-04 so older patterns
do not exist.
