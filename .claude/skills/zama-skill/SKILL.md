---
name: zama-skill
description: Builds, reviews, audits, tests, and deploys Zama FHEVM v0.11 confidential smart contracts and dApp frontends, on the new @zama-fhe/sdk@^3 / @zama-fhe/react-sdk@^3 (Token API, 59 hooks) or legacy @zama-fhe/relayer-sdk@^0.4 (primitives). Use when files import @fhevm/solidity, @fhevm/hardhat-plugin, @zama-fhe/relayer-sdk, @zama-fhe/sdk, @zama-fhe/react-sdk, or @openzeppelin/confidential-contracts; declare euint*, ebool, eaddress, externalEuint*; inherit ZamaEthereumConfig; or use ZamaSDK, RelayerWeb, RelayerNode, RelayerCleartext, ViemSigner, EthersSigner, WagmiSigner, Token, WrappersRegistry, useShield, useUnshield, useConfidentialBalance, useAllow, useUserDecrypt. Triggers also on FHEVM, Zama, TFHE, ERC-7984, shield/unshield, confidential transfers, ACL/KMS/HCU custom errors, or new-SDK errors (SigningRejectedError, NoCiphertextError, InsufficientConfidentialBalanceError, DelegationNotPropagatedError). Skip plain ERC20/721 with no FHE imports.
license: MIT
metadata:
  version: "1.0.0"
allowed-tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Task
  - ToolSearch
  - Bash(npx hardhat *)
  - Bash(npm install *)
  - Bash(npm test *)
  - Bash(grep *)
  - Bash(find *)
  - Bash(cat *)
  - Bash(mktemp *)
  - Bash(curl *)
  - Bash(wc *)
---

# FHEVM Development Skill (v0.11)

Reference material ships alongside this `SKILL.md` in `references/`, `templates/`, and `review-modules/`. For API reference and type details, cross-check against the installed source in `node_modules/@fhevm/solidity/` and `node_modules/@zama-fhe/relayer-sdk/` - never trust docs or training knowledge alone.

This skill targets `@fhevm/solidity@0.11.1` (Solidity Guides v0.11 on https://docs.zama.org/protocol/solidity-guides/). Generated code, templates, anti-patterns, and lint rules all assume v0.11. The skill also flags pre-v0.11 patterns surfaced from older codebases or out-of-date copilots (`TFHE.*`, `FHE.requestDecryption`, `SepoliaConfig` as Solidity base, `FHE.neq` / `lte` / `gte`, `fhevmjs`, `@fhevm/sdk`) so you can migrate them. v0.10 was a brief transitional release; treat any v0.10-specific advice in older docs as superseded by v0.11.

## Architecture

FHEVM uses symbolic execution. Contracts operate on `bytes32` handles, not on ciphertexts. A coprocessor performs the FHE computation off-chain. Encrypted values cannot be branched on - `require(ebool)` and `if (ebool)` are Solidity compile errors because `ebool` is a `bytes32` UDVT.

### Required Setup

```solidity
pragma solidity ^0.8.28;
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
contract MyContract is ZamaEthereumConfig { }
```

## Pragma Policy

| Case | Pragma |
|---|---|
| Default for new contracts | `^0.8.28` (matches reference template, `hardhat.config.ts` uses `version: "0.8.28"`) |
| Importing `@openzeppelin/confidential-contracts` (ERC-7984) | `^0.8.27` minimum (ERC7984.sol declares `^0.8.27`) |
| Absolute minimum for FHEVM | `^0.8.24` (only use if a dependency pins lower) |

EVM target: `"cancun"`. Do not target a lower EVM version.

## Dependencies

| Package | npm Name |
|---------|----------|
| Solidity lib | `@fhevm/solidity` (^0.11.1) |
| Hardhat plugin | `@fhevm/hardhat-plugin` (^0.4.2) |
| Mock utils | `@fhevm/mock-utils` (^0.4.2) |
| Legacy primitive SDK | `@zama-fhe/relayer-sdk` (`0.4.1` exact, no caret. Latest published is `0.4.3` (2026-05-06) but `@fhevm/mock-utils@0.4.2` peers `0.4.1` exact and `@fhevm/hardhat-plugin` runtime-aborts on any other version. Still required as a transitive install even on the new SDK) |
| New high-level SDK | `@zama-fhe/sdk` (^3.0.0) - `ZamaSDK`, `Token`, sessions, storage. Engines `node >= 22`. Optional - use only for confidential ERC-7984 dApps |
| New React hooks | `@zama-fhe/react-sdk` (^3.0.0) - TanStack-Query hooks + `ZamaProvider`. Optional - React frontends only |
| Hardhat ethers | `@nomicfoundation/hardhat-ethers` (^3.1.3) - bridges Hardhat 2 to ethers v6. Pin v3 line; v4 requires Hardhat 3 |
| Hardhat-2 helpers | `@nomicfoundation/hardhat-network-helpers` (^1.1.2 - opt-in; only if tests use `time.increase` / `mine` / `loadFixture` / snapshots; v3 line requires Hardhat 3) |
| Chai matchers | `@nomicfoundation/hardhat-chai-matchers` (^2.1.2) |
| OZ Confidential | `@openzeppelin/confidential-contracts` (^0.4.0) |

## Common install failure: `Invalid @zama-fhe/relayer-sdk version`

Triggered when `@zama-fhe/sdk@3.0.0` (new SDK) and the Hardhat toolchain are installed in the same `package.json`. The new SDK depends on `@zama-fhe/relayer-sdk: ~0.4.2`; both `@fhevm/hardhat-plugin@0.4.2` and `@fhevm/mock-utils@0.4.2` peer-pin `0.4.1` exact. The constraint is unsatisfiable. If npm hoists `0.4.2` or `0.4.3`, you see this on the first `npx hardhat test` or `npx hardhat compile`:

```
Error in plugin @fhevm/hardhat-plugin: Invalid @zama-fhe/relayer-sdk version. Expecting 0.4.1. Got 0.4.2 instead.
```

**Two safe fixes** (verified: `0.4.1`, `0.4.2`, `0.4.3` ship identical transitive deps, so forcing `0.4.1` does not break the new SDK at runtime):

1. **`overrides` in the consumer `package.json` (single-package projects)**:
   ```json
   {
     "overrides": {
       "@zama-fhe/relayer-sdk": "0.4.1"
     }
   }
   ```
   Then `rm -rf node_modules package-lock.json && npm install`.

2. **Workspace split (recommended for monorepos)**: keep the Hardhat package and the dApp / Node frontend in separate workspaces with separate `node_modules`. The toolchain workspace pins `0.4.1` exact; the frontend workspace lets `@zama-fhe/sdk` install whatever it wants.

Latest published `@zama-fhe/relayer-sdk` is `0.4.3` (2026-05-06); the `0.4.1` exact pin is a Zama toolchain quirk, not a stale recommendation.

---

## Loading Protocol

**Tier 1 - ALWAYS load at the start of every FHEVM task** (before writing,
reviewing, auditing, testing, deploying, or integrating):
- This SKILL.md (core rules, verification protocol, checklist)
- `references/anti-patterns.md` - verified mistakes agents repeat in FHEVM code; loaded by default so you know what NOT to do before your first line of output.
- `references/code-style.md` - comment syntax, file headers, section
  dividers, NatSpec vs JSDoc tag tables, banned Unicode characters.

**Tier 2 - Load based on task**:
- Writing a new contract -> `templates/` + `references/types-operations.md`
- Quick review -> `references/finding-validation.md` + `references/report-format.md`
- Deploying -> `references/deployment.md` + `references/environment.md`
- FHE security audit -> `references/fhe-vulnerabilities.md` + `references/solidity-vulnerabilities.md` + `references/finding-validation.md` + `references/report-format.md` + all files in `review-modules/`
- Writing tests -> `references/testing.md`
- Frontend / dApp integration (legacy `@zama-fhe/relayer-sdk` primitives or general WASM / COOP / COEP / Vite / Next.js setup) -> `references/frontend.md`
- Token / ERC-7984 (Solidity layer) -> `templates/ConfidentialERC20.sol` + `references/erc7984.md`
- ACL questions -> `references/acl.md`
- Decryption flows (legacy primitives) -> `references/inputs-decryption.md`
- New SDK overview / package map / `ZamaSDK` constructor -> `references/zama-sdk-overview.md`
- New SDK auth + relayer transports + signers + storage + web extensions -> `references/zama-sdk-auth-storage.md`
- New SDK shield / unshield / confidentialTransfer / balanceOf / `Token` / `ReadonlyToken` -> `references/zama-sdk-tokens.md`
- New SDK session model + delegation + TTLs + decrypt cache -> `references/zama-sdk-session.md`
- New SDK React hooks (59 hooks, `ZamaProvider`, Next.js SSR, Vite, `zamaQueryKeys`) -> `references/zama-sdk-react.md`
- New SDK error taxonomy + `matchZamaError` patterns -> `references/zama-sdk-errors.md`
- New SDK activity feeds + event decoders + `WrappersRegistry` + contract builders + operator approvals + FHE artifact cache -> `references/zama-sdk-activity.md`

---

## Encrypt + Decrypt Quick Reference

Every confidential dApp uses the seven flows below. Match the runtime + use case to the right reference. All signatures verified against `node_modules/@zama-fhe/sdk/dist/*` (v3.0.0), `node_modules/@zama-fhe/react-sdk/dist/*` (v3.0.0), and the official guide https://docs.zama.org/protocol/sdk/guides/encrypt-decrypt.md.

### 1. Encrypt a user input (browser, new SDK, React)

```ts
/* "use client" required in Next.js. SharedArrayBuffer needs COOP same-origin + COEP require-corp. */
import { useEncrypt } from "@zama-fhe/react-sdk";
const { mutateAsync: encrypt } = useEncrypt();
const { handles, inputProof } = await encrypt({
  values: [{ value: 1000n, type: "euint64" }],
  contractAddress: contract.address,
  userAddress: user.address,
});
/* Pass to the contract: handles[0] -> externalEuint64 arg, inputProof -> bytes calldata. */
await contract.deposit(toHex(handles[0]), toHex(inputProof));
```

Detail + multi-value batching: `references/zama-sdk-react.md` (`useEncrypt`) and `references/zama-sdk-tokens.md`.

### 2. Encrypt a user input (Hardhat test)

```ts
import { fhevm } from "hardhat";
const input = fhevm.createEncryptedInput(contract.address, signer.address);
input.add64(1000n);
const enc = await input.encrypt();
await contract.connect(signer).deposit(enc.handles[0], enc.inputProof);
```

Detail: `references/testing.md` and `references/inputs-decryption.md`. Tests auto-init; custom Hardhat tasks must call `await fhevm.initializeCLIApi()` first.

### 3. Decrypt a confidential token balance (the most common dApp call)

```ts
/* Vanilla TS (Node.js or browser). One EIP-712 prompt the first time. Subsequent calls silent. */
const balance = await token.balanceOf();              /* returns bigint, NOT a wrapper */
const handle  = await token.confidentialBalanceOf();  /* returns the bytes32 handle (Hex) */
```

```tsx
/* React. TanStack-Query under the hood. Auto re-fetches on transfer / shield / unshield. */
import { useConfidentialBalance, useConfidentialBalances } from "@zama-fhe/react-sdk";
const { data: balance, isLoading } = useConfidentialBalance(
  { tokenAddress: cUSDT },
  { refetchInterval: 5_000 },
);
const { data } = useConfidentialBalances({ tokenAddresses: [cUSDC, cUSDT, cWETH] });
```

Pre-authorize multiple tokens to skip prompts: `await ReadonlyToken.allow(tokenA, tokenB);` (static, not instance). Empty-account vs zero-balance: `NoCiphertextError` = "never shielded" (show empty state); `0n` = "shielded but zero". Detail: `references/zama-sdk-tokens.md` ("Balances and the FHE credential session") + `references/zama-sdk-errors.md`.

### 4. Decrypt arbitrary handles from a custom contract (user decrypt)

```ts
/* New SDK: pre-authorize a contract set once, then decrypt any handle from it silently. */
await sdk.allow([contract.address]);
const values = await sdk.userDecrypt([{ handle, contractAddress: contract.address }]);
const cleartext = values[handle];                     /* bare Record, NOT .clearValues */
```

```tsx
import { useAllow, useIsAllowed, useUserDecrypt } from "@zama-fhe/react-sdk";
const { mutateAsync: allow } = useAllow();
const { data: isAllowed } = useIsAllowed({ contractAddress });
const { mutateAsync: userDecrypt } = useUserDecrypt();
if (!isAllowed) await allow({ contractAddresses: [contractAddress] });
const values = await userDecrypt({ handles: [{ handle, contractAddress }] });
```

Legacy primitive path (raw `@zama-fhe/relayer-sdk`, no session layer): `references/inputs-decryption.md` ("User Decryption (EIP-712)") and `references/frontend.md`.

### 5. Public decryption (3-step bound flow)

On-chain step 1: `FHE.makePubliclyDecryptable(handle)`.
Off-chain step 2 (browser/Node):
```ts
import { usePublicDecrypt } from "@zama-fhe/react-sdk";  /* React */
const { mutateAsync: publicDecrypt } = usePublicDecrypt();
const { clearValues } = await publicDecrypt({ handles: [handle] });
const cleartext = clearValues[handle];
```
On-chain step 3: `FHE.checkSignatures(cts, abi.encode(clearValue), proof)`. The `cts` array order MUST match step 2's input order; swapping reverts with `KMSInvalidSigner(address)`. Detail: `references/inputs-decryption.md` ("Public Decryption v0.9 Three-Step Flow").

### 6. Local development (no relayer key, no live KMS)

```ts
import { RelayerCleartext, hardhatCleartextConfig, hoodiCleartextConfig } from "@zama-fhe/sdk/cleartext";
const relayer = new RelayerCleartext(hardhatCleartextConfig);  /* chainId 31337 */
/* Or hoodiCleartextConfig for the public Hoodi testnet without an API key. */
```

`RelayerCleartext` is BLOCKED on chain 1 (mainnet) and 11155111 (Sepolia) - it errors on construction. Detail: `references/zama-sdk-auth-storage.md` and `references/zama-sdk-overview.md` ("Network Presets").

### 7. Decrypt-someone-else's-balance (delegation)

```ts
await token.delegateDecryption({
  delegateAddress,
  expirationDate: Math.floor(Date.now() / 1000) + 3600,  /* must be >= now + 1h */
});
/* Wait 1-2 minutes for gateway propagation, otherwise DelegationNotPropagatedError. */
const otherBalance = await token.decryptBalanceAs(otherAddress, delegateAddress);
```

Detail: `references/zama-sdk-session.md` ("Delegated Decryption") and `references/zama-sdk-tokens.md`.

### Pitfalls (do not skip)

1. `userDecrypt` returns a bare `Record<handle, value>`. `publicDecrypt` returns `{ clearValues }`. The two are NOT the same shape - mixing them silently breaks readers.
2. Browser SDK requires COOP `same-origin` + COEP `require-corp` (or `credentialless` if you also serve RainbowKit/WalletConnect). Without both, encryption fails at WASM init with no clear error.
3. Vite users MUST exclude `@zama-fhe/relayer-sdk` from `optimizeDeps` AND set `worker.format: "es"` - otherwise WASM init throws.
4. Mainnet relayer needs an API key; the browser MUST route through a backend proxy (never `NEXT_PUBLIC_*` / `VITE_*`). Three auth shapes: `ApiKeyHeader`, `ApiKeyCookie`, `BearerToken`. Detail: `references/zama-sdk-auth-storage.md` and `references/frontend.md` (Mainnet section).
5. Empty handle = `NoCiphertextError`. Map to "Shield tokens to get started", NOT "0".
6. `useAllow` once per session, then `useUserDecrypt` is silent (cached in IndexedDB). `keypairTTL` default 30d, max 365d, `0` rejected.

---

## 2-Layer Verification Protocol

FHEVM had 32 documented breaking changes between v0.8 and v0.9, and v0.10 / v0.11 added further additive changes (event shapes, `inferredTotalSupply`, interface IDs). The skill targets v0.11. Training data frequently contains outdated patterns from v0.8 and earlier. Every technical value you
write or flag must pass two layers:

- **Layer 1 - Reference** - Check `references/anti-patterns.md` (always
  loaded) plus the topic-specific reference for the task.
- **Layer 2 - Source** - Verify against the actual installed source:
  `node_modules/@fhevm/solidity/lib/FHE.sol`, `@zama-fhe/relayer-sdk/`
  type declarations, or GitHub source if not installed.
- If the two conflict -> **source code wins**. Update the reference if
  the skill is wrong; never silently trust Layer 1 alone.

**Trust hierarchy**: source code > skill references > Zama docs > training knowledge.
Zama's docs are now versioned (v0.10, v0.11, Latest under https://docs.zama.org/protocol/solidity-guides/), but search results, copilots, and older bookmarks still surface v0.6-v0.9 pages without obvious version labels. The skill targets v0.11 only - if a doc page predates v0.11 it is suspect. Treat every function name, signature, address, URL, and import path as suspect until you have confirmed it against installed source.

**Confidence -> Severity mapping for findings** (used in every review):

| Confidence | Label | Severity (combined with impact) | When to use |
|-----------|-------|-------------------------------|-------------|
| >=95 | DEFINITE BUG | Critical / High | Source-verified, will revert or lose data |
| 80-94 | LIKELY ISSUE | High / Medium | Strong evidence, needs one more verification step |
| 70-79 | PROBABLE ISSUE | Medium | Partial path, plausible exploit |
| 40-69 | SUGGESTION | Low | May be intentional design choice |
| <40 | NOTE | Info | Code smell worth mentioning, not actionable |

**Severity** (final column in the report) = Confidence x Impact:
- **Critical** - Funds at risk, permanent lockup, confidentiality total breach
- **High** - Material funds at risk or systemic failure under reachable state
- **Medium** - Bounded funds at risk, partial confidentiality leak, DoS of a feature
- **Low** - Hardening / best-practice / defense-in-depth
- **Info** - Code quality note, no exploit path

---

## ALWAYS / ASK FIRST / NEVER

**ALWAYS**:
- Read reference files before writing FHEVM code
- Call `FHE.allowThis()` after every stored encrypted computation
- Call `FHE.allow(result, user)` for values users need to decrypt
- Use `ZamaEthereumConfig`, `FHE.fromExternal()`, `FHE.select()`
- Run 2-layer verification on every technical value
- Grep output for deprecated patterns before delivering
- State your plan (types, operations, ACL calls) before writing code

**ASK FIRST** (do not decide unilaterally):
- Which decryption pattern: public decrypt vs user decrypt
- Whether to use types beyond euint64 (gas/HCU implications)
- Whether to add replay protection to finalization functions
- Whether to use ERC-7984 vs custom token implementation

**NEVER**:
- Use `requestDecryption`, `GatewayCaller`, `fhevmjs`, `TFHE.`, `SepoliaConfig` in .sol
- Branch on encrypted values (`require`/`if`/`assert` on FHE results)
- Use `FHE.div()` or `FHE.rem()` with encrypted divisor
- Assume function names from memory - grep/read references first
- Deliver code without running the mandatory self-review checklist
- Use signed integer types (`eint8`-`eint256`) - not available yet

Every technical decision must cite evidence:
- Acceptable: "Using `FHE.fromExternal()` because the parameter type is `externalEuint64` (line 15)."
- Not acceptable: "Using `FHE.fromExternal()` because that's the correct function."

---

## Workflows

Workflows are numbered for cross-reference (W1 - W7). They are NOT a strict execution order. Pick by trigger:

| Trigger | Workflow | Tier |
|---|---|---|
| Write a new `.sol` contract | W1 - Generate Contract | Solidity |
| Review existing `.sol` (single-pass) | W2 - Review Contract | Solidity |
| Write Hardhat tests | W3 - Generate Tests | Solidity + JS |
| Deploy / set up project | W4 - Deploy Contract | Tooling |
| Full security audit (orchestrated) | W5 - FHE Security Audit | Solidity |
| Browser / Node app on the legacy SDK (custom contracts, raw `createInstance` / `createEncryptedInput` / `userDecrypt` / `publicDecrypt` / `createEIP712`) plus shared bundler / COOP / COEP / Vite / Next.js wiring | W6 - Frontend on legacy SDK | Frontend |
| Browser / React / Node app on the new SDK (ERC-7984 Token API, 59 React hooks, sessions, delegation, activity feeds) | W7 - Frontend on new SDK | Frontend |

For ERC-7984 token flows (`shield` / `unshield` / `confidentialTransfer` / `balanceOf`), use W7. For custom (non-token) confidential contracts, use W6.

### Workflow 1: Generate Contract

When the user asks to create a new FHEVM contract:

**Preload (always)**: `references/anti-patterns.md` - Tier-1 auto-load per Loading Protocol; applies to ALL generated code.

1. **Determine the use case** (token, voting, auction, access control, custom)
2. **Select a template** if applicable:
   - Confidential ERC-20 -> Read `templates/ConfidentialERC20.sol`
   - Private voting -> Read `templates/PrivateVoting.sol`
   - Sealed auction -> Read `templates/SealedAuction.sol`
3. **Load topic references** as needed:
   - Types and operations -> Read `references/types-operations.md`
   - ACL patterns -> Read `references/acl.md`
   - Input/decryption -> Read `references/inputs-decryption.md`
   - ERC-7984 tokens -> Read `references/erc7984.md`
4. **Write the contract** - for EVERY line, verify against anti-patterns:
   - `ZamaEthereumConfig` not `SepoliaConfig` (WHY: SepoliaConfig removed in v0.9 - #1)
   - `FHE.fromExternal()` not `FHE.asEuintXX()` (WHY: asEuintXX converts a Solidity literal or uint variable; user-submitted inputs arrive as externalEuintXX + inputProof - #2)
   - `FHE.select()` not `require(encBool)` and not `if (encBool)` (WHY: encrypted bools cannot be branched on - #13)
   - `FHE.allowThis()` after every STORED computation (WHY: contract loses access next tx without it - locals have transient ACL automatically)
   - `FHE.allow(result, user)` for user-readable values (WHY: users cannot decrypt without ACL)
   - No `view`/`pure` on functions calling FHE math or ACL grants (WHY: those write coprocessor state and revert in view context - #14b)
   - No encrypted loop bound: `for (uint i = 0; i < euint64Var; i++)` is a compile error (WHY: bytes32 UDVT cannot compare with uint; gate per-iteration work with `FHE.select` - #14c)
   - 3-step public decryption if revealing values (WHY: requestDecryption removed in v0.9 - #3)
5. **Scan output against all documented anti-patterns** - run the post-delivery grep AND `node {skill_dir}/scripts/fhe-lint.js <path>` (mechanical lint, exits non-zero on any DEFINITE BUG or LIKELY ISSUE).
6. **2-Layer Verify** per the Verification Protocol: re-read output, confirm every function name, type, and import against installed source (`node_modules/@fhevm/solidity/...`).
7. **Run MANDATORY Self-Review Checklist** (see below).

### Workflow 2: Review Contract

When the user asks to review existing FHEVM code (non-orchestrated -
single agent, faster than Workflow 5):

**Preload (always)**: `references/anti-patterns.md` + `references/finding-validation.md` + `references/report-format.md`.

1. **Phase 1 - Static Scan** (for each function):
   - Trace all encrypted value flows (creation -> operation -> storage)
   - Verify ACL: every stored value has `allowThis()`, every user value has `allow()`
   - Check: no branching on encrypted values (`require`/`if`/`assert`)
   - Check: all external inputs use `fromExternal()`, not `asEuintXX()`
   - Check: comparison names (`ne` not `neq`, `le` not `lte`, `ge` not `gte`)
   - Scan against all documented anti-patterns
2. **Phase 2 - Logic Analysis**:
   - Can any operation overflow? Is it guarded with `FHE.select`?
   - Can any division have an encrypted divisor? (panics at runtime)
   - Are `checkSignatures` handle orders consistent with `publicDecrypt` order?
   - Are there uninitialized handles being used in operations?
   - Is replay protection missing on any finalization function?
3. **Phase 3 - 2-Layer Verify every finding** - for each candidate
   finding, confirm the "correct" pattern against installed source
   (`node_modules/@fhevm/solidity/...`). Reject findings that Layer 2
   disproves. Record proof line numbers.
4. **Phase 4 - Classify + Score** using the table in the 2-Layer
   Verification Protocol section. Assign:
   - `confidence` (0-100) from `finding-validation.md` scoring
   - `severity` (Critical / High / Medium / Low / Info)
   - `remark` (one of: **Exploitable** / **Needs Review** / **Design
     Choice** / **False Positive** / **Hardening**)
5. **Phase 5 - Output** following `references/report-format.md`
   exactly. The Findings Summary table MUST include Severity, Confidence,
   and Remark columns. Every finding detail MUST include a Remark line.

### Workflow 3: Generate Tests

When the user asks to write tests for an FHEVM contract:

**Preload (always)**: `references/anti-patterns.md` (Hardhat Plugin Mistakes #20-#22e) + `references/testing.md`.

1. **Verify the contract first** - run a quick Workflow 2 scan before writing tests. Do not write tests around a contract that already violates anti-patterns.
2. **Generate Hardhat test** - for each test, verify against anti-patterns:
   - Import `fhevm` from `hardhat` and `FhevmType` from `@fhevm/hardhat-plugin`
   - `fhevm.createEncryptedInput()` for encryption
   - `userDecryptEuint` takes `FhevmType` (WHY: it needs to know which euint size)
   - `userDecryptEbool` does NOT take `FhevmType` (WHY: bool has no size variants)
   - `userDecryptEaddress` does NOT take `FhevmType` (WHY: address has no size variants)
   - Test happy path AND edge cases (insufficient balance, uninitialized, overflow)
   - Verify encrypted state via decryption after each operation
3. **Scan output against the Hardhat Plugin Mistakes section (#20-#22e)** - grep for `FhevmType` on ebool/eaddress, old `fhevmjs` imports, and `expect(<decryptedVar>).to.eq(<plain number>)` patterns where the plugin returns a `bigint` (#22e).
4. **For frontend tests** -> Read `references/frontend.md` (anti-patterns #15-#19c apply: bare imports, wrong init, wrong result field, Vite WASM, Next.js SSR).
5. **Custom Hardhat tasks** (not tests) must call `await fhevm.initializeCLIApi()` before the first FHEVM call. Tests auto-initialize, tasks do NOT. Also: never call `fhevm.createInstance()` in tests - it exists on the implementation class but is NOT on the public `HardhatFhevmRuntimeEnvironment` interface. Use `fhevm.createEncryptedInput()` directly.
6. **2-Layer Verify** every decrypt call: re-read generated test, confirm each `userDecrypt*` / `publicDecrypt` signature against the installed `@fhevm/hardhat-plugin` type definitions.

### Workflow 4: Deploy Contract

When the user asks to deploy, set up a project, or configure deployment:

**Preload (always)**: `references/anti-patterns.md` (Address and Configuration Mistakes #23-#25i: wrong relayer URL, v0.8 addresses, hardcoded addresses, mainnet API-key handling, proxy CORS / content-encoding / route version, whitespace key) + `references/environment.md` + `references/deployment.md`.

1. Framework is Hardhat. Two deploy patterns:
   - **Path A (default):** `npx hardhat run scripts/deploy.ts --network <net>`. Template: https://github.com/zunmax/fhevm-template.
   - **Path B:** `hardhat-deploy@^0.11.45` plugin. Same template (https://github.com/zunmax/fhevm-template) ships `contracts/deploy/deploy.ts`; run with `npx hardhat deploy --network <net>`.
2. Required pins (full table in `references/deployment.md` and `references/environment.md`):
   - `hardhat@^2.28.6` - the Hardhat-2 line. The plugin's own peer is `hardhat ^2.0.0`, but a bare `npm install hardhat` resolves Hardhat 3 and breaks. Pin v2 explicitly.
   - `@fhevm/hardhat-plugin@^0.4.2`, `@fhevm/mock-utils@^0.4.2`
   - `@zama-fhe/relayer-sdk@0.4.1` exact (no caret). `@fhevm/mock-utils@0.4.2` peers it that way; the plugin runtime-aborts on drift.
   - `@nomicfoundation/hardhat-ethers@^3.1.3`, `@nomicfoundation/hardhat-chai-matchers@^2.1.2`
   - `@nomicfoundation/hardhat-network-helpers@^1.1.2` (opt-in for `time.increase` / `mine` / `loadFixture` / snapshots)
   - `hardhat-deploy@^0.11.45` (Path B only)
3. Do NOT install: `hardhat-deploy@^0.12` or `^2.0`, `@nomicfoundation/hardhat-ethers@^4.x`, `@nomicfoundation/hardhat-network-helpers@^3.x`. All four require Hardhat 3 and break peer-dep resolution.
4. Compiler: Solidity `0.8.28`, `evmVersion: "cancun"`, optimizer `runs: 800`. Bump pragma to `^0.8.27` if importing `@openzeppelin/confidential-contracts`.
5. Config: load `.env` via `dotenv`. Etherscan v2 uses a single `apiKey` string.
6. Deploy scripts:
   - Path A: `scripts/deploy.ts` with `ethers.getContractFactory().deploy()`. Persist address + ABI to `deployments/<network>/<Contract>.json`.
   - Path B: `deploy/NN_*.ts` exporting a `DeployFunction` from `hardhat-deploy/types`, with `func.tags` set.
7. Networks: Sepolia (11155111), local hardhat (31337), mainnet (1). Addresses come from `ZamaEthereumConfig`; do not hardcode.
8. Verify with `npx hardhat verify --network <net> <addr>`. Path A's script auto-verifies when `ETHERSCAN_API_KEY` is set.
9. **Scan output against anti-patterns #22a and #23-#25** - verify no stale hardhat-deploy pins, no v0.8 addresses, no hardcoded gateway/coprocessor, correct relayer URL.
10. **Run deployment checklist** from `deployment.md` before delivering.
11. **2-Layer Verify** every address and config key against the installed `@fhevm/solidity/config/ZamaConfig.sol` - never against docs or training knowledge.

### Workflow 5: FHE Security Audit (Orchestrated)

You are the orchestrator of a parallelized FHE smart contract security audit.

Trigger on: "audit", "deep review", "security review", "full review", or when the user
explicitly requests a full security analysis of FHEVM contracts.

**Preload (always)**: `references/anti-patterns.md` + `references/fhe-vulnerabilities.md` + `references/solidity-vulnerabilities.md` + `references/finding-validation.md` + `references/report-format.md`. Module bundles pull in the `review-modules/` files.

This mode spawns 7 parallel specialized hacking modules that actively exploit both FHE-specific
and general Solidity vulnerabilities. Six modules exercise FHE attack surfaces (state flow, ACL,
decryption, types, confidentiality, invariants). The seventh targets standard Solidity bugs in
peripheral code, token integrations, economic logic, math precision, and access control.
For quick reviews, use Workflow 2 instead.

**Scan selection:**
- **Default** (no arguments): scan all `.sol` files using the exclude pattern.
- **`$filename ...`**: scan the specified file(s) only.

**Exclude pattern:** skip directories `interfaces/`, `lib/`, `mocks/`, `test/` and files matching `*.t.sol`, `*Test*.sol` or `*Mock*.sol`.

**Flags:**
- `--file-output` (off by default): also write the report to a markdown file at `assets/findings/{project-name}-z-auditor-report-{timestamp}.md`. Never write a report file unless explicitly passed.

**Turn 1 - Discover.** Make these parallel calls in one message:

a. Bash `find` for in-scope `.sol` files per mode selection
b. Glob for `**/references/anti-patterns.md` - its parent dir is `{refs}` (the `references/` folder), its grandparent is `{skill_dir}` (the skill root)
c. ToolSearch `select:Task`
d. Bash `mktemp -d /tmp/fhe-audit-XXXXXX` -> store as `{bundle_dir}`

**Turn 2 - Prepare.** In one message, make parallel tool calls: (a) Read `{refs}/finding-validation.md`, (b) Read `{refs}/report-format.md`.

Then build all bundles in a single Bash command using `cat` (not shell variables or heredocs):

1. `{bundle_dir}/source.md` - ALL in-scope `.sol` files, each with a `### path` header and fenced code block.
2. Module bundles = `source.md` + module-specific files:

| Bundle | Appended files (relative to `{skill_dir}`) |
|--------|---------------------------------------------|
| `module-1-bundle.md` | `references/fhe-vulnerabilities.md` + `review-modules/encrypted-state-flow.md` + `review-modules/audit-protocol.md` |
| `module-2-bundle.md` | `review-modules/acl-completeness.md` + `review-modules/audit-protocol.md` |
| `module-3-bundle.md` | `review-modules/decryption-integrity.md` + `review-modules/audit-protocol.md` |
| `module-4-bundle.md` | `review-modules/type-operation-safety.md` + `review-modules/audit-protocol.md` |
| `module-5-bundle.md` | `review-modules/confidentiality-boundary.md` + `review-modules/audit-protocol.md` |
| `module-6-bundle.md` | `review-modules/fhe-logic-invariant.md` + `review-modules/audit-protocol.md` |
| `module-7-bundle.md` | `references/solidity-vulnerabilities.md` + `review-modules/solidity-security.md` + `review-modules/audit-protocol.md` |

Print line counts for every bundle and `source.md`. Do NOT inline file content into agent prompts.

**Turn 3 - Spawn.** In one message, spawn all 7 agents as parallel foreground `Task` (sub-agent) calls. Prompt template:

```
You are a security auditor exploiting FHE smart contracts.
Your bundle file is {bundle_dir}/module-N-bundle.md (XXXX lines).
The bundle contains all in-scope source code and your hacking module instructions.
Read the bundle fully. Hunt for every vulnerability in your specialty. Construct full
exploit paths with concrete values. Default to LEAD over dropping - do not discard
partial findings.
```

**Turn 4 - Deduplicate, validate & output.** Single-pass: deduplicate all module results, gate-evaluate, and produce the final report in one turn. Do NOT print an intermediate dedup list - go straight to the report.

1. **Deduplicate.** Parse every FINDING and LEAD from all 7 modules. Group by `group_key` field (format: `Contract | function | vulnerability-class`). Exact-match first; then merge synonymous vulnerability_class tags sharing the same contract and function. Keep the best version per group, number sequentially, annotate `[modules: N]`.

   Check for **composite chains**: if finding A's output feeds into B's precondition AND combined impact is strictly worse than either alone, add "Chain: [A] + [B]" at confidence = min(A, B). Most audits have 0-2.

2. **Gate evaluation.** Run each deduplicated finding through the four gates in `finding-validation.md` (do not skip or reorder). Evaluate each finding exactly once - do not revisit after verdict.

   **Single-pass protocol:** evaluate every relevant code path ONCE in fixed order (constructor -> initializer -> state-modifying externals -> internal helpers). One-line verdict per path: `BLOCKS`, `ALLOWS`, `IRRELEVANT`, or `UNCERTAIN`. Commit after all paths - do not re-examine. `UNCERTAIN` = `ALLOWS`.

3. **Lead promotion & rejection guardrails.**
   - Promote LEAD -> FINDING (confidence 75) if: complete exploit chain traced in source, OR `[modules: 2+]` demoted (not rejected) the same issue.
   - `[modules: 2+]` does NOT override a concrete refutation - demote to LEAD if refutation is uncertain.
   - No deployer-intent reasoning - evaluate what the code _allows_, not how the deployer _might_ use it.

4. **Fix verification** (confidence >= 80 only): trace the attack with fix applied; verify fix does not introduce new FHE issues (broken ACL, lost handles, new side channels) OR general Solidity issues (new DoS vectors, reentrancy, broken invariants). Use `safeTransfer` not `require(token.transfer(...))`. List all locations if the pattern repeats. If no safe fix exists, omit it with a note.

5. **Format and print** per `report-format.md`. The Findings Summary table MUST include Severity, Confidence, and Remark columns. Every finding detail MUST carry the three-tag header (`Severity - Confidence N - Remark`). Include the ACL Coverage Matrix. If `--file-output`: also write to file.

Each sub-agent module performs its own 2-Layer Verify (reference + installed source) when closing an attack path - findings without source-confirmed proof default to LEAD per `finding-validation.md`.

### Workflow 6: Frontend on legacy SDK (`@zama-fhe/relayer-sdk@0.4.1`)

Triggers: any UI, dApp, React / Next.js / Vite app, or browser / Node integration that talks to a custom (non-ERC-7984) confidential contract via raw `createInstance` / `createEncryptedInput` / `userDecrypt` / `publicDecrypt` / `createEIP712`; OR any task on the shared bundler / WASM / COOP / COEP / Vite / Next.js wiring layer (which applies to W7 too).

**Preload (always)**: `references/anti-patterns.md` (Frontend / SDK Mistakes #15-#19c: bare imports, wrong init, wrong result field, Vite WASM pre-bundler bug, COOP/COEP wallet conflict, Next.js / SSR `indexedDB` not defined) + `references/frontend.md`.

1. **Determine the framework**: Next.js (app router), Vite+React, Vite+Vue, plain HTML, Node script. Ask the user if ambiguous.
2. **Write the integration** - for EVERY line, verify against the frontend checklist (see MANDATORY Self-Review Checklist below). Key rules:
   - Import the SDK from a sub-path (`/web`, `/bundle`, or `/node`) - never bare
   - `initSDK()` not `initFhevm()` (browser only, runs before `createInstance`)
   - `createInstance({ ...SepoliaConfig, network: window.ethereum })` with `SepoliaConfig` from `@zama-fhe/relayer-sdk/web`, NOT from `@fhevm/solidity`
   - Produce REAL encrypted inputs with `createEncryptedInput -> addXX -> encrypt()` - never placeholder zero bytes
   - `encrypted.handles[N]` -> externalEuintXX arg; `encrypted.inputProof` -> proof arg; order matches `addXX()` call order
   - Public decrypt: `results.clearValues[handle]` NOT `results.values`; user decrypt: `userResults[handle]` directly (bare Record, no wrapper)
   - Serve with COOP `same-origin` + COEP `credentialless` (not `require-corp` if using RainbowKit/WalletConnect)
   - Vite: exclude `@zama-fhe/relayer-sdk` from `optimizeDeps` + set `worker.format: "es"` or WASM fails to load
3. **Scan output against Frontend / SDK Mistakes #15-#19c** - grep for bare imports, `initFhevm`, `@fhevm/sdk`, `fhevmjs`, `results.values[`, `zama.cloud`. Also verify (no easy grep): Vite `optimizeDeps.exclude` + `worker.format: "es"` for #19b, and `"use client"` + `useEffect` gating around `initSDK` for #19c.
4. **Run MANDATORY Self-Review Checklist -> Frontend section** (below).
5. **2-Layer Verify** every SDK call against the installed types in `node_modules/@zama-fhe/relayer-sdk/` - not against docs or training knowledge.
6. **User decryption (EIP-712)** uses `instance.generateKeypair()` + `instance.createEIP712(publicKey, [contractAddr], startTs, days)`, then `signer.signTypedData(...)`, then `instance.userDecrypt([{ handle, contractAddress }], privateKey, publicKey, sig, [contractAddr], userAddr, startTs, days)`. `userDecrypt` returns a bare `Record`, NOT a `.clearValues` wrapper. Full typed-data flow in `references/frontend.md`.
7. **Mainnet deployments** (chain 1). Full backend-proxy pattern lives in `references/frontend.md`; the rules below cover anti-patterns #25a-#25i:
   - **Config**: `MainnetConfig` on chain 1 (spread it; never `SepoliaConfig` on chain 1). `SepoliaConfig` for chain 11155111.
   - **Auth shape**: `auth: { __type: 'ApiKeyHeader', value }` on the server. Three valid shapes: `BearerToken | ApiKeyHeader | ApiKeyCookie`. Never `NEXT_PUBLIC_*` / `VITE_*` (#25a).
   - **Browser proxy**: set `relayerUrl` to your backend proxy, omit `auth`. The browser never sees the key.
   - **`relayerRouteVersion`**: required for any non-Zama `relayerUrl`. Pass `1` or `2` matching the upstream `/v1` or `/v2` path. The SDK auto-detects only on hardcoded Zama bases (`SepoliaRelayerBaseUrl`, `MainnetRelayerBaseUrl`, and their `/v1` / `/v2` variants); for any other URL it falls back to `defaultRelayerVersion: 2` and validates camelCase. Mainnet/testnet at `/v1` returns snake_case, so a missing `relayerRouteVersion: 1` produces `RelayerGetKeyUrlInvalidResponseError("Invalid relayer response.")` (#25h).
   - **Proxy CORS**: include `zama-sdk-version, zama-sdk-name` in `Access-Control-Allow-Headers` and forward both upstream. The SDK sends them on every request (#25d, #25f).
   - **Proxy response sanitization**: strip `content-encoding` and `content-length`. Node `fetch()` decodes gzip / br before `.arrayBuffer()`; forwarding the upstream encoding header produces `ERR_CONTENT_DECODING_FAILED` (#25g).
   - **API key validation**: reject keys containing whitespace at startup; `trim()` only strips outer whitespace (#25i).

### Workflow 7: Frontend on new SDK (`@zama-fhe/sdk@^3` Token / Shield / Unshield / Transfer)

Trigger when the user builds a confidential ERC-7984 dApp on the new SDK
family (imports `@zama-fhe/sdk` / `@zama-fhe/react-sdk`, uses `ZamaSDK` /
`Token` / `ReadonlyToken` / `WrappersRegistry`, calls `shield` / `unshield`
/ `confidentialTransfer` / `balanceOf`, or uses hooks like `useShield` /
`useUnshield` / `useConfidentialBalance` / `useAllow` / `useUserDecrypt`).

**Preload (always)**: `references/anti-patterns.md` (#33-#45 for new-SDK footguns) + `references/zama-sdk-overview.md` + `references/zama-sdk-auth-storage.md`.

1. **Decide the SDK family.** New `@zama-fhe/sdk` for ERC-7984 flows (shield / unshield / transfer / balance via `Token` API). Legacy `@zama-fhe/relayer-sdk@0.4.1` for raw `createInstance` / `createEncryptedInput` / `createEIP712` against custom non-token contracts. Both coexist; new SDK transitively requires the legacy at exact `0.4.1`.
2. **Pick collaborators by runtime**: browser -> `RelayerWeb` + `indexedDBStorage` + `ViemSigner` / `EthersSigner` / `WagmiSigner`; Node.js -> `RelayerNode` (`/node` subpath) + `asyncLocalStorage`; local Hardhat -> `RelayerCleartext` (blocked on chain 1 / 11155111); MV3 extension -> add `chromeSessionStorage` for `sessionStorage` and `"storage"` in `manifest.json`. Detail in `zama-sdk-auth-storage.md`.
3. **Wire authentication.** Browser: backend proxy injects `x-api-key`; never set `auth` on the client. Node.js: `auth: { __type: "ApiKeyHeader", value: process.env.RELAYER_API_KEY }`. Three shapes: `ApiKeyHeader`, `ApiKeyCookie`, `BearerToken`. CSRF via `security.getCsrfToken` on `RelayerWeb`.
4. **Construct `ZamaSDK`** with relayer + signer + storage. Optional: `sessionStorage`, `keypairTTL` (default 30d, max 365d, `0` rejected), `sessionTTL` (number / `0` / `"infinite"`), `registryAddresses` (Hardhat needs explicit `{ [31337]: "0x..." }`), `onEvent`. Reference: `zama-sdk-overview.md`.
5. **Token flows** (`zama-sdk-tokens.md`): `token.shield(amount, { approvalStrategy })` throws `InsufficientERC20BalanceError`; `token.unshield(amount, { onUnwrapSubmitted, onFinalizing, onFinalizeSubmitted })` is two-phase (returned `txHash` is the FINALIZE tx) and resumable via `savePendingUnshield` -> `loadPendingUnshield` -> `token.resumeUnshield` -> `clearPendingUnshield`; `token.confidentialTransfer(to, amount)`; `token.approve(spender, until?)` is time-bounded operator approval (default 1h); transfer-operator and unshield-operator approvals are SEPARATE scopes.
6. **Session-aware decryption** (`zama-sdk-session.md`): `sdk.allow([cAddrs])` once authorizes a contract set; subsequent `sdk.userDecrypt(handles)` / `token.balanceOf` are silent. Zero handles resolve to `0n` without prompting. `sdk.revokeSession()` clears session + cache. Delegation: `token.delegateDecryption({ delegateAddress, expirationDate >= now+1h })`, then wait 1-2 min for gateway propagation before `decryptBalanceAs`.
7. **React** (`zama-sdk-react.md`): wrap in `WagmiProvider` -> `QueryClientProvider` -> `ZamaProvider`; `"use client"` on any file importing `@zama-fhe/react-sdk`; never construct `RelayerWeb` at module level in a server-imported file; `useAllow` once + `useUserDecrypt` gated `enabled: !!isAllowed`; mutations auto-invalidate balance queries (use `zamaQueryKeys` for manual control). Custom non-token contracts use `useEncrypt` + `useUserDecrypt` directly.
8. **Errors** (`zama-sdk-errors.md`): all extend `ZamaError`; use `matchZamaError(error, { CODE: ..., _: ... })`. Map `NoCiphertextError` to empty-state, NOT "0". Never auto-retry on `SigningRejectedError`.
9. **Dashboards** (`zama-sdk-activity.md`): pipeline is `parseActivityFeed` -> `extractEncryptedHandles` -> `sdk.userDecrypt` -> `applyDecryptedValues` -> `sortByBlockNumber` (or React `useActivityFeed`). Token logs via `TOKEN_TOPICS` against the token; ACL delegation logs via `ACL_TOPICS` against the ACL contract.
10. **Scan against anti-patterns #33-#45** + Common Mistakes in each `zama-sdk-*.md`. Run `node {skill_dir}/scripts/fhe-lint.js <path>` for the mechanical checks: wrong subpath for `RelayerNode`/`ViemSigner`/`EthersSigner`/`WagmiSigner`/`RelayerCleartext` imports (#33), `RELAYER_API_KEY` exposed to browser via `NEXT_PUBLIC_*` / `VITE_*` (#34), `GenericStorage` shaped like the DOM `Storage` API (#35), `keypairTTL: 0` (#36), `RelayerCleartext` on Mainnet or Sepolia (#39), and auto-retry inside a `SigningRejectedError` catch block (#41).
11. **2-Layer Verify** every imported identifier against `node_modules/@zama-fhe/sdk/dist/*` and `node_modules/@zama-fhe/react-sdk/dist/*`. The new SDK first stabled 2026-04-22; training knowledge is likely wrong - source wins.

## Code Style (summary - full rules in `references/code-style.md`)

Match the documentation style of OpenZeppelin, Uniswap, and Solady. A style violation is a review failure. Load `references/code-style.md` before writing or reviewing. The nine rules:

1. **Comment syntax.** C-family files use `/* */` inline and `/** */` doc blocks. Never `//` or `///`. Hash-comment languages use `#`.
2. **Banned Unicode.** U+2014 (EM DASH) and U+2013 (EN DASH) forbidden everywhere. Replace with `-`, `:`, `,`, parens, or rephrase.
3. **File header.** Every source file opens with `@file` + `@description` JSDoc block (C-family) or `#####` / module docstring (hash). Filename must match.
4. **Section dividers.** One-line asterisk boxes: `/*************** Internal ***************/`. >=10 leading + >=10 trailing `*`, Title Case label, one per logical section.
5. **Solidity NatSpec.** Every external/public function, ABI-exposed storage var, and contract carries `/** */` NatSpec. Contract tags: `@notice`, `@dev`, `@custom:security-contact`. Function tags: `@notice` (or `@inheritdoc ParentName`), `@param` per param, `@return` per return.
6. **TS / JS uses JSDoc, NOT NatSpec.** Leading description, `@param`, `@returns`, `@throws`, `@example`, `@deprecated`, `@see`, `@remarks`. Banned: `@notice`, `@dev`, `@inheritdoc`, `@title`, `@author`, `@custom:*`.
7. **Inline comments explain WHY, not WHAT.** Hidden invariants, workarounds, ordering constraints, surprising FHE behavior. Never reference PRs/tickets.
8. **FHE-specific comment subjects.** Document when relevant: handle order in `checkSignatures`, transient vs persistent ACL, `FHE.select` type-match, irreversibility of `makePubliclyDecryptable`, silent overflow wrap.
9. **Post-delivery grep.** Zero matches on `^\s*//[^\*]|^\s*///` (comments) and `[\x{2013}\x{2014}\x{1F680}\x{26A0}]` (en/em dashes plus rocket / warning emoji).

For tag tables, full examples, and counter-examples, load `references/code-style.md`.

---

## FHE Security Checklist (Quick Review)

When reviewing FHEVM contracts without full audit, check these FHE-specific vulnerabilities:

- **Self-transfer inflation**: `from == to` causes second balance write to overwrite first -> guard with `require(from != to)`
- **ACL gaps on all paths**: every stored encrypted value needs `allowThis()` + `allow(user)` including on early returns/error paths
- **Encrypted branching**: `require(FHE.le())` is a Solidity compile error (`ebool` is a `bytes32` UDVT, no auto-bool conversion); the bug is when dev unwraps the handle and gates on non-zero - the check always passes -> use `FHE.select()`
- **Conservation law in `FHE.select`**: both branches must be zero-sum for transfers (failed = amount becomes 0)
- **Handle ordering**: `checkSignatures` array must match `publicDecrypt` order (cryptographically binding)
- **Confidentiality leaks**: no decrypted values in events, no plaintext allowances with encrypted balances, no asymmetric gas consumption in `FHE.select` branches
- **Overflow wrapping**: FHE arithmetic wraps silently - guard with `FHE.le()` + `FHE.select()` when needed

For the full 32 FHE patterns, see `references/fhe-vulnerabilities.md`.
For 29 general Solidity patterns, see `references/solidity-vulnerabilities.md`.

---

## Reference Files

For detailed API reference, load from `references/` (sibling of this file):

| File | When to Load |
|------|-------------|
| `types-operations.md` | Writing contracts with FHE operations |
| `acl.md` | ACL patterns, grant/check access |
| `inputs-decryption.md` | Input handling, all decryption flows (legacy `@zama-fhe/relayer-sdk` primitives) |
| `anti-patterns.md` | **ALL workflows** - verified mistakes, auto-loaded (Tier 1) |
| `code-style.md` | **ALL workflows** - comment style, headers, dividers, NatSpec vs JSDoc, banned chars, auto-loaded (Tier 1) |
| `fhe-vulnerabilities.md` | Deep security audit (32 FHE-specific patterns P1-P32) |
| `solidity-vulnerabilities.md` | General Solidity patterns (29 vectors G1-G29) |
| `finding-validation.md` | Validating findings with 4-gate system |
| `report-format.md` | Audit report template with ACL Coverage Matrix |
| `erc7984.md` | ERC-7984 confidential tokens (Solidity layer) |
| `testing.md` | Hardhat test patterns |
| `frontend.md` | Browser SDK integration (legacy primitives, WASM / COOP / COEP, Vite / Next.js wiring, mainnet API key) |
| `deployment.md` | Deploy to Sepolia / mainnet (Hardhat only, Path A recommended, Path B uses `hardhat-deploy`) |
| `environment.md` | From-scratch Hardhat project scaffolding |
| `self-review.md` | Mandatory pre-delivery checklist (Code Style + Solidity + Frontend + Hardhat) |
| `zama-sdk-overview.md` | `@zama-fhe/sdk@^3` package map, `ZamaSDK` constructor, network presets, when to choose new vs legacy SDK |
| `zama-sdk-auth-storage.md` | Backend proxy + 3 `auth` shapes + CSRF, `RelayerWeb` / `RelayerNode` / `RelayerCleartext`, `ViemSigner` / `EthersSigner` / `WagmiSigner` / `GenericSigner`, storage adapters, web extensions |
| `zama-sdk-tokens.md` | `Token` / `ReadonlyToken`, shield / unshield (resumable two-phase) / confidentialTransfer / balanceOf, batch decrypt |
| `zama-sdk-session.md` | Session model (`keypairTTL` / `sessionTTL`), `allow` / `userDecrypt` / `revokeSession`, full delegated decryption API |
| `zama-sdk-react.md` | `ZamaProvider`, 59 React hooks (TanStack-Query mutations + queries), Next.js SSR, Vite, `zamaQueryKeys`, hosted-signer + custom-FHE-contract patterns |
| `zama-sdk-errors.md` | 26 error classes (`ZamaError` base + 25 subclasses), `matchZamaError`, common recovery flows, "no balance" vs "zero balance" |
| `zama-sdk-activity.md` | Activity feed pipeline, token + ACL event decoders, `WrappersRegistry`, contract builders, operator approvals, FHE artifact cache |
| `templates/` | Ready-to-use contract templates |
| `review-modules/` | 7 specialized hacking modules (6 FHE + 1 general) + `audit-protocol.md` (8 files total) |
| `scripts/fhe-lint.js` | Mechanical regex linter encoding the highest-priority anti-patterns; runs as a post-delivery gate |

---

## MANDATORY Self-Review Checklist

**Do not deliver code until you complete the review.**

Full checklists (Code Style + Solidity + Frontend + Hardhat) live in `references/self-review.md`. Load that file, copy the sections relevant to what you touched, and verify every item before delivering. The final gate below is the Post-Delivery Grep; any hit means fix before delivering.

### Post-Delivery Grep (zero matches required)

```
Solidity: requestDecryption|SepoliaConfig|GatewayCaller|TFHE\.|FHE\.allowForDecryption\(|FHE\.neq\(|FHE\.lte\(|FHE\.gte\(|verifySignatures|zama\.cloud|FHE\.randBounded\(
Frontend: from '@zama-fhe/relayer-sdk'[^/]|initFhevm|@fhevm/sdk|fhevmjs|results\.values\[|zama\.cloud
Hardhat:  userDecryptEbool\(FhevmType|userDecryptEaddress\(FhevmType|fhevmjs
Style:    ^\s*//[^\*]|^\s*///|[\x{2013}\x{2014}\x{1F680}\x{26A0}]
```

Asterisk-box section dividers (`/*************** Name ***************/`) are NOT grepped; they are preferred project style.

### Mechanical Lint (run after grep)

```bash
node {skill_dir}/scripts/fhe-lint.js <path>
# exit 0 clean, 1 DEFINITE, 2 LIKELY only
```

`{skill_dir}` is `.claude/skills/zama-skill`, `.agents/skills/zama-skill`, or `.cursor` depending on the install. Findings cite the anti-patterns.md ID. A non-zero exit blocks delivery.


