# FHEVM Anti-Patterns and Common Mistakes

> 62 common mistakes to reject in FHEVM code, for v0.11. Each entry lists the WRONG form, the CORRECT form, and a grep pattern where applicable. Scan every generated file against this list before delivering. Run `node scripts/fhe-lint.js` to mechanically check the highest-priority rules.

## Table of Contents

- [Severity Classification](#severity-classification)
- [Common Runtime Errors -> Root Causes](#common-runtime-errors--root-causes)
- [Solidity Mistakes (16)](#solidity-mistakes-16) - #1-14, #14b, #14c
- [Frontend / SDK Mistakes (7)](#frontend--sdk-mistakes-7) - #15, #16, #17, #18, #19, #19b, #19c
- [Hardhat Plugin Mistakes (7)](#hardhat-plugin-mistakes-7) - #20, #21, #22a, #22b, #22c, #22d, #22e
- [Address and Configuration Mistakes (12)](#address-and-configuration-mistakes-12) - #23, #24, #25, #25a-#25i
- [FHEVM Logic Errors (Additional)](#fhevm-logic-errors-additional-patterns)
- [Deep-Dive Gotchas (7)](#deep-dive-gotchas-source-code-derived-anti-patterns) - #26-32
- [New SDK Mistakes (13)](#new-sdk-zama-fhesdk3-and-zama-fhereact-sdk3-mistakes) - #33-#45
- [Verification Grep Patterns](#verification-grep-patterns)

## Severity Classification

When reviewing code, classify each finding using this system. The five-row rubric matches `finding-validation.md` and the SKILL.md Confidence to Severity table.

| Confidence Label | Confidence Range | Criteria | Action |
|------------------|------------------|----------|--------|
| `DEFINITE BUG`   | >=95             | Source-verified, will revert, lose data, or violate the documented invariant | Must fix before delivery |
| `LIKELY ISSUE`   | 80-94            | Strong evidence, one verification step away from definite | Fix or document why safe |
| `PROBABLE ISSUE` | 70-79            | Partial path, plausible exploit, additional source review needed | Investigate; report regardless |
| `SUGGESTION`     | 40-69            | Possible improvement, may be intentional design choice | Report; let the reviewer decide |
| `NOTE`           | <40              | Code-quality observation with no exploit path | Optional; include only if material |

Every finding MUST include the confidence label, evidence (file:line + what you observed), and a specific fix. Do NOT guess; verify against installed source first (2-layer verification).

---

## Common Runtime Errors -> Root Causes

Use this table to diagnose FHEVM errors. When you see one of these errors, check the listed cause FIRST.

| Error / Symptom | Severity | Root Cause | Fix |
|----------------|----------|-----------|-----|
| Custom error `SenderNotAllowed(address)` (`ACL.sol:106`) | DEFINITE BUG | Missing `FHE.allow()` for the caller, or transient ACL expired at end of prior tx because `FHE.allowThis()` was missing | Add `FHE.allow(value, msg.sender)` and/or `FHE.allowThis(value)` after every stored computation |
| Custom error `ACLNotAllowed(bytes32 handle, address account)` (`FHEVMExecutor.sol:37`) | DEFINITE BUG | An FHE operation tried to read a handle the calling contract has no ACL on | Trace the missing `FHE.allowThis(handle)` step that should have run when the handle was produced |
| Custom error `SenderNotAllowedToUseHandle(bytes32, address)` (`FHE.sol:74 declaration; FHE.sol:8502 revert site`) | DEFINITE BUG | `FHE.fromExternal` Path 2 (no proof) saw a handle the contract has no ACL on | Pass the original `inputProof`, or grant transient ACL on the re-used handle before the call |
| Custom error `DivisionByZero()` (`FHEVMExecutor.sol:40`) | DEFINITE BUG | `FHE.div(x, 0)` or `FHE.rem(x, 0)` with plaintext zero divisor | Guard the plaintext divisor: `require(divisor != 0)` before the call |
| Compile error `Member "div" not found ... after argument-dependent lookup` | DEFINITE BUG | Encrypted divisor passed to `FHE.div`/`FHE.rem` (no such overload) | Cast/decrypt to plaintext or restructure so the divisor is `uintN` |
| Custom error `NotPowerOfTwo()` (`FHEVMExecutor.sol:55`) | DEFINITE BUG | `FHE.randEuintX(upperBound)` with non-power-of-2 bound | Use a power-of-2 upperBound |
| Custom error `KMSInvalidSigner(address)` (`KMSVerifier.sol:22`) OR `InvalidKMSSignatures()` (`FHE.sol:71 declaration; FHE.sol:9502 revert site`) | DEFINITE BUG | `FHE.checkSignatures` got cleartexts/handles in the wrong order vs `publicDecrypt`, OR the KMS signature set is below threshold. At runtime you typically hit `KMSInvalidSigner` first (KMSVerifier rejects the recovered address); `InvalidKMSSignatures` is the FHE-library wrapper raised when `_verifySignatures` returns false without reverting first. | Reorder cts/cleartexts to match the off-chain `publicDecrypt` call exactly |
| Custom error `EmptyInputProof()` / `DeserializingInputProofFail()` / `InvalidInputHandle()` / `InvalidHandleVersion()` (`InputVerifier.sol`) | DEFINITE BUG | Wrong `inputProof` paired with handle, or stale proof from a different `encrypt()` call | Use `inputProof` from the same `instance.createEncryptedInput(...).encrypt()` call |
| Custom error `EmptyDecryptionProof()` / `DeserializingDecryptionProofFail()` (`KMSVerifier.sol`) | DEFINITE BUG | `FHE.checkSignatures` received an empty / malformed `decryptionProof` | Pass the raw `results.decryptionProof` from the relayer SDK `publicDecrypt` call |
| `Error: Cannot decrypt more than 2048 encrypted bits in a single request` | DEFINITE BUG | `userDecrypt` was called with handles whose total bit-width exceeds 2048. Enforced by `check2048EncryptedBits` in `@zama-fhe/relayer-sdk/src/relayer/decryptUtils.ts`; checked twice in `userDecrypt.ts` against `handleContractPairs`. | Split the request: e.g. one `userDecrypt` per `euint256` (256 bits), two `euint128`, or up to 32 `euint64`. The cap is per call, not per session. |
| Custom error `ZamaProtocolUnsupported()` (`ZamaConfig.sol:15`) | DEFINITE BUG | Contract inheriting `ZamaEthereumConfig` deployed to a chain other than 1 / 11155111 / 31337 | Deploy to a supported chain or write a custom config base |
| Custom error `HCUTransactionLimitExceeded()` / `HCUTransactionDepthLimitExceeded()` (`HCULimit.sol:22, 25`) | DEFINITE BUG | A single tx exceeded `MAX_HOMOMORPHIC_COMPUTE_UNITS_PER_TX = 20_000_000` total HCU or `MAX_HOMOMORPHIC_COMPUTE_UNITS_DEPTH_PER_TX = 5_000_000` sequential-depth HCU. Common with deep `FHE.mul` chains on `euint128`+ or large encrypted comparisons. | Split work across multiple txs, prefer `euint64` over wider widths, use `FHE.select` / batched plaintext divisor where possible, and budget with `fhevm.computeTransactionHCU(receipt)` in tests |
| `initSDK()` fails in browser | LIKELY ISSUE | Missing COOP/COEP HTTP headers | Add `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` |
| Import resolution error on SDK | DEFINITE BUG | Bare `@zama-fhe/relayer-sdk` import | Add sub-path: `/web`, `/bundle`, or `/node` |
| "function not found" on FHE.xxx | DEFINITE BUG | Wrong function name (`neq`, `lte`, `TFHE.`) | Check exact name in operations reference |
| Contract works in mock but fails on Sepolia | LIKELY ISSUE | v0.8 addresses or patterns used | Verify all addresses match the current v0.11 Sepolia table at https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia.md |
| Encrypted value always 0 in next tx | DEFINITE BUG | Missing `FHE.allowThis()` after computation | Add `FHE.allowThis(result)` after storing |
| CORS preflight fails on `/keyurl`, `/input-proof`, etc. | DEFINITE BUG | Proxy `Access-Control-Allow-Headers` omits the SDK's custom headers | Allow `content-type, zama-sdk-version, zama-sdk-name` (#25d / #25f) |
| `net::ERR_CONTENT_DECODING_FAILED` on proxy responses | DEFINITE BUG | Proxy forwards upstream `content-encoding` while sending decompressed bytes | Strip `content-encoding` and `content-length` from the response (#25g) |
| `RelayerGetKeyUrlInvalidResponseError: Invalid relayer response.` | DEFINITE BUG | Non-Zama `relayerUrl` defaults to `defaultRelayerVersion: 2` (camelCase); upstream returns snake_case at `/v1` | Pass `relayerRouteVersion: 1` (or `2`, matching upstream) (#25h) |
| 401 Unauthorized despite key set | DEFINITE BUG | Whitespace inside the API key string survives `trim()` | Reject keys matching `/\s/` at startup (#25i) |

---

## Solidity Mistakes (16)

### 1. Wrong Config Contract
```solidity
/* WRONG */ contract MyToken is SepoliaConfig { }
/* CORRECT */ contract MyToken is ZamaEthereumConfig { }
```
`SepoliaConfig` was v0.8 and is removed. Always use `ZamaEthereumConfig` from `@fhevm/solidity/config/ZamaConfig.sol`.

### 2. Wrong Input Conversion
```solidity
/* WRONG */ euint64 amount = FHE.asEuint64(encAmount, proof);
/* CORRECT */ euint64 amount = FHE.fromExternal(encAmount, proof);
```
`FHE.asEuint64(42)` converts a Solidity literal or uint variable into an encrypted value.
User-submitted encrypted inputs (which arrive as `externalEuint64` + `bytes inputProof`) MUST use
`FHE.fromExternal(encAmount, proof)` - this verifies the ZK proof that the user's encryption is valid.

### 3. Using Removed requestDecryption
```solidity
/* WRONG */ FHE.requestDecryption(handle);
/* CORRECT - 3-step self-relaying */
FHE.makePubliclyDecryptable(handle);
/* then off-chain publicDecrypt + on-chain checkSignatures */
```
`FHE.requestDecryption()` was removed in v0.9 along with the Oracle/Gateway.

### 4. Wrong checkSignatures Signature
```solidity
/* WRONG - any signature other than v0.9. Old request-id-based forms (e.g. (uint256, bytes, bytes[]))
   from pre-v0.9 codebases / training data fail to compile against @fhevm/solidity@0.11.1 because
   the function is not overloaded - only the v0.9 form below exists. */
/* CORRECT (v0.9, verified at @fhevm/solidity/lib/FHE.sol:9495-9499) */
FHE.checkSignatures(bytes32[] memory handlesList, bytes memory abiEncodedCleartexts, bytes memory decryptionProof);
```

### 5. Wrong allowForDecryption call site
```solidity
/* WRONG - no such helper on the FHE library */
FHE.allowForDecryption(handle);
/* CORRECT - use the single-handle wrapper on the FHE library */
FHE.makePubliclyDecryptable(handle);
```
`FHE.allowForDecryption` never existed as a library helper. The host-contract API
`IACL.allowForDecryption(bytes32[] handlesList)` does still exist
(`@fhevm/host-contracts/contracts/ACL.sol:209`); `FHE.makePubliclyDecryptable` wraps it
for the single-handle path via `Impl.sol:742`. Use the library wrapper from contract code.

### 6. Wrong Comparison Function Name: neq
```solidity
/* WRONG */ ebool result = FHE.neq(a, b);
/* CORRECT */ ebool result = FHE.ne(a, b);
```

### 7. Wrong Comparison Function Name: lte
```solidity
/* WRONG */ ebool result = FHE.lte(a, b);
/* CORRECT */ ebool result = FHE.le(a, b);
```
Similarly: `FHE.gte()` does not exist - use `FHE.ge()`.

### 8. Wrong Bool Cast Function (no width-suffixed `asEbool*` exists)
```solidity
/* WRONG - no width-suffixed bool cast in @fhevm/solidity@0.11.1 */
ebool f1 = FHE.asEbool64(x);
ebool f2 = FHE.asEbool8(x);

/* CORRECT - one untagged FHE.asEbool with seven overloads (FHE.sol:7996, 8067,
   8138, 8209, 8280, 8351, 8510): asEbool(euint8|euint16|euint32|euint64|euint128|euint256|bool) */
euint64 x = FHE.asEuint64(0);
ebool flag = FHE.asEbool(x);
```

### 9. Using Signed Integer Types
```solidity
/* WRONG - declared but unusable */ eint64 signedVal = ...;
/* `eint8`..`eint256` ARE declared as bytes32 UDVTs in encrypted-types/EncryptedTypes.sol,
   so this single statement compiles. The first FHE op (e.g. FHE.add(eint64, eint64)) fails
   with `Member "<op>" not found ... after argument-dependent lookup in type(library FHE)`
   because @fhevm/solidity@0.11.1 ships zero overloads for signed types. */

/* CORRECT - use unsigned types only */ euint64 unsignedVal = ...;
```

### 10. Wrong Library Name (TFHE vs FHE)
```solidity
/* WRONG */ euint64 result = TFHE.add(a, b);
/* CORRECT */ euint64 result = FHE.add(a, b);
```
The library is `FHE`, not `TFHE`. `TFHE` is the underlying Rust library name, not the Solidity API.

### 11. Using Removed GatewayCaller
```solidity
/* WRONG */ contract MyContract is GatewayCaller { }
/* CORRECT */ contract MyContract is ZamaEthereumConfig { }
```
`GatewayCaller` was part of the v0.8 Oracle pattern. It's removed in v0.9.

### 12. Pragma Version Hygiene
```solidity
/* MISLEADING - compiles, but the imported FHE.sol pragma `^0.8.24` forces solc >= 0.8.24 anyway */
pragma solidity ^0.8.0;

/* CORRECT - matches the library's own minimum, communicates intent to readers */
pragma solidity ^0.8.24;

/* RECOMMENDED - matches the reference template; exposes `^0.8.27`+ features needed by `@openzeppelin/confidential-contracts` */
pragma solidity ^0.8.28;
```
The FHEVM library files declare `pragma solidity ^0.8.24;` (verified at `node_modules/@fhevm/solidity/lib/FHE.sol:2`). solc resolves the strictest of all pragmas in the dep tree, so a consumer's `^0.8.0` does not actually fail to compile - it just lies about the floor. ERC-7984 (`@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol:3`) declares `^0.8.27`, which forces solc >= 0.8.27 whenever ERC7984 is imported. Pin your local pragma to `^0.8.28` to match the reference template; never to `^0.8.0` or below `^0.8.24`.

### 13. Branching on Encrypted Values
```solidity
/* WRONG - encrypted bool cannot be used in require */
require(FHE.le(amount, balance), "Insufficient");

/* CORRECT - use FHE.select for encrypted conditional logic */
ebool hasEnough = FHE.le(amount, balance);
euint64 newBal = FHE.select(hasEnough, FHE.sub(balance, amount), balance);
```

### 14. Wrong Verify Function Name
```solidity
/* WRONG */ FHE.verifySignatures(cts, cleartexts, proof);
/* CORRECT */ FHE.checkSignatures(cts, cleartexts, proof);
```
**Note**: Zama's own migration guide at docs.zama.org/protocol/migrate mentions `FHE.verifySignatures()`
in its summary table, but the actual v0.11 API reference and all working code examples use `FHE.checkSignatures()`.
The API reference (with full function signature) is the source of truth.

### 14b. `view` / `pure` on State-Modifying FHE Calls `DEFINITE BUG`
```solidity
/* WRONG - reverts at runtime; FHE.add writes coprocessor state via the host contracts */
function getDoubleBalance(address user) external view returns (euint64) {
    return FHE.add(_balances[user], _balances[user]);
}

/* WRONG - FHE.allow / FHE.allowThis modify ACL storage; reverts in view/pure context */
function peekBalance(address user) external view returns (euint64) {
    euint64 bal = _balances[user];
    FHE.allow(bal, msg.sender);
    return bal;
}

/* CORRECT - drop the `view` modifier on any function that performs FHE math, ACL grants,
   external-input verification, public-decrypt marking, or signature checks. */
function getDoubleBalance(address user) external returns (euint64) {
    return FHE.add(_balances[user], _balances[user]);
}

/* CORRECT - returning an existing handle (state read only) IS safe in view/pure */
function balanceOf(address user) external view returns (euint64) {
    return _balances[user];
}
```
Every `FHE.*` call EXCEPT the four read-only predicates (`FHE.isInitialized`, `FHE.isAllowed`,
`FHE.isSenderAllowed`, `FHE.isPubliclyDecryptable`) goes through `FHEVMExecutor` /
`ACL` host contracts and modifies their storage. Solidity rejects the state write at the EVM
boundary with a runtime revert. Returning a previously-stored handle is a pure storage read and
is fine in `view` / `pure`.

### 14c. Encrypted Loop Bound `DEFINITE BUG`
```solidity
/* WRONG - euint64 is a bytes32 UDVT; no comparison operator with uint exists, compile error
   "Operator < not compatible with types uint256 and euint64" */
for (uint i = 0; i < encryptedCount; i++) { ... }

/* WRONG - unwrapping just gives bytes32, which still has no `<` operator with uint */
for (uint i = 0; i < uint256(euint64.unwrap(encryptedCount)); i++) { ... }
/* This compiles but the cast reads the OPAQUE HANDLE (a pointer), not the cleartext value -
   you'd loop a random number of times, not the count the user encrypted. */

/* CORRECT - fix the iteration count plaintext, gate per-iteration work with FHE.select */
uint256 constant MAX_ITEMS = 10;
for (uint i = 0; i < MAX_ITEMS; i++) {
    ebool active = FHE.lt(FHE.asEuint64(uint64(i)), encryptedCount);
    euint64 inc = FHE.select(active, FHE.asEuint64(1), FHE.asEuint64(0));
    total = FHE.add(total, inc);
}
```
You cannot vary control flow on encrypted data. The same rule that bans `if (ebool)` and
`require(ebool)` (#13) bans encrypted loop bounds and encrypted `break` / early-return. Choose a
worst-case plaintext bound, run all iterations unconditionally, and gate the EFFECT of each
iteration with `FHE.select`. Side channels: keep both branches of `FHE.select` symmetric in
gas and storage writes (see P22 in `fhe-vulnerabilities.md`).

---

## Frontend / SDK Mistakes (7)

### 15. Bare SDK Import (Missing Sub-path)
```typescript
/* WRONG - bare import fails */
import { createInstance } from '@zama-fhe/relayer-sdk';

/* CORRECT - must use sub-path */
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';    /* browser */
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/bundle';  /* CDN */
import { createInstance } from '@zama-fhe/relayer-sdk/node';                             /* Node.js */
```

### 16. Wrong Init Function Name
```typescript
/* WRONG - does not exist */
await initFhevm();

/* CORRECT */
await initSDK();  /* browser only - not needed for Node.js */
```

### 17. Wrong Public Decrypt Result Field
```typescript
/* WRONG */
const val = results.values[handle];

/* CORRECT */
const val = results.clearValues[handle];
```
The field is `clearValues`, not `values`. Check the `PublicDecryptResults` type definition in `@zama-fhe/relayer-sdk`.
**Note**: Zama's own documentation has a bug here - their code example at
docs.zama.org/protocol/solidity-guides/smart-contract/oracle uses `results.values[efoo]`,
but the actual TypeScript type definition says `clearValues`. The type definition is the source of truth.

### 18. Wrong SDK Package Name
```typescript
/* WRONG - package does not exist */
import { ... } from '@fhevm/sdk';

/* CORRECT */
import { ... } from '@zama-fhe/relayer-sdk/web';
```

### 19. Missing COOP/COEP Headers
The relayer SDK uses WASM with SharedArrayBuffer, which requires these HTTP headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```
Without them, `initSDK()` will fail in the browser.

### 19b. Vite WASM Loading Failure (optimizeDeps)
```
/* ERROR in browser console: */
WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0
```
The relayer SDK loads WASM via `new URL('tfhe_bg.wasm', import.meta.url)`. Vite's dependency
pre-bundler (`optimizeDeps`) breaks this by rewriting `import.meta.url` to point at Vite's cache
instead of the original module directory. The browser fetches a non-existent URL, gets the SPA
HTML fallback (`<!DOCTYPE html>`), and fails to parse it as WASM.

**Fix**: Exclude the SDK from pre-bundling:
```typescript
/* vite.config.ts */
optimizeDeps: {
    exclude: ["@zama-fhe/relayer-sdk"],
},
worker: {
    format: "es",
},
```

### 19c. Next.js / SSR `indexedDB is not defined`
```
/* ERROR during Next.js server-render (or Remix loader): */
ReferenceError: indexedDB is not defined
Warning: BAILOUT_TO_CLIENT_SIDE_RENDERING
```
The relayer SDK opens an `IndexedDB` cache on `initSDK()` / `createInstance()`. Wagmi's
persistent connector does the same. Neither exists during Node-side prerender, so the
import-time evaluation throws.

**Fix - mark the file client-only and gate init behind `useEffect`:**
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

## Hardhat Plugin Mistakes (7)

### 20. FhevmType on userDecryptEbool
```typescript
/* WRONG - ebool does NOT take FhevmType */
const val = await fhevm.userDecryptEbool(FhevmType.ebool, handle, addr, signer);

/* CORRECT */
const val = await fhevm.userDecryptEbool(handle, addr, signer);
```

### 21. FhevmType on userDecryptEaddress
```typescript
/* WRONG - eaddress does NOT take FhevmType */
const val = await fhevm.userDecryptEaddress(FhevmType.eaddress, handle, addr, signer);

/* CORRECT */
const val = await fhevm.userDecryptEaddress(handle, addr, signer);
```

Only `userDecryptEuint` (and `publicDecryptEuint`) take the `FhevmType` parameter.

### 22a. Installing hardhat-deploy or hardhat-ethers without a Hardhat-2 pin `HIGH`
```bash
/* WRONG - resolves to hardhat-deploy@^2.0 / @nomicfoundation/hardhat-ethers@^4.x */
npm install -D hardhat-deploy
npm install -D @nomicfoundation/hardhat-ethers

/* Produces: ERESOLVE unable to resolve dependency tree
   peer hardhat@"^3.x" required; installed hardhat@2.28.x */

/* CORRECT */
npm install -D hardhat-deploy@^0.11.45
npm install -D @nomicfoundation/hardhat-ethers@^3.1.3
```
`@fhevm/hardhat-plugin@0.4.2` peers to `hardhat@^2.0.0` (verified in installed
`node_modules/@fhevm/hardhat-plugin/package.json` `peerDependencies`; the `^2.28.4` figure
appears only in the plugin's own `devDependencies`). Hardhat 3 still breaks the install.

### 22b. Installing hardhat-network-helpers without a Hardhat-2 pin `HIGH`
```bash
/* WRONG - resolves to v3.x which peers hardhat@^3.x */
npm install -D @nomicfoundation/hardhat-network-helpers

/* Produces: ERESOLVE unable to resolve dependency tree
   peer hardhat@"^3.4.0" required; installed hardhat@2.28.x */

/* CORRECT */
npm install -D @nomicfoundation/hardhat-network-helpers@^1.1.2
```
Tests that use `time.increase`, `time.latest`, `mine`, `setBalance`, etc. import from this package. The v1 line is the last Hardhat-2-compatible release line.

### 22c. Caret on @zama-fhe/relayer-sdk in a Hardhat project `HIGH`
```bash
/* WRONG - caret allows 0.4.2 which @fhevm/mock-utils@0.4.2 rejects */
npm install -D @zama-fhe/relayer-sdk@^0.4.1

/* ALSO WRONG - npm rewrites "0.4.1" to "^0.4.1" in package.json by default,
   so the lockfile drifts upward on the next `npm install` */
npm install -D @zama-fhe/relayer-sdk@0.4.1

/* Plugin runtime aborts:
   Error in plugin @fhevm/hardhat-plugin: Invalid @zama-fhe/relayer-sdk version.
   Expecting 0.4.1. Got 0.4.2 instead. */

/* CORRECT - --save-exact tells npm to write "0.4.1" verbatim, no caret */
npm install -D --save-exact @zama-fhe/relayer-sdk@0.4.1
```
`@fhevm/mock-utils` declares the SDK as an exact peer (not a range). The hardhat plugin enforces the same exact version at startup. Use a caret only in pure frontend / non-hardhat projects where mock-utils is absent.

### 22d. Using Old fhevmjs in Tests
```typescript
/* WRONG - deprecated package */
import { createInstance } from 'fhevmjs';

/* CORRECT */
import { fhevm } from 'hardhat';
import { FhevmType } from '@fhevm/hardhat-plugin';
```

### 22e. Comparing a Decrypted Value to a JS `number` `HIGH`
```typescript
/* WRONG - assertion fails with "expected 1000n to equal 1000" */
const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, addr, signer);
expect(clear).to.eq(1000);

/* CORRECT - decrypted euint values are bigint; compare to a bigint literal */
expect(clear).to.eq(1000n);
expect(clear).to.eq(BigInt(1000));
```
`fhevm.userDecryptEuint` and `fhevm.publicDecryptEuint` return `Promise<bigint>` (verified at
`@fhevm/hardhat-plugin` `dist/types.d.ts`). Chai's `.to.eq` does a strict `===` comparison and
`1000n === 1000` is `false` in JavaScript. Apply the same rule to `expect(...).to.equal(...)`,
`assert.strictEqual`, and template-string substitutions of the decrypted value. `userDecryptEbool`
returns `Promise<boolean>` and `userDecryptEaddress` returns `Promise<string>` (checksummed) - those
two compare normally; only the `Euint` family returns `bigint`.

---

## Address and Configuration Mistakes (12)

### 23. Wrong Relayer URL
```
WRONG:  https://relayer.testnet.zama.cloud
CORRECT: https://relayer.testnet.zama.org
```
The `.cloud` domain was v0.8. v0.9 onwards (including v0.11) uses `.org`.

### 24. v0.8 Contract Addresses
All contract addresses changed between v0.8 and v0.9 and have remained stable through v0.11:
```
WRONG (v0.8 ACL):       0x687820...
CORRECT (v0.11 ACL):    0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D (Sepolia)
```
Verified live at https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia.md.

### 25. Hardcoding Addresses Instead of Using Config
```solidity
/* WRONG - hardcoded addresses break on version changes */
address constant ACL = 0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D;

/* CORRECT - inherit from the config contract (only Solidity base in v0.9) */
contract MyContract is ZamaEthereumConfig { }
```

For the **frontend**, the relayer SDK ships a separate (TypeScript) `SepoliaConfig` constant
exported from `@zama-fhe/relayer-sdk/web` (see `web.d.ts:1926`). It is a JS object containing
relayer URLs and contract addresses for chain 11155111 - it is NOT a Solidity contract and is NOT
something a Solidity contract can inherit from. Same for `MainnetConfig` (`web.d.ts:1189`). These
are unrelated to the Solidity `ZamaEthereumConfig` base.

### 25a. Exposing the Zama Mainnet API Key to the Browser `CRITICAL`
The mainnet relayer is authenticated. Anything that ships to a visitor's browser is public.

```typescript
/* CRITICAL - key leaks to every visitor */
const instance = await createInstance({
    ...MainnetConfig,
    network: window.ethereum,
    auth: { __type: 'ApiKeyHeader', value: process.env.NEXT_PUBLIC_ZAMA_API_KEY! },
});
```

```typescript
/* CORRECT - client points at your backend proxy, no `auth` field */
const instance = await createInstance({
    ...MainnetConfig,
    network: window.ethereum,
    relayerUrl: 'https://your-backend.example.com/relayer/v1',
    relayerRouteVersion: 1, /* required for non-Zama URLs - see #25h */
});

/* On the server, a proxy injects `x-api-key` before forwarding to the upstream relayer. */
```

Also wrong: committing the key, placing it in `VITE_*` / `NEXT_PUBLIC_*` vars, hardcoding in source, logging to telemetry. Rotate via `support@zama.org` if leaked.

### 25b. Missing `auth` Field on Mainnet Server Requests
Sepolia's relayer is unauthenticated; mainnet's is not. Requests without `auth` return `401`.

```typescript
/* WRONG - 401 unauthorized on chain 1 */
const instance = await createInstance({ ...MainnetConfig, network: rpcUrl });

/* CORRECT */
const instance = await createInstance({
    ...MainnetConfig,
    network: rpcUrl,
    auth: { __type: 'ApiKeyHeader', value: process.env.ZAMA_FHEVM_API_KEY! },
});
```

### 25c. Using `SepoliaConfig` on Mainnet (or Vice Versa)
`SepoliaConfig` contains chain-id 11155111 gateway addresses; `MainnetConfig` contains chain-id 1. Mixing them silently targets the wrong gateway and decryption will fail.

```typescript
/* WRONG - production app still using testnet config */
const instance = await createInstance({ ...SepoliaConfig, network: mainnetRpc });

/* CORRECT */
const instance = await createInstance({
    ...MainnetConfig,
    network: mainnetRpc,
    auth: { __type: 'ApiKeyHeader', value: process.env.ZAMA_FHEVM_API_KEY! },
});
```

### 25d. Mainnet Proxy Without CORS Headers (or Wrong Allow-Headers) `HIGH`
Browser blocks the response on preflight. Works in curl, fails in the dApp with a generic CORS error. The SDK adds `ZAMA-SDK-VERSION` and `ZAMA-SDK-NAME` on every request (verified in `relayer-sdk/lib/web.js`); both MUST appear in `Access-Control-Allow-Headers` or preflight is rejected.

```typescript
/* WRONG - no CORS, no OPTIONS, no SDK custom headers */
app.use('/relayer', async (req, res) => {
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { headers: { 'x-api-key': API_KEY } });
    /* ... */
});

/* CORRECT - echo allowlisted origin, answer OPTIONS, list SDK custom headers */
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
```

Never reflect arbitrary `Origin` values - that turns the proxy into an open relay. Allowlist explicit origins only.

### 25e. Open Mainnet Proxy (No Origin Gate / Rate Limit) `HIGH`
CORS is browser-advisory; curl, bots, and scraped URLs ignore it. A proxy with the API key but no server-side validation lets anyone drain the key budget.

```typescript
/* WRONG - publicly callable; any client with the URL submits on your dime */
app.use('/relayer', async (req, res) => {
    const upstream = await fetch(`${UPSTREAM}${req.url}`, { headers: { 'x-api-key': API_KEY } });
    /* ... */
});

/* CORRECT - origin gate + rate limit; add per-user auth for production */
import rateLimit from 'express-rate-limit';
app.use('/relayer', rateLimit({ windowMs: 60_000, max: 60 }));
app.use('/relayer', async (req, res) => {
    if (req.headers.origin !== ALLOWED_ORIGIN) return res.status(403).end();
    /* ... forward with x-api-key ... */
});
```

Origin alone is not user identity. For production add a session cookie, JWT, or wallet-signed nonce.

### 25f. Proxy Strips SDK Headers When Forwarding to Upstream `HIGH`
Symptom: preflight passes, GET still fails or upstream returns 4xx. A header allowlist that hardcodes only `content-type` drops the SDK's `ZAMA-SDK-VERSION` / `ZAMA-SDK-NAME` headers (verified `relayer-sdk/lib/web.js: fetchRelayerV1Get` and `_fetchRelayerGet`). The Zama relayer uses these for telemetry and version routing.

```typescript
/* WRONG - SDK headers vanish on the way to upstream */
const upstream = await fetch(`${UPSTREAM}${req.url}`, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] ?? 'application/json', 'x-api-key': API_KEY },
});

/* CORRECT - allowlist the SDK headers and forward them. The SDK emits `content-type`,
   `zama-sdk-version`, and `zama-sdk-name` on browser->proxy hops in proxy setups
   (verified internal.js:4942-5218 and 7522-7585). Auth headers (`Authorization`,
   `x-api-key`, `Cookie`, or a custom name) are only added by setAuth() at internal.js:4008
   when the caller passes an `auth` config; proxy setups don't, so the SDK->proxy hop only
   carries these three. `accept` is harmless to allow but optional; do NOT add it to the
   Access-Control-Allow-Headers list in 25d unless you intentionally let other middleware send it. */
const ALLOW = new Set(['content-type', 'zama-sdk-version', 'zama-sdk-name']);
const out: Record<string, string> = { 'x-api-key': API_KEY };
for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string' && ALLOW.has(k.toLowerCase())) out[k] = v;
}
const upstream = await fetch(`${UPSTREAM}${req.url}`, { method: req.method, headers: out, body: req.body });
```

### 25g. Proxy Forwards Upstream `content-encoding` / `content-length` `HIGH`
Symptom in DevTools: `net::ERR_CONTENT_DECODING_FAILED`. Node's `fetch()` transparently decodes `gzip` / `br` before `.arrayBuffer()`. Copying `content-encoding: br` from upstream onto the response tells the browser to decode an already-decoded body. Original `content-length` is also wrong post-decode.

```typescript
/* WRONG - copies every upstream header verbatim */
upstream.headers.forEach((v, k) => res.setHeader(k, v));

/* CORRECT - drop body-encoding headers; let the runtime recompute length */
const DENY = new Set([
    'content-encoding', 'content-length',
    'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'set-cookie',
]);
upstream.headers.forEach((v, k) => { if (!DENY.has(k.toLowerCase())) res.setHeader(k, v); });
```

### 25h. Non-Zama Relayer URL Without `relayerRouteVersion` `CRITICAL`
Symptom: `RelayerGetKeyUrlInvalidResponseError: Invalid relayer response.` even though `/keyurl` returns 200 with valid JSON. Verified in `relayer-sdk/lib/web.js`:

- `parseRelayerUrl` only auto-detects v1/v2 from the path suffix when the URL is in the hardcoded Zama list (`SepoliaRelayerBaseUrl`, `MainnetRelayerBaseUrl`, and their `/v1` / `/v2` variants).
- For ANY other URL (a backend proxy), the suffix is ignored and the SDK falls back to `defaultRelayerVersion: 2`.
- v2 expects **camelCase** (`fheKeyInfo`, `fhePublicKey`, `dataId`); v1 expects **snake_case** (`fhe_key_info`, `fhe_public_key`, `data_id`). The mainnet/testnet relayer at `/v1` returns snake_case.

```typescript
/* WRONG - proxy URL is non-Zama, so /v1 in the path is ignored.
   SDK validates with the v2 (camelCase) validator -> "Invalid relayer response." */
const instance = await createInstance({
    ...MainnetConfig,
    network: window.ethereum,
    relayerUrl: 'https://your-backend.example.com/relayer/v1',
});

/* CORRECT - pin the version explicitly so the validator matches what upstream returns */
const instance = await createInstance({
    ...MainnetConfig,
    network: window.ethereum,
    relayerUrl: 'https://your-backend.example.com/relayer/v1',
    relayerRouteVersion: 1,
});
```

If the proxy forwards to upstream `/v2`, set `relayerRouteVersion: 2`. The version field in the createInstance config MUST match the version path the proxy hits on Zama.

### 25i. API Key With Embedded Whitespace `HIGH`
Symptom: 401 Unauthorized despite a "set" key. `process.env.X?.trim()` only strips leading/trailing whitespace; an internal space (paste artifact, e.g. `zmr_mainnet_abc Z2hWHO...`) survives and ships to upstream as a malformed key.

```typescript
/* WRONG - silently accepts internal whitespace */
const API_KEY = process.env.ZAMA_FHEVM_API_KEY?.trim();
if (!API_KEY) throw new Error('Missing key');

/* CORRECT - reject any whitespace anywhere in the key */
const API_KEY = process.env.ZAMA_FHEVM_API_KEY?.trim();
if (!API_KEY || /\s/.test(API_KEY)) {
    throw new Error('ZAMA_FHEVM_API_KEY contains whitespace - paste artifact?');
}
```

---

## FHEVM Logic Errors (Additional Patterns)

### Missing ACL After Computation
```solidity
/* BUG - contract loses access to the new balance */
_balances[user] = FHE.add(_balances[user], amount);

/* CORRECT */
_balances[user] = FHE.add(_balances[user], amount);
FHE.allowThis(_balances[user]);
FHE.allow(_balances[user], user);
```

### Uninitialized Handle Comparison
```solidity
/* BUG - comparing with uninitialized handle (zero) */
ebool isEqual = FHE.eq(_value, otherValue);

/* CORRECT - check initialization first */
require(FHE.isInitialized(_value), "Not initialized");
ebool isEqual = FHE.eq(_value, otherValue);
```

### Encrypted Division by Encrypted Value
```solidity
/* WRONG - panics at runtime */
euint64 result = FHE.div(a, b);

/* CORRECT - divisor must be plaintext */
euint64 result = FHE.div(a, 10);
```

---

## Verification Grep Patterns

After generating any FHEVM code, grep for these patterns to confirm ZERO matches:

**Solidity files:**
`requestDecryption`, `SepoliaConfig` (in .sol), `GatewayCaller`, `TFHE.`, `allowForDecryption`,
`neq(`, `lte(`, `gte(`, `asEboolXX`, `verifySignatures`, `zama.cloud`,
`eint8`, `eint16`, `eint32`, `eint64`, `eint128`, `eint256` (signed types - declared in `encrypted-types/EncryptedTypes.sol` so a bare `eint64 x;` compiles, but `@fhevm/solidity@0.11.1` ships zero `FHE.*` overloads for them; the first operation fails with `Member "<op>" not found ... after argument-dependent lookup in type(library FHE)`),
`randBounded` (function doesn't exist - bounded random uses overload: `FHE.randEuint32(128)` - upperBound MUST be power of 2)

**Frontend files:**
bare `'@zama-fhe/relayer-sdk'` (without sub-path), `initFhevm`, `@fhevm/sdk`, `results.values[`

**Test files:**
`userDecryptEbool(FhevmType`, `userDecryptEaddress(FhevmType`, `fhevmjs`,
`publicDecryptEbool(handle, contractAddr` (publicDecrypt functions do NOT take contractAddress - only handle + optional options)

---

## AI Agent Pitfalls

> Patterns where AI agents consistently emit wrong code. Each entry: the incorrect pattern, the correct one, and how to prevent the mistake. These compile or look correct but fail at runtime or produce wrong behavior.

### Pitfall A: Inventing Function Names That Don't Exist (`randBounded`)

**Typical error**: Writing `FHE.randBoundedEuint32(100)` - inferred from Zama docs mentioning "bounded random."
**Actual API**: Bounded random is an **overload** of the same function: `FHE.randEuint32(uint32 upperBound)`.
There is no separate `FHE.randBoundedEuint32()` function.
**Prevention**: Always grep the `.sol` source for exact function names. Do not infer from concept descriptions.

### Pitfall B: Wrong Parameters for `publicDecryptE*` in Hardhat Tests

**Typical error**: Writing `fhevm.publicDecryptEbool(handle, contractAddress)` - assuming `publicDecrypt` mirrors `userDecrypt` signatures.
**Actual API**:
- `publicDecryptEbool(handleBytes32: string, options?: FhevmPublicDecryptOptions)` - NO contractAddress
- `publicDecryptEuint(fhevmType: FhevmTypeEuint, handleBytes32: string, options?: FhevmPublicDecryptOptions)` - NO contractAddress
- `publicDecryptEaddress(handleBytes32: string, options?: FhevmPublicDecryptOptions)` - NO contractAddress
**Prevention**: Read the `.d.ts` type definitions. `userDecrypt` and `publicDecrypt` have different parameter lists.

### Pitfall C: Missing `externalEbool` + `inputProof` on Boolean Parameters

**Typical error**: Writing `function vote(ebool voteYes)` - treating `ebool` like Solidity `bool`.
**Actual requirement**: External users must submit `externalEbool` + `bytes calldata inputProof`, then convert inside with `FHE.fromExternal(encVoteYes, inputProof)`.
**Prevention**: ALL encrypted inputs from external callers MUST use `external*` types + `inputProof` + `FHE.fromExternal()`. No exceptions - not even for booleans.

### Pitfall D: Claiming `initSDK()` is Mandatory

**Typical error**: Writing "MUST call `initSDK()` before `createInstance()`."
**Actual API**: `initSDK` has fully optional parameters. `createInstance()` handles WASM initialization internally. Calling `initSDK()` first gives control over timing but is not required.
**Prevention**: Check whether function parameters are optional (`?`) before claiming a function is required.

### Pitfall E: Trusting Documentation Over Source Code

**Known documentation bugs in Zama's own docs**:
1. `results.values[handle]` in their code example -> actual TypeScript type says `results.clearValues[handle]`
2. `FHE.verifySignatures()` in their migration guide -> actual function is `FHE.checkSignatures()`
**Prevention**: TypeScript type definitions (`.d.ts`) and Solidity source (`.sol`) are the source of truth. When docs and source disagree, source wins.

### Pitfall F: Treating `euint160` as Interchangeable with `eaddress`

**Typical error**: Grouping `eaddress` and `euint160` together in type tables as if they share operations, or attempting casts between them.
**Actual API**: `euint160` is declared in EncryptedTypes.sol but FHE.sol has **ZERO functions** for it. Only `eaddress` has eq/ne/select. No conversion exists between the two types.
**Prevention**: Grep FHE.sol for actual function signatures before assuming type compatibility. Same bit width does not mean same functionality.

### Pitfall G: Inventing Delegation Function Names

**Typical error**: Writing `FHE.delegateAccount()`, `FHE.removeDelegateAccount()`, `FHE.isDelegated()` - guessed from the concept of "delegation."
**Actual API**: The functions are `FHE.delegateUserDecryption(delegate, contractAddress, expirationDate)`, `FHE.revokeUserDecryptionDelegation(delegate, contractAddress)`, `FHE.isDelegatedForUserDecryption(delegator, delegate, contractAddress, handle)`.
**Prevention**: Always grep FHE.sol for exact function names. Concept-based guessing produces plausible but wrong names.

### Pitfall H: Wrong `computeTransactionHCU` Parameter and Return Types

**Typical error**: Writing `fhevm.computeTransactionHCU(txHash)` with a hash string, expecting a `bigint` return.
**Actual API**: Parameter is `ethers.TransactionReceipt` (not a hash string). Returns `FhevmTransactionHCUInfo` object with `transactionHash`, `globalHCU`, `maxHCUDepth`, and `HCUDepthByHandle` fields - not a plain `bigint`.
**Prevention**: Read the `.d.ts` type definitions for exact parameter and return types. Function names alone do not reveal the expected types.

### Pitfall I: Trusting a Source Code Comment Over On-Chain Reality

**Typical error**: Reading ZamaConfig.sol line 48 ("The addresses below are placeholders and should be replaced...") and reporting that mainnet is not yet supported.
**Actual state**: Zama mainnet launched Dec 30, 2025. All three mainnet addresses in ZamaConfig.sol are real deployed contracts on Ethereum L1 (verified on Etherscan, deployed Nov 19, 2025). The comment is stale - never updated after deployment.
**Prevention**: Source code LOGIC is the source of truth; source code COMMENTS can be stale. When a comment says "placeholder" but addresses are used in production code paths, verify on-chain before repeating the claim.

### Pitfall J: Claiming Bounded Random "Works With Bias" for Non-Power-of-2

**Typical error**: Writing `FHE.randEuint32(100)` and claiming it works with "slight modular bias," or fabricating claims about internal "modular reduction."
**Actual API**: The NatSpec says "The upperBound must be a power of 2." FHEVMExecutor enforces this at runtime with `_isPowerOfTwo(upperBound)` - non-power-of-2 values cause `revert NotPowerOfTwo()`. They do NOT work with bias.
**Prevention**: When documentation conflicts with NatSpec + runtime enforcement code, the code wins. Note that Zama's own `fhevm-solidity/docs/random.md` shows `FHE.randEuint8(100)` which would actually revert - do not trust it. Never invent claims about internal implementation without evidence in the source.

---

## Deep-Dive Gotchas (Source-Code-Derived Anti-Patterns)

> These anti-patterns come from the actual FHE.sol and SDK source code, not from Zama's official docs.
> They are undocumented behaviors that are especially likely to confuse AI agents.

### 26. FHE.select() Does NOT Support Cross-Type Branches

```solidity
/* WRONG - will not compile */
euint64 result = FHE.select(cond, euint8Value, euint64Value);

/* CORRECT - cast the narrower type first */
euint64 result = FHE.select(cond, FHE.asEuint64(euint8Value), euint64Value);
```

**Why this is confusing**: `FHE.add(euint8, euint64)` auto-upcasts and works fine (35 overloads of `add`
support cross-type: 5x5 encrypted-encrypted pairs + 5x2 scalar directions, verified by grep on
`@fhevm/solidity@0.11.1` `lib/FHE.sol`). But `FHE.select()` requires EXACT same type for both branches.
This inconsistency is the #1 source of "function not found" errors when working with mixed types.

### 27. Encrypted Zero != Uninitialized - They Are Completely Different

```solidity
euint64 encZero = FHE.asEuint64(0);  /* handle: 0xabc123... (non-zero) */
euint64 unset;                        /* handle: 0x000000... (zero)     */

FHE.isInitialized(encZero);   /* TRUE  - encZero has a real handle */
FHE.isInitialized(unset);     /* FALSE - unset is the zero handle  */

/* DANGER: FHE.allowThis(unset) does NOT revert - it silently creates encrypted zero */
```

**Why this is confusing**: In normal Solidity, `uint64 x;` and `uint64 x = 0;` are the same thing.
In FHEVM, `euint64 x;` (uninitialized, zero handle) and `FHE.asEuint64(0)` (initialized, non-zero
handle) are completely different states. Guard with `require(FHE.isInitialized(...))` before operating.

### 28. Division by Plaintext Zero Reverts (Not Silent Wrap)

```solidity
/* REVERTS with custom error DivisionByZero() raised by FHEVMExecutor */
euint64 result = FHE.div(encValue, 0);

/* All FHE arithmetic wraps on overflow (unchecked), but division by zero
   is the ONE exception that causes a hard revert. */
```

**Why this is confusing**: All other FHE arithmetic is explicitly "unchecked" (wraps on overflow).
Division by zero is the sole exception. Source: `@fhevm/host-contracts/contracts/FHEVMExecutor.sol`
declares `error DivisionByZero();` and `fheDiv` / `fheRem` revert with it when `rhs == 0`. This is a
custom error, NOT the EVM `Panic(0x12)` that Solidity 0.8+ raises on plaintext `x / 0`.

### 29. Bounded Random Upper Bound MUST Be Power of 2 `DEFINITE BUG`

```solidity
/* WRONG - reverts with NotPowerOfTwo() at runtime */
euint32 val = FHE.randEuint32(100);

/* CORRECT - upperBound must be a power of 2 */
euint32 dice = FHE.randEuint32(8);    /* 0 to 7 */
euint32 big = FHE.randEuint32(128);   /* 0 to 127 */

/* For non-power-of-2 ranges, use rem with plaintext divisor: */
euint32 d100 = FHE.rem(FHE.randEuint32(128), 100);  /* 0 to 99 */
```

Per FHE.sol NatSpec: "The upperBound must be a power of 2." This is enforced at runtime
by `FHEVMExecutor._generateRandBounded()` which checks `_isPowerOfTwo(upperBound)` and
reverts with `NotPowerOfTwo()` if the check fails. Non-power-of-2 values do NOT "work with bias"
- they cause a hard revert.

**Note**: Some Zama documentation (fhevm-solidity/docs/random.md) shows `FHE.randEuint8(100)` as
an example - this is WRONG and would revert on-chain. The correct documentation
(fhevm/docs/random.md) properly states the power-of-2 requirement.

### 30. `euint160` Has ZERO FHE Functions - Use `eaddress` Instead

```solidity
/* WRONG - euint160 has no FHE.sol functions at all */
euint160 val = FHE.asEuint160(42);  /* Does NOT exist */

/* CORRECT - use eaddress for 160-bit encrypted values */
eaddress addr = FHE.asEaddress(0x1234...);

/* There is NO conversion between eaddress and euint160.
   euint160 is declared in EncryptedTypes.sol but FHE.sol has zero functions for it.
   Always use eaddress for 160-bit encrypted values. */
```

### 31. ZamaConfig.sol Comment Says "Placeholders" - But Mainnet Is LIVE

```solidity
/* ZamaConfig.sol line 48-49 has a STALE comment: */
/* "The addresses below are placeholders and should be replaced..." */

/* This comment is WRONG / outdated. Mainnet launched Dec 30, 2025.
   All three addresses are real deployed contracts (verified on Etherscan, Nov 19 2025):
   ACL:          0xcA2E8f1F656CD25C01F05d0b243Ab1ecd4a8ffb6
   Coprocessor:  0xD82385dADa1ae3E969447f20A3164F6213100e75
   KMSVerifier:  0x77627828a55156b04Ac0DC0eb30467f1a552BB03
   Zama simply never updated the comment after deploying. Do NOT skip mainnet support. */
```

**Why this matters**: An AI agent reading the source code comment might tell a developer "mainnet
isn't supported yet" or "these addresses will change" - both wrong. The addresses are final and live.
This is a real example of why source code COMMENTS can be wrong even when source code LOGIC is right.

### 32. Shift/Rotate Amount Must Be `uint8` or `euint8` - Never the Wider Encrypted Type `DEFINITE BUG`

```solidity
/* WRONG - no overload exists for a wider plaintext shift amount */
euint64 result = FHE.shl(counter, uint64(4));
euint64 result = FHE.shr(counter, uint64(16));

/* WRONG - no overload for a wider encrypted shift amount either */
euint64 result = FHE.shl(counter, euint64ShiftAmount);
/* Fails with: Member "shl" not found or not visible after argument-dependent lookup. */

/* CORRECT - plaintext uint8 shift amount */
euint64 result = FHE.shl(counter, uint8(4));
euint64 result = FHE.shr(counter, uint8(16));
euint64 result = FHE.rotl(counter, uint8(8));
euint64 result = FHE.rotr(counter, uint8(1));

/* CORRECT - encrypted euint8 shift amount */
euint64 result = FHE.shl(counter, euint8ShiftAmount);
```

**Why this is confusing**: For arithmetic and bitwise operations, the plaintext scalar type matches
the encrypted type's width (`FHE.add(euint64, uint64)`, `FHE.and(euint64, uint64)`). AI agents
naturally assume shift amounts follow the same rule. They don't - the shift amount must be a
narrow `uint8` or `euint8`, regardless of the first operand's width. This applies to ALL
encrypted types, including `euint128` and `euint256`.

**Empirical test** (solc 0.8.28 + @fhevm/solidity@0.11.1):

| Call                                  | Result                                                |
|---------------------------------------|-------------------------------------------------------|
| `FHE.shl(euint64, uint8)`             | compiles                                              |
| `FHE.shl(euint64, euint8)`            | compiles                                              |
| `FHE.shl(euint64, uint64)`            | fails - no overload                                   |
| `FHE.shl(euint64, euint64)`           | fails - `Member "shl" not found`                      |

**Prevention**: Before writing any shift/rotate call, grep FHE.sol for the exact function
signature. The shift amount parameter type is an exception to the "scalar matches bit width" rule.

## New SDK (`@zama-fhe/sdk@^3` and `@zama-fhe/react-sdk@^3`) Mistakes

These mistakes apply to projects on the new high-level SDK family
(`@zama-fhe/sdk@^3.0.0`, `@zama-fhe/react-sdk@^3.0.0`). The legacy
`@zama-fhe/relayer-sdk@0.4.x` mistakes #15-#19c above still apply when the
new SDK falls through to its primitive layer. Full reference content lives
in `references/zama-sdk-overview.md` and the other `zama-sdk-*.md` files.

### 33. Wrong relayer for the runtime `DEFINITE BUG`
```ts
/* WRONG - RelayerWeb in Node has no Web Worker / WASM environment. Throws at construction. */
import { RelayerWeb } from "@zama-fhe/sdk";
const relayer = new RelayerWeb({ /* ... */ }); /* in a Node script */

/* WRONG - RelayerNode in browser has no `worker_threads`. Throws at construction. */
import { RelayerNode } from "@zama-fhe/sdk/node";
/* imported into a browser bundle */

/* CORRECT - browser */
import { RelayerWeb } from "@zama-fhe/sdk";

/* CORRECT - Node.js */
import { RelayerNode } from "@zama-fhe/sdk/node";

/* CORRECT - local Hardhat dev (cleartext mode) */
import { RelayerCleartext, hardhatCleartextConfig } from "@zama-fhe/sdk/cleartext";
```

**Why this matters**: `@zama-fhe/sdk/node` exists as a separate sub-path
specifically to keep browser-only code out of server bundles and vice
versa. Importing the wrong one ships a binary that crashes on first use.
`RelayerCleartext` is blocked at construction on chain 1 (Mainnet) and
chain 11155111 (Sepolia) - cleartext mode is dev-only.

### 34. API key embedded in browser bundle `DEFINITE BUG`
```ts
/* WRONG - exposes the key to any user inspecting network or bundle */
const relayer = new RelayerWeb({
    transports: {
        [SepoliaConfig.chainId]: {
            ...SepoliaConfig,
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
            auth: { __type: "ApiKeyHeader", value: "sk_live_REAL_KEY" }, /* leak */
        },
    },
    /* ... */
});

/* WRONG - "import.meta.env.VITE_RELAYER_KEY" / "process.env.NEXT_PUBLIC_RELAYER_KEY"
   are exposed in the browser bundle. Same leak. */

/* CORRECT - browser apps proxy through their backend; client passes NO auth */
const relayer = new RelayerWeb({
    transports: {
        [SepoliaConfig.chainId]: {
            ...SepoliaConfig,
            relayerUrl: "https://your-app.com/api/relayer/11155111", /* your proxy */
            network: "https://sepolia.infura.io/v3/YOUR_KEY",
        },
    },
});
```

**Why this matters**: Sponsored transactions on the Zama-hosted relayer
are billed monthly. A leaked key is a financial liability. The proxy
adds the `x-api-key` header server-side. Three auth shapes are accepted
by the SDK (`ApiKeyHeader`, `ApiKeyCookie`, `BearerToken`) - all are for
TRUSTED environments only. Full proxy contract in
`zama-sdk-auth-storage.md` (forward `zama-sdk-version` /
`zama-sdk-name` headers, strip `content-encoding` from upstream
responses).

### 35. Custom `GenericStorage` using DOM names `DEFINITE BUG`
```ts
/* WRONG - the GenericStorage interface is NOT the DOM Storage shape */
const myStorage: GenericStorage = {
    getItem: (key) => /* ... */,
    setItem: (key, value) => /* ... */,
    removeItem: (key) => /* ... */,
};
/* TypeScript may not catch this depending on inference; runtime calls fail. */

/* CORRECT - get / set / delete; all async */
const myStorage: GenericStorage = {
    async get<T>(key: string): Promise<T | null> { /* ... */ },
    async set<T>(key: string, value: T): Promise<void> { /* ... */ },
    async delete(key: string): Promise<void> { /* ... */ },
};
```

**Why this matters**: `GenericStorage` was designed against an async
key-value model, not the synchronous DOM `Storage` interface. Using the
DOM names produces a storage that the SDK silently ignores (cache misses
all the way through).

### 36. `keypairTTL = 0` or `> 365` days `DEFINITE BUG` / `LIKELY ISSUE`
```ts
/* WRONG - rejected at construction; the keypair is required for the relayer connection */
new ZamaSDK({ /* ... */, keypairTTL: 0 });

/* LIKELY ISSUE - clamped to 365 days with a console warning */
new ZamaSDK({ /* ... */, keypairTTL: 86_400 * 400 }); /* > 365 days */

/* CORRECT - any positive number up to 31_536_000 (365 days). Default 30 days. */
new ZamaSDK({ /* ... */, keypairTTL: 604_800 }); /* 7 days */
```

**Why this matters**: The FHEVM ACL contract rejects
`durationDays > 365`. The SDK silently clamps to 365 days but logs a
console warning. `0` is rejected outright - there is no defensible
meaning for a zero keypair TTL.

`sessionTTL` accepts a different range: a positive number, `0` (sign
every operation), or the string `"infinite"`. `0` here is intentional
high-security mode, NOT an error.

### 37. Resumable unshield without `savePendingUnshield` `LIKELY ISSUE`
```ts
/* WRONG - if the user closes the page after unwrap but before finalize,
   the unwrap is on-chain but the tokens are stuck. The SDK does NOT
   automatically persist the unwrap tx hash. */
await token.unshield(500n, {
    onUnwrapSubmitted: (txHash) => updateUI("Unwrap submitted..."),
    /* no savePendingUnshield call - lost on navigation */
});

/* CORRECT - persist the unwrap tx hash inside onUnwrapSubmitted, clear on completion */
import { savePendingUnshield, clearPendingUnshield } from "@zama-fhe/sdk";

await token.unshield(500n, {
    onUnwrapSubmitted: async (txHash) => {
        await savePendingUnshield(storage, wrapperAddress, txHash);
    },
    onFinalizeSubmitted: async () => {
        await clearPendingUnshield(storage, wrapperAddress);
    },
});

/* On next page load: */
const pending = await loadPendingUnshield(storage, wrapperAddress);
if (pending) {
    await token.resumeUnshield(pending);
    await clearPendingUnshield(storage, wrapperAddress);
}
```

**Why this matters**: Unshield is a two-phase on-chain flow with a
decryption-proof wait between phases. Browser navigation in the wait
window strands the unwrap. Persisting the tx hash is the only way to
recover.

### 38. `useUserDecrypt` without `enabled: !!isAllowed` gate `LIKELY ISSUE`
```tsx
/* WRONG - the query fires on first render before credentials are cached,
   triggering a wallet popup every render until accepted. */
const { data } = useUserDecrypt({
    handles: [{ handle, contractAddress }],
});

/* CORRECT - sign once via useAllow, gate the decrypt query on the cached creds */
const { mutate: allow } = useAllow();
const { data: isAllowed } = useIsAllowed({ contractAddresses: [contractAddress] });
const { data } = useUserDecrypt(
    { handles: [{ handle, contractAddress }] },
    { enabled: !!isAllowed },
);

/* In the UI: */
{!isAllowed && <button onClick={() => allow([contractAddress])}>Authorize</button>}
```

**Why this matters**: Without the `enabled` guard, every component that
uses `useUserDecrypt` independently re-prompts. The `useAllow` ->
`useIsAllowed` -> `enabled` pattern signs once at app start and lets
every nested hook decrypt silently.

### 39. `RelayerCleartext` against Mainnet or Sepolia `DEFINITE BUG`
```ts
/* WRONG - RelayerCleartext blocks chain 1 and chain 11155111 at construction. */
import { RelayerCleartext } from "@zama-fhe/sdk/cleartext";
new RelayerCleartext({ chainId: 1, /* ... */ }); /* throws */
new RelayerCleartext({ chainId: 11155111, /* ... */ }); /* throws */

/* CORRECT - dev only: Hardhat (31337) or Hoodi (560048) */
import { RelayerCleartext, hardhatCleartextConfig, hoodiCleartextConfig }
    from "@zama-fhe/sdk/cleartext";
const relayer = new RelayerCleartext(hardhatCleartextConfig);
```

**Why this matters**: Cleartext mode operates without FHE / KMS / gateway -
values are stored in plaintext. Allowing it on real networks would be a
privacy violation. The SDK blocks it in the constructor.
`RelayerCleartext.requestZKProofVerification(...)` also throws -
ZK proofs are not implemented in cleartext mode.

### 40. Web extension without `chromeSessionStorage` `LIKELY ISSUE`
```ts
/* WRONG - MV3 service worker can be terminated after ~30s of inactivity.
   Default in-memory session storage is wiped, forcing the user to re-sign
   on every interaction. */
const sdk = new ZamaSDK({
    relayer,
    signer,
    storage: indexedDBStorage,
    /* sessionStorage defaults to in-memory - LOST on SW restart */
});

/* CORRECT - persistent encrypted keypair (IndexedDB) + ephemeral but SW-restart-resistant
   session signature (chrome.storage.session) */
import { chromeSessionStorage } from "@zama-fhe/sdk";

const sdk = new ZamaSDK({
    relayer,
    signer,
    storage: indexedDBStorage,
    sessionStorage: chromeSessionStorage,
});

/* manifest.json must include the "storage" permission */
```

**Why this matters**: `chrome.storage.session` is shared across popup,
background, and content script contexts. The user signs once in the
popup and any of those contexts can decrypt afterward. Browser close
clears `chrome.storage.session` but keeps `indexedDB`, matching the
expected security model.

### 41. Auto-retry on `SigningRejectedError` `LIKELY ISSUE`
```tsx
/* WRONG - the SDK never silently retries; neither should the app. */
try {
    await token.balanceOf();
} catch (err) {
    if (err instanceof SigningRejectedError) {
        await token.balanceOf(); /* don't do this - infinite popup loop */
    }
}

/* CORRECT - re-prompt only on a fresh user gesture */
const [needsAuth, setNeedsAuth] = useState(false);
try {
    await token.balanceOf();
} catch (err) {
    if (err instanceof SigningRejectedError) {
        setNeedsAuth(true);
    }
}
return needsAuth ? <button onClick={retry}>Approve to decrypt</button> : ...;
```

**Why this matters**: `SigningRejectedError` means the user explicitly
clicked Reject. Auto-retrying creates an infinite popup loop and breaks
the user's ability to cancel. This guarantee is also documented for
delegation flows (`SigningRejectedError` is always propagated).

### 42. Treating `NoCiphertextError` as a real error `LIKELY ISSUE`
```tsx
/* WRONG - showing "Error: no ciphertext" or "Balance: 0" both mislead the user. */
try {
    const balance = await token.balanceOf();
    showBalance(balance);
} catch (err) {
    showError(err.message); /* "no ciphertext" is opaque to a user */
}

/* CORRECT - branch the UI to an empty state */
import { NoCiphertextError } from "@zama-fhe/sdk";

try {
    const balance = await token.balanceOf();
    showBalance(balance); /* could legitimately be 0n */
} catch (err) {
    if (err instanceof NoCiphertextError) {
        showEmptyState("Shield tokens to get started");
    } else {
        showError(err.message);
    }
}
```

**Why this matters**: `NoCiphertextError` means the account has never
shielded; there is no encrypted balance to decrypt. A balance of `0n`
means the account has shielded before but holds zero now. These are
distinct UI states - showing "0" when the user has never shielded
implies they had funds and lost them.

### 43. Decrypting as a delegate immediately after delegation `LIKELY ISSUE`
```ts
/* WRONG - the gateway has not synced the L1 ACL state yet. */
await token.delegateDecryption({ delegateAddress: "0xDelegate" });
const balance = await readonlyToken.decryptBalanceAs({
    delegatorAddress: "0xDelegator",
});
/* throws DelegationNotPropagatedError */

/* CORRECT - wait 1-2 minutes for cross-chain sync, then retry */
await token.delegateDecryption({ delegateAddress: "0xDelegate" });
await new Promise(resolve => setTimeout(resolve, 90_000));
const balance = await readonlyToken.decryptBalanceAs({
    delegatorAddress: "0xDelegator",
});
```

**Why this matters**: Delegations are recorded on L1 immediately, but
the gateway lives on Arbitrum and learns about them via cross-chain
event propagation. Cross-chain sync takes 1-2 minutes. Production code
should retry with exponential backoff on
`DelegationNotPropagatedError`, not block the UI for 90 seconds.

Same-block delegate / revoke on the same `(delegator, delegate, contract)`
tuple reverts with `AlreadyDelegatedOrRevokedInSameBlock` (mapped to
`DelegationCooldownError`) - wait one block before retrying.

### 44. Using `useConfidentialApprove` as a public-allowance grant `LIKELY ISSUE`
```ts
/* WRONG - useConfidentialApprove sets the ERC-7984 OPERATOR role, not an ERC-20 allowance.
   Operators can call confidentialTransferFrom; they cannot trigger an ERC-20 approve. */
const { mutateAsync: approve } = useConfidentialApprove({ tokenAddress });
await approve({ spender: aaveAddress }); /* will not authorize Aave to pull underlying */

/* CORRECT - to set the underlying ERC-20 allowance, use the wrapper's approveUnderlying */
await token.approveUnderlying(); /* max approval to the wrapper */
/* OR use approvalStrategy: "max" the first time you shield */
await token.shield(amount, { approvalStrategy: "max" });

/* And to read the current ERC-20 allowance: */
const { data: allowance } = useUnderlyingAllowance({
    tokenAddress,
    owner: userAddress,
    wrapperAddress,
});
```

**Why this matters**: Operator approvals (ERC-7984) are time-bounded
(default 1 hour) and grant the right to call
`confidentialTransferFrom`. ERC-20 allowances (the underlying token) are
separate; the wrapper needs its own ERC-20 allowance to pull tokens
during shield. Conflating them produces silent-failure shields.

Operator approval for transfer and operator approval for unshield are
also separate scopes - approving for one does NOT auto-grant the other.

### 45. Constructing `RelayerWeb` / `ZamaProvider` at server module level (Next.js) `DEFINITE BUG`
```ts
/* WRONG - runs during SSR, crashes (Web Worker not defined) */
/* lib/sdk.ts - imported by both server and client code */
import { RelayerWeb } from "@zama-fhe/sdk";
export const relayer = new RelayerWeb({ /* ... */ });

/* CORRECT - keep SDK construction in a "use client" component */
/* app/providers.tsx */
"use client";
import { RelayerWeb, ZamaProvider } from "@zama-fhe/react-sdk";
export function Providers({ children }) {
    const relayer = new RelayerWeb({ /* ... */ });
    return <ZamaProvider relayer={relayer} ...>{children}</ZamaProvider>;
}

/* OR gate behind a dynamic import for non-component modules */
export async function getRelayer() {
    const { RelayerWeb } = await import("@zama-fhe/sdk");
    return new RelayerWeb({ /* ... */ });
}
```

**Why this matters**: Next.js App Router renders pages on the server by
default. Anything imported by a Server Component runs in Node, where
`Worker`, `IndexedDB`, and the FHE WASM are unavailable. The
`"use client"` directive marks a module boundary that the bundler
respects.
