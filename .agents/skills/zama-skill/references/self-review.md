# Mandatory Self-Review Checklists

**Do not deliver code until every checklist below passes for the files you touched.**

For each item: if PASS, mark with line-number evidence. If FAIL, fix and re-verify ALL items (not just the failed one). If UNSURE, grep or read installed source - never mark without checking.

## Contents

- Code Style Checklist (all files)
- Solidity Checklist
- Frontend Checklist
- Hardhat Test Checklist
- Post-Delivery Grep (final gate, zero matches required)

---

## Code Style Checklist (ALL files: Solidity, TS, JS, Python, etc.)

- [ ] Zero `//` or `///` in the file (WHY: project rule, only `/* */` and `/** */` are allowed in C-family)
- [ ] Zero em dashes (U+2014) and en dashes (U+2013) anywhere (WHY: project rule, always use hyphen / colon / parens)
- [ ] File opens with `@file` + `@description` header, JSDoc (C-family) or `#####` box / module docstring (hash-comment) (WHY: required for docgen and grep)
- [ ] Section dividers are asterisk-box `/*************** Name ***************/` (WHY: preferred project style, scannable in long contracts)
- [ ] **Solidity only** - every public / external function has a NatSpec block with `@notice`, `@dev`, `@param`, `@return` where applicable (WHY: required for docgen and review)
- [ ] **Solidity only** - contract-level NatSpec has `@title`, `@notice`, `@dev`, and `@custom:security-contact` (WHY: OpenZeppelin / ethereum-lists convention)
- [ ] **Solidity only** - implementations of interface functions use `@inheritdoc ParentName` instead of duplicating `@notice` (WHY: single source of truth, matches Uniswap / OZ)
- [ ] **TS / JS only** - exported functions / classes / hooks have a JSDoc block with leading description and `@param` / `@returns` / `@throws`. Never `@notice`, `@dev`, `@inheritdoc`, `@custom:*` (WHY: those are NatSpec tags, not valid JSDoc / TSDoc)
- [ ] Inline comments explain WHY (hidden FHE constraint, ACL lifecycle, handle order), not WHAT (WHY: noise dilutes the real constraints)

## Solidity Checklist

- [ ] Pragma is `^0.8.28` (default), `^0.8.27`+ if importing `@openzeppelin/confidential-contracts`, or `^0.8.24` minimum when a lower pragma is explicitly required (WHY: 0.8.24 is the FHEVM minimum, 0.8.28 matches the reference template, OZ confidential `ERC7984.sol` itself declares `^0.8.27`)
- [ ] Config `ZamaEthereumConfig` not `SepoliaConfig` (WHY: SepoliaConfig removed in v0.9)
- [ ] Imports from `@fhevm/solidity/lib/FHE.sol` (WHY: only valid import path)
- [ ] External inputs use `externalEuintXX` + `bytes calldata inputProof` (WHY: required for ZK proof)
- [ ] Inputs converted with `FHE.fromExternal()` not `FHE.asEuintXX()` (WHY: asEuint converts Solidity literals/variables like `42` to encrypted; external user inputs require fromExternal + inputProof)
- [ ] No `require()`/`if`/`assert` on encrypted values (WHY: `ebool` is a `bytes32` UDVT - direct use is a Solidity compile error; if dev unwraps the handle to a primitive, the check always passes because the handle is non-zero)
- [ ] If logic depends on an encrypted condition: encrypted error-code register (`euint8 NO_ERROR`, `LastError` mapping, `FHE.select` to set, `FHE.allow(errorCode, user)`) (WHY: only way to surface a logical failure when you cannot revert; see `inputs-decryption.md` Part 4)
- [ ] `FHE.asEuintXX(literal)` only used for non-secret values (counters of 0, sentinels, public scalars) (WHY: trivial encryption keeps the input plaintext on-chain; private user input must come through `FHE.fromExternal(extHandle, proof)`)
- [ ] Reorg-sensitive ACL grants are timelocked: `require(block.number > triggerBlock + 95)` between the action and the matching `FHE.allow(handle, user)` call (WHY: ACL events fire on inclusion not finality; mainnet reorg can drop up to 95 slots, leaking decrypted handles permanently. Apply only when the leaked information is high-value; see `acl.md` Reorg Handling)
- [ ] Project uses Hardhat, not Foundry (WHY: `forge test` cannot run the FHEVM coprocessor; `fhevm/mocks/FHE.sol` shim is smoke-only and "may pass locally but fail on a live network" per Zama docs. Use `@fhevm/hardhat-plugin@^0.4.2` toolchain)
- [ ] `FHE.allowThis()` after every stored encrypted computation (WHY: contract loses access next tx)
- [ ] `FHE.allow(result, user)` for user-readable values (WHY: user cannot decrypt without ACL)
- [ ] Comparison names: `ne` not `neq`, `le` not `lte`, `ge` not `gte` (WHY: wrong names don't exist)
- [ ] Library `FHE.xxx()` not `TFHE.xxx()` (WHY: TFHE is the Rust lib, FHE is the Solidity API)
- [ ] No `requestDecryption`, `GatewayCaller`, `FHE.allowForDecryption` (WHY: requestDecryption / GatewayCaller removed in v0.9; `FHE.allowForDecryption` never existed as a library helper - use `FHE.makePubliclyDecryptable`)
- [ ] Public decrypt: makePubliclyDecryptable to publicDecrypt to checkSignatures (WHY: v0.9 3-step flow)
- [ ] `checkSignatures(bytes32[], bytes, bytes)` not `(uint256, bytes, bytes[])` (WHY: v0.9 signature)
- [ ] Handle order in checkSignatures matches publicDecrypt order (WHY: cryptographically binding)
- [ ] No signed `eint` types used (WHY: declared in `encrypted-types/EncryptedTypes.sol` so a bare `eint64 x;` compiles, but `@fhevm/solidity@0.11.1` ships zero `FHE.*` overloads, so any operation fails with `Member "<op>" not found ... after argument-dependent lookup`)
- [ ] Shift/rotate amounts use `uint8` (plaintext) or `euint8` (encrypted) - never the wider encrypted type (WHY: `FHE.shl(euint64, uint8)` and `FHE.shl(euint64, euint8)` both compile; `FHE.shl(euint64, euint64)` fails with `Member "shl" not found`. Verified on @fhevm/solidity@0.11.1)
- [ ] `FHE.div` / `FHE.rem` have plaintext zero guard (WHY: only the `(euint*, uintN)` plaintext-divisor overload exists; `FHE.div(x, 0)` reverts at runtime with the custom error `DivisionByZero()` from `@fhevm/host-contracts/contracts/FHEVMExecutor.sol:40`)
- [ ] `FHE.randEuintX(bound)` has power-of-2 guard on `bound` (WHY: non-power-of-2 causes `revert NotPowerOfTwo()` at runtime)

## Frontend Checklist

**SDK Integration (must be present - not placeholder bytes):**

- [ ] `createInstance({ ...SepoliaConfig, network: window.ethereum })` called and instance stored (WHY: all encryption/decryption requires an instance)
- [ ] Every contract function that takes `externalEuintXX + inputProof` uses `createEncryptedInput` to `addXX` to `encrypt()` to produce real encrypted handles (WHY: placeholder zero bytes will always revert on-chain - the ZK proof verification fails)
- [ ] `encrypted.handles[N]` passed as the externalEuintXX arg, `encrypted.inputProof` passed as the proof arg (WHY: handles and proof come from the same encrypt() call - mixing them fails proof verification)
- [ ] Handle order matches `addXX()` call order: first `addXX()` to `handles[0]`, second to `handles[1]`, etc. (WHY: wrong order corrupts decryption)
- [ ] For public decrypt: `results.clearValues[handle]` not `results.values[handle]` (WHY: actual type uses clearValues)
- [ ] For user decrypt: `userResults[handle]` directly, NOT `userResults.clearValues[handle]` (WHY: userDecrypt returns bare Record, no wrapper)

**Imports & Config:**

- [ ] Import uses sub-path `/web`, `/bundle`, or `/node` (WHY: bare import fails, no main export)
- [ ] Init is `initSDK()` not `initFhevm()` (WHY: initFhevm does not exist)
- [ ] `SepoliaConfig` spread from `@zama-fhe/relayer-sdk/web`, not from `@fhevm/solidity` (WHY: naming collision - Solidity SepoliaConfig was removed in v0.9)

**Headers & Environment:**

- [ ] COOP/COEP headers configured (WHY: WASM SharedArrayBuffer requires them)
- [ ] If using RainbowKit/WalletConnect: COEP is `credentialless` not `require-corp` (WHY: `require-corp` blocks wallet connector external resources - iframes, images)
- [ ] If using Vite: `@zama-fhe/relayer-sdk` excluded from `optimizeDeps` + `worker.format: "es"` (WHY: Vite pre-bundler breaks `new URL('*.wasm', import.meta.url)` in the SDK, causing the "expected magic word 00 61 73 6d" WASM load failure)

**Wallet Connector (browser dApp):**

- [ ] Wallet kit chosen and providers wrapped in correct order: `WagmiProvider` -> `QueryClientProvider` -> `RainbowKitProvider` (WHY: RainbowKit reads from both wagmi and TanStack Query contexts; reverse order errors at first hook call)
- [ ] `@rainbow-me/rainbowkit/styles.css` imported once at the app entry (WHY: connect-modal renders unstyled without it)
- [ ] WalletConnect Cloud project ID provided via env (`VITE_WALLETCONNECT_PROJECT_ID` / `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`); frontend warns at startup when missing rather than throwing (WHY: silent no-op of WalletConnect connector confuses users; injected-only fallback should still work)
- [ ] wagmi mainnet / sepolia transports overridden with CORS-friendly RPCs - NOT the wagmi default `https://eth.merkle.io` (WHY: default transport blocks browser CORS preflight; `readContract` / `getBalance` calls fail silently in production)
- [ ] On Next.js: file containing `wagmiConfig` and the `<Providers>` tree starts with `"use client"` (WHY: wagmi persistent storage opens IndexedDB at module load, crashes SSR prerender)
- [ ] `wagmi` and `@tanstack/react-query` are deduped to a single tree shared with `@zama-fhe/react-sdk` (if installed) (WHY: two wagmi instances = two account contexts; signer reads from one, UI reads from the other, decrypt requests go to the wrong address)

## Hardhat Test Checklist

- [ ] `userDecryptEuint` uses `FhevmType` param (WHY: needs to know euint bit width)
- [ ] `userDecryptEbool` has NO `FhevmType` param (WHY: different function signature)
- [ ] `userDecryptEaddress` has NO `FhevmType` param (WHY: different function signature)
- [ ] Custom tasks call `fhevm.initializeCLIApi()` (WHY: tasks don't auto-initialize)

## Post-Delivery Grep (final gate, zero matches required)

```
Solidity: requestDecryption|SepoliaConfig|GatewayCaller|TFHE\.|FHE\.allowForDecryption\(|FHE\.neq\(|FHE\.lte\(|FHE\.gte\(|verifySignatures|zama\.cloud|FHE\.randBounded\(
Frontend: from '@zama-fhe/relayer-sdk'[^/]|initFhevm|@fhevm/sdk|fhevmjs|results\.values\[|zama\.cloud
Hardhat:  userDecryptEbool\(FhevmType|userDecryptEaddress\(FhevmType|fhevmjs
Style:    ^\s*//[^\*]|^\s*///|[\x{2013}\x{2014}\x{1F680}\x{26A0}]
```

The Style grep catches `//` and `///` line comments in C-family files (banned, use `/* */`), en/em dashes (banned, use `-`), and the project's banned emojis (rocket U+1F680, warning U+26A0). Asterisk-box section dividers `/*************** Name ***************/` are NOT grepped; they are the preferred project style. Any style hit equals fix before delivering.
