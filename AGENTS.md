# AGENTS.md - FHEVM project guidance

This file is the project guidance loaded by AGENTS.md-aware coding agents (Codex CLI, Aider, Cline, Continue, Zed, Jules, etc.). It activates only when the project touches Zama FHEVM v0.11. If the project has no FHEVM imports, encrypted types, or FHEVM error strings, ignore this file.

## Activation

Apply this file whenever you edit code that touches Zama FHEVM v0.11. Trigger conditions:

- Imports `@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@fhevm/mock-utils`, `@zama-fhe/relayer-sdk` (legacy primitives), `@zama-fhe/sdk` (new high-level SDK v3+), `@zama-fhe/react-sdk` (new React hooks v3+), or `@openzeppelin/confidential-contracts`. Sub-paths count: `@zama-fhe/sdk/node`, `@zama-fhe/sdk/viem`, `@zama-fhe/sdk/ethers`, `@zama-fhe/sdk/cleartext`, `@zama-fhe/sdk/query`, `@zama-fhe/react-sdk/wagmi`, plus the legacy `@zama-fhe/relayer-sdk/web|bundle|node`.
- Declares or uses `euint8`-`euint256`, `ebool`, `eaddress`, `externalEuint*`.
- Contract inherits `ZamaEthereumConfig` (the only current Solidity base), or any legacy `SepoliaConfig` / `MainnetConfig` Solidity base from a pre-v0.9 codebase that needs migrating. (`MainnetConfig` and `SepoliaConfig` *do* exist as TS exports in `@zama-fhe/relayer-sdk/web` and `@zama-fhe/sdk` for frontend SDK config - those are unrelated to Solidity inheritance.)
- Code uses any new-SDK identifier: `ZamaSDK`, `ZamaProvider`, `RelayerWeb`, `RelayerNode`, `RelayerCleartext`, `ViemSigner`, `EthersSigner`, `WagmiSigner`, `GenericSigner`, `Token`, `ReadonlyToken`, `WrappersRegistry`, `IndexedDBStorage`, `MemoryStorage`, `ChromeSessionStorage`, `matchZamaError`, `zamaQueryKeys`, `TOKEN_TOPICS`, `ACL_TOPICS`; or any of the 59 React hooks (`useShield`, `useUnshield`, `useUnshieldAll`, `useResumeUnshield`, `useConfidentialBalance`, `useConfidentialBalances`, `useConfidentialTransfer`, `useConfidentialTransferFrom`, `useConfidentialApprove`, `useConfidentialIsApproved`, `useAllow`, `useIsAllowed`, `useRevoke`, `useRevokeSession`, `useEncrypt`, `useUserDecrypt`, `usePublicDecrypt`, `useGenerateKeypair`, `useDelegateDecryption`, `useRevokeDelegation`, `useDelegationStatus`, `useDecryptBalanceAs`, `useBatchDecryptBalancesAs`, `useActivityFeed`, `useToken`, `useReadonlyToken`, `useMetadata`, `useUnderlyingAllowance`, `useWrapperDiscovery`, `useWrappersRegistryAddress`, `useListPairs`, `useTokenPair*`, `useConfidentialTokenAddress`, `useTokenAddress`, `useIsConfidentialTokenValid`, `useUnwrap`, `useUnwrapAll`, `useFinalizeUnwrap`).
- User mentions FHEVM, Zama, TFHE, confidential contracts, encrypted balances, homomorphic computation, confidential dApp, ERC-7984, shielding / unshielding tokens, confidential transfers, the Zama Protocol, the wrappers registry, or the relayer SDK.
- Errors mention any FHEVM custom error: ACL (`SenderNotAllowed`, `ACLNotAllowed`, `SenderNotAllowedToUseHandle`), input verification (`InvalidInputHandle`, `EmptyInputProof`, `DeserializingInputProofFail`), KMS decrypt (`InvalidKMSSignatures`, `KMSInvalidSigner`, `EmptyDecryptionProof`), runtime (`DivisionByZero`, `NotPowerOfTwo`, `ZamaProtocolUnsupported`), or HCU (`HCUTransactionLimitExceeded`, `HCUTransactionDepthLimitExceeded`); or WASM / COOP / COEP issues in an FHEVM project.

If none of the above applies, ignore this file.

## First two actions on every FHEVM task

1. Load `.agents/skills/zama-skill/SKILL.md` and follow its workflow-selection logic.
2. Load `.agents/skills/zama-skill/references/anti-patterns.md`. It lists 62 verified mistakes agents repeat in FHEVM code; the post-delivery grep and `scripts/fhe-lint.js` both gate against them.

## Architecture you must assume

FHEVM contracts operate on opaque `bytes32` handles. An off-chain coprocessor performs FHE computation on ciphertexts and returns new handles. Every handle has an ACL that tracks who can read or use it.

You CANNOT branch on an encrypted value. `require(ebool)` and `if (ebool)` are Solidity compile errors (UDVT does not auto-convert to `bool`); the vulnerable shape is when a developer unwraps the handle to a primitive (`ebool.unwrap(r) != bytes32(0)`) - the handle is always non-zero so the check always passes. Use `FHE.select(cond, trueVal, falseVal)` for conditional logic.

## ALWAYS

- Call `FHE.allowThis(value)` after every stored encrypted computation. Without it the contract loses the handle next transaction.
- Call `FHE.allow(value, user)` for values the user needs to decrypt. Without it the decrypt reverts with `SenderNotAllowed(address)` (custom error from `@fhevm/host-contracts/contracts/ACL.sol:106`).
- Use `ZamaEthereumConfig` as the Solidity config base. `SepoliaConfig` was removed as a Solidity base in v0.9.
- Use `FHE.fromExternal(extBytes, proof)` to ingest user-submitted encrypted input. `FHE.asEuintXX(literal)` is for plaintext literals only.
- Verify every function name, parameter type, and signature against installed source (`node_modules/@fhevm/solidity/`, `node_modules/@zama-fhe/relayer-sdk/`, `node_modules/@fhevm/hardhat-plugin/`). **Trust hierarchy: source > reference files > Zama docs > training knowledge.** On conflict, source wins.
- Grep your own output against the post-delivery patterns in the skill before delivering. Zero matches is the pass condition.

## ASK FIRST

Do not decide any of these unilaterally:

- Public decrypt vs user decrypt (visibility model differs).
- Encrypted integer width above `euint64` (HCU and gas cost rise sharply).
- Replay protection on finalization functions.
- ERC-7984 standard vs custom confidential ERC-20.

## NEVER

- `TFHE.*` - the library is `FHE`. `TFHE` does not compile.
- `SepoliaConfig` as a Solidity base - removed in v0.9. (Same name in the relayer SDK is a different, valid thing.)
- `FHE.requestDecryption`, `GatewayCaller`, `FHE.verifySignatures` - all removed or renamed in v0.9. (`FHE.allowForDecryption` never existed as a library helper; use `FHE.makePubliclyDecryptable`. `IACL.allowForDecryption(bytes32[])` does still exist on the host ACL contract; `makePubliclyDecryptable` wraps it for the single-handle path.)
- `FHE.neq`, `FHE.lte`, `FHE.gte` - do not exist. Use `ne`, `le`, `ge`.
- `fhevmjs`, `@fhevm/sdk`, `@zama-ai/fhevm`, bare `fhevm` - deprecated or never existed. Use `@zama-fhe/relayer-sdk` with `/web`, `/bundle`, or `/node`.
- `require(FHE.le(...))` or any `if`/`assert` on an FHE result - Solidity compile error (`ebool` is a `bytes32` UDVT, no auto-bool conversion). The bug is when a dev unwraps the handle (`ebool.unwrap(r) != bytes32(0)`) - the non-zero handle always passes the check. Use `FHE.select`.
- `FHE.asEuintXX(externalBytes, proof)` for user input - use `FHE.fromExternal(externalBytes, proof)`.
- Signed integer types `eint8`-`eint256` are declared in `encrypted-types/EncryptedTypes.sol` (so `eint64 x;` compiles) but `@fhevm/solidity@0.11.1` ships no `FHE.*` overloads for them; first operation fails with `Member "<op>" not found ... after argument-dependent lookup`.
- `FHE.div(x, y)` or `FHE.rem(x, y)` with an *encrypted* divisor is a Solidity compile error (`Member "div" not found ... after argument-dependent lookup`); only the `(euint*, uintN)` plaintext-divisor overload exists. At runtime, `FHE.div(x, 0)` reverts with the custom error `DivisionByZero()` raised by `FHEVMExecutor` (not `Panic(0x12)`).

## Quick setup (copy-paste skeleton)

```solidity
pragma solidity ^0.8.28;
import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
contract MyContract is ZamaEthereumConfig { }
```

EVM target: `"cancun"`. Default pragma: `^0.8.28`. Bump to `^0.8.27` minimum when importing `@openzeppelin/confidential-contracts`. Absolute FHEVM minimum: `^0.8.24`.

## ACL cheat sheet

| Function | Purpose |
|----------|---------|
| `FHE.allow(ct, address)` | Grant permanent access |
| `FHE.allowThis(ct)` | Grant this contract access (call after every stored computation) |
| `FHE.allowTransient(ct, address)` | Grant access for current tx only |
| `FHE.makePubliclyDecryptable(ct)` | Mark for public decryption (permanent, irreversible) |
| `FHE.isAllowed(ct, address)` | Returns plaintext `bool` - safe inside `require`/`if` |
| `FHE.isSenderAllowed(ct)` | Returns plaintext `bool` |

## Public decryption is a 3-step flow

1. On-chain: `FHE.makePubliclyDecryptable(handle)`.
2. Off-chain (dApp): `await instance.publicDecrypt([handle])`, then read `results.clearValues[handle]`.
3. On-chain: `FHE.checkSignatures(cts, abi.encode(clearValue), proof)`. The `cts` order MUST match the order passed to `publicDecrypt`. Swapping handles reverts.

## Dependency pins (v0.11)

| Package | Version | Notes |
|---------|---------|-------|
| `@fhevm/solidity` | `^0.11.1` | Contract library |
| `@fhevm/hardhat-plugin` | `^0.4.2` | Hardhat plugin |
| `@fhevm/mock-utils` | `^0.4.2` | Mock host for tests |
| `@zama-fhe/relayer-sdk` | `0.4.1` (exact, no caret) | Legacy primitives; still required as transitive dep even on the new SDK |
| `@zama-fhe/sdk` | `^3.0.0` | New high-level SDK (`ZamaSDK`, `Token`, sessions). `node >= 22`. Optional. |
| `@zama-fhe/react-sdk` | `^3.0.0` | New React hooks (TanStack Query). Optional. |
| `@nomicfoundation/hardhat-ethers` | `^3.1.3` (v4.x requires Hardhat 3) | |
| `@nomicfoundation/hardhat-network-helpers` | `^1.1.2` (v3.x requires Hardhat 3) | |
| `@nomicfoundation/hardhat-chai-matchers` | `^2.1.2` | |
| `@openzeppelin/confidential-contracts` | `^0.4.0` | |

Never install: `fhevmjs`, `@zama-ai/fhevm`, `@fhevm/sdk`, `fhevm` (deprecated or never existed).

Peer-dep caveat: `@zama-fhe/sdk@3.0.0` declares `@zama-fhe/relayer-sdk: ~0.4.2` as a regular dep, while `@fhevm/hardhat-plugin@0.4.2` and `@fhevm/mock-utils@0.4.2` peer-pin `0.4.1` exact. Installing the new SDK alongside the toolchain produces a peer warning. If lockfile resolution hoists `0.4.2`, the toolchain runtime-aborts - pin `@zama-fhe/relayer-sdk: 0.4.1` in `package.json` `overrides` to force `0.4.1` to win.

## Findings (reviews / audits)

Every finding carries three labels:

- **Confidence** (0-100): `DEFINITE BUG` (>=95), `LIKELY ISSUE` (80-94), `PROBABLE ISSUE` (70-79), `SUGGESTION` (40-69), `NOTE` (<40).
- **Severity**: Critical / High / Medium / Low / Info.
- **Remark**: Exploitable / Needs Review / Design Choice / False Positive / Hardening.

Scoring rubric, report template, the 32 FHE patterns, and the 29 general Solidity patterns live under `.agents/skills/zama-skill/references/`.

## Code style

Block comments only (`/* */`, `/** */`); never `//` or `///`. Plain ASCII (no em / en dashes, no rocket or warning emoji). Every source file opens with `@file` + `@description`. Section dividers are asterisk boxes `/*************** Name ***************/`. Every external / public function carries NatSpec. Full rules in `.agents/skills/zama-skill/references/code-style.md`.

## Where workflows live

The seven workflows (Generate / Review / Test / Deploy / Audit / Build Frontend (legacy primitives) / Build with the New `@zama-fhe/sdk@^3` Token API), the two-layer verification protocol, HCU cost tables, the full anti-pattern catalog (62 verified mistakes including new-SDK ones), the mainnet API-key auth pattern, and the parallel seven-module audit orchestration live in `.agents/skills/zama-skill/SKILL.md` and the `references/` directory next to it. Open that file and follow its workflow-selection logic.

New-SDK reference files (`@zama-fhe/sdk@^3.0.0` and `@zama-fhe/react-sdk@^3.0.0`):

- `references/zama-sdk-overview.md` - package map, `ZamaSDK` constructor, network presets
- `references/zama-sdk-auth-storage.md` - relayer transports, signers, storage, web extensions, backend proxy, three `auth` shapes, `RelayerCleartext` for local dev
- `references/zama-sdk-tokens.md` - `Token` / `ReadonlyToken`, shield / unshield (resumable two-phase) / confidentialTransfer / balanceOf, batch decrypt
- `references/zama-sdk-session.md` - session model, TTLs, `allow` / `userDecrypt` / `revokeSession`, full delegated decryption API
- `references/zama-sdk-react.md` - `ZamaProvider`, 59 React hooks, Next.js SSR, Vite, `zamaQueryKeys`
- `references/zama-sdk-errors.md` - 26 error classes (`ZamaError` base + 25 subclasses), `matchZamaError`, recovery flows
- `references/zama-sdk-activity.md` - activity feeds, event decoders, `WrappersRegistry`, contract builders, operator approvals, FHE artifact cache

## Other tools using this repository

- Claude Code reads `.claude/CLAUDE.md` and `.claude/skills/zama-skill/`.
- Cursor reads `.cursor/rules/fhevm-*.mdc` and `.cursor/references/`.
- Windsurf reads `.windsurfrules` at the project root and the same `.agents/skills/zama-skill/` tree.
- All trees ship the same references, templates, review modules, and `scripts/fhe-lint.js`. Each agent should read only from its own tree.
