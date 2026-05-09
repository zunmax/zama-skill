# FHEVM rules for Claude Code

This file configures Claude Code for any project that touches Zama FHEVM v0.11. It answers three questions: **what** environment you are in, **why** the defaults differ from generic Solidity, and **how** to do the first two actions on every FHEVM task.

## Activation (WHAT)

Apply this file whenever any of the following is true:

- The file imports `@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@fhevm/mock-utils`, `@zama-fhe/relayer-sdk` (legacy primitives), `@zama-fhe/sdk` (new high-level SDK v3+), `@zama-fhe/react-sdk` (new React hooks v3+), or `@openzeppelin/confidential-contracts`. Sub-paths count: `@zama-fhe/sdk/node`, `@zama-fhe/sdk/viem`, `@zama-fhe/sdk/ethers`, `@zama-fhe/sdk/cleartext`, `@zama-fhe/sdk/query`, `@zama-fhe/react-sdk/wagmi`, plus the legacy `@zama-fhe/relayer-sdk/web|bundle|node`.
- The code declares or operates on `euint8`-`euint256`, `ebool`, `eaddress`, `externalEuint*`.
- The contract inherits `ZamaEthereumConfig` (the only current Solidity base), or any legacy `SepoliaConfig` / `MainnetConfig` Solidity base from a pre-v0.9 codebase that should be migrated. (Note: `MainnetConfig` and `SepoliaConfig` exist as TS exports in `@zama-fhe/relayer-sdk/web` AND `@zama-fhe/sdk` - those are SDK config constants for the *frontend*, not Solidity contracts.)
- The code uses any of the new-SDK identifiers: `ZamaSDK`, `ZamaProvider`, `RelayerWeb`, `RelayerNode`, `RelayerCleartext`, `ViemSigner`, `EthersSigner`, `WagmiSigner`, `GenericSigner`, `Token`, `ReadonlyToken`, `WrappersRegistry`, `IndexedDBStorage`, `MemoryStorage`, `ChromeSessionStorage`, `matchZamaError`, `zamaQueryKeys`, `TOKEN_TOPICS`, `ACL_TOPICS`; or any of the 59 React hooks (e.g. `useShield`, `useUnshield`, `useUnshieldAll`, `useResumeUnshield`, `useConfidentialBalance`, `useConfidentialBalances`, `useConfidentialTransfer`, `useConfidentialTransferFrom`, `useConfidentialApprove`, `useConfidentialIsApproved`, `useAllow`, `useIsAllowed`, `useRevoke`, `useRevokeSession`, `useEncrypt`, `useUserDecrypt`, `usePublicDecrypt`, `useGenerateKeypair`, `useDelegateDecryption`, `useRevokeDelegation`, `useDelegationStatus`, `useDecryptBalanceAs`, `useBatchDecryptBalancesAs`, `useActivityFeed`, `useToken`, `useReadonlyToken`, `useMetadata`, `useUnderlyingAllowance`, `useWrapperDiscovery`, `useWrappersRegistryAddress`, `useListPairs`, `useTokenPair*`, `useConfidentialTokenAddress`, `useTokenAddress`, `useIsConfidentialTokenValid`, `useUnwrap`, `useUnwrapAll`, `useFinalizeUnwrap`).
- The user mentions FHEVM, Zama, TFHE, confidential contracts, encrypted balances, homomorphic or privacy-preserving anything, a Zama-style dApp frontend, the relayer SDK, ERC-7984, shielding / unshielding tokens, confidential transfers, the Zama Protocol, or the wrappers registry.
- The error text mentions any FHEVM custom error: ACL (`SenderNotAllowed`, `ACLNotAllowed`, `SenderNotAllowedToUseHandle`), input verification (`InvalidInputHandle`, `EmptyInputProof`, `DeserializingInputProofFail`), KMS decrypt (`InvalidKMSSignatures`, `KMSInvalidSigner`, `EmptyDecryptionProof`), runtime (`DivisionByZero`, `NotPowerOfTwo`, `ZamaProtocolUnsupported`), or HCU (`HCUTransactionLimitExceeded`, `HCUTransactionDepthLimitExceeded`); or WASM / COOP / COEP problems in an FHEVM context. (Note: `KMSInvalidSigner(address)` is raised by `KMSVerifier.sol:22` when the recovered signer is not a registered KMS signer - this is what you hit at runtime when `checkSignatures` is called with a swapped/incorrect cts order; `InvalidKMSSignatures()` at `FHE.sol:71/9502` is the FHE-library-level wrapper error reachable when `_verifySignatures` returns false without reverting first. `HCUTransactionDepthLimitExceeded()` and `HCUTransactionLimitExceeded()` come from `HCULimit.sol:22,25` when the per-tx 20M HCU total or 5M depth limit is exceeded.)

If none of the above applies, ignore this file.

## Why FHEVM is different (WHY)

- Contracts operate on opaque `bytes32` handles, not on ciphertexts. The coprocessor does the FHE math off-chain.
- You cannot branch on an encrypted value. `require(ebool)` and `if (ebool)` are Solidity compile errors (UDVT does not auto-convert to `bool`); the vulnerable shape is when a developer unwraps the handle to a primitive (`ebool.unwrap(r) != bytes32(0)`) - the handle is always non-zero so the check always passes. Use `FHE.select` for conditional logic.
- Every encrypted value has an ACL. Missing `allowThis` loses the handle next transaction. Missing `allow(user)` makes decryption revert.
- FHEVM had 32 documented breaking changes between v0.8 and v0.9; v0.10 / v0.11 added further additive deltas (event shapes, `inferredTotalSupply`, interface IDs). The skill targets v0.11. Docs and training knowledge drift; installed source is the only reliable oracle.

These four facts make FHEVM behave unlike any Solidity codebase in your training data. Treat every function name, address, URL, and ACL call as suspect until verified against installed source.

## First two actions on every FHEVM task (HOW)

1. **Load `.claude/skills/zama-skill/SKILL.md`** and follow its workflow-selection logic. The skill auto-activates on the triggers above. Do not skip it.
2. **Load `.claude/skills/zama-skill/references/anti-patterns.md`**. It lists 62 verified mistakes AI agents repeat when writing FHEVM code. Skipping this is the single biggest cause of broken output.

Third action on reviews or audits: load `references/finding-validation.md` + `references/report-format.md` so every finding carries Confidence, Severity, and Remark tags.

## Trust hierarchy

```
installed source > skill references > Zama docs > training knowledge
```

Installed source lives under `node_modules/@fhevm/solidity/`, `node_modules/@zama-fhe/relayer-sdk/`, and `node_modules/@fhevm/hardhat-plugin/`. On any conflict, source wins and the skill reference is wrong.

## Never generate this code

The following patterns are v0.8 (removed), renamed in v0.9, or never existed. Reject them in your own output and flag them during review.

- `TFHE.*` - the library is `FHE`. `TFHE` does not compile.
- `SepoliaConfig` as a Solidity base class - removed in v0.9. Use `ZamaEthereumConfig`. (The same name in the relayer SDK is unrelated and still correct.)
- `FHE.requestDecryption`, `GatewayCaller`, `FHE.verifySignatures` - removed or renamed in v0.9. (`FHE.allowForDecryption` never existed as a library helper - use `FHE.makePubliclyDecryptable`. The host-contract API `IACL.allowForDecryption(bytes32[])` does still exist at `@fhevm/host-contracts/contracts/ACL.sol:209`; `makePubliclyDecryptable` wraps it for the single-handle path via `Impl.sol:742`.)
- `FHE.neq`, `FHE.lte`, `FHE.gte` - use `FHE.ne`, `FHE.le`, `FHE.ge`.
- `fhevmjs`, `@fhevm/sdk`, `@zama-ai/fhevm`, bare `fhevm` - deprecated or never existed. For low-level primitives, use `@zama-fhe/relayer-sdk` with the `/web`, `/bundle`, or `/node` sub-path. For high-level token / shield / unshield / transfer flows, use `@zama-fhe/sdk@^3.0.0` (or `@zama-fhe/react-sdk@^3.0.0` for React).
- `require(FHE.le(...))` or any `if`/`assert` on an encrypted result - `ebool` is a `bytes32` UDVT, no implicit `bool` conversion, so this is a Solidity compile error. The bug to flag is when a developer routes around it by unwrapping (`ebool.unwrap(r) != bytes32(0)`) - the handle is always non-zero so the check always passes. Use `FHE.select`.
- `FHE.asEuintXX(extBytes, proof)` for user input - use `FHE.fromExternal(extBytes, proof)`. `FHE.asEuintXX(literal)` is for plaintext literals only.
- Signed types `eint8`-`eint256` *are* declared as `bytes32` user-defined types in `encrypted-types/EncryptedTypes.sol` (transitively imported by `@fhevm/solidity/lib/FHE.sol`), so `eint64 x;` compiles. They are unusable in practice: `@fhevm/solidity@0.11.1` ships zero `FHE.*` overloads for them. The first call site (e.g. `FHE.add(eint64,eint64)`) fails with `Member "add" not found ... after argument-dependent lookup in type(library FHE)`.
- `FHE.div(x, y)` / `FHE.rem(x, y)` with an *encrypted* `y` is a Solidity *compile error* (`Member "div" not found ... after argument-dependent lookup`); only the `(euint*, uintN)` plaintext-divisor overload exists. At runtime, `FHE.div(x, 0)` reverts with the custom error `DivisionByZero()` raised by `FHEVMExecutor` (not `Panic(0x12)`).

Before delivering any FHEVM code, grep your own output against the full deprecated-pattern list in `references/anti-patterns.md`. Zero matches is the pass condition.

## ACL is not optional

Every stored encrypted value needs two calls, or it breaks:

- `FHE.allowThis(value)` after storing - without it the contract cannot touch the handle next transaction.
- `FHE.allow(value, user)` - without it the user's decrypt reverts with `SenderNotAllowed(address)` (custom error from `@fhevm/host-contracts/contracts/ACL.sol:106`).

Missing ACL is the most common defect in generated code. Trace every stored encrypted value end-to-end before delivering.

## Public decryption is a 3-step flow

1. On-chain: `FHE.makePubliclyDecryptable(handle)`.
2. Off-chain (dApp): `await instance.publicDecrypt([handle])`, then read `results.clearValues[handle]`.
3. On-chain: `FHE.checkSignatures(cts, abi.encode(clearValue), proof)`. The `cts` order MUST match the order passed to `publicDecrypt`. Swapping handles reverts.

## Ask first

Do not decide any of these unilaterally:

- Public vs user decryption (the visibility model differs).
- Encrypted-integer bit width above `euint64` (HCU and gas cost rise sharply).
- Replay protection on finalization functions.
- ERC-7984 standard vs custom confidential ERC-20.

## Where to find detail

- Full workflows (Generate / Review / Test / Deploy / Audit / Frontend on legacy SDK / Frontend on new `@zama-fhe/sdk@^3` Token API): `.claude/skills/zama-skill/SKILL.md`
- Types, operations, HCU costs: `.claude/skills/zama-skill/references/types-operations.md`
- ACL patterns: `.claude/skills/zama-skill/references/acl.md`
- Input handling and decryption flows (legacy `@zama-fhe/relayer-sdk` primitives): `.claude/skills/zama-skill/references/inputs-decryption.md`
- ERC-7984 confidential tokens (Solidity layer): `.claude/skills/zama-skill/references/erc7984.md`
- Hardhat testing: `.claude/skills/zama-skill/references/testing.md`
- Frontend / relayer SDK (incl. COOP/COEP, mainnet API-key auth, browser bundler quirks): `.claude/skills/zama-skill/references/frontend.md`
- Deployment (Hardhat only, Path A recommended, Path B uses `hardhat-deploy`): `.claude/skills/zama-skill/references/deployment.md`
- Audit patterns P1-P32: `.claude/skills/zama-skill/references/fhe-vulnerabilities.md`
- General Solidity attack vectors G1-G29: `.claude/skills/zama-skill/references/solidity-vulnerabilities.md`
- Contract templates: `.claude/skills/zama-skill/templates/`
- Parallel audit modules: `.claude/skills/zama-skill/review-modules/`

### New SDK (`@zama-fhe/sdk@^3.0.0` and `@zama-fhe/react-sdk@^3.0.0`)

- Overview, package map, `ZamaSDK` constructor, network presets: `.claude/skills/zama-skill/references/zama-sdk-overview.md`
- Auth (backend proxy + 3 `auth` shapes + CSRF), `RelayerWeb` / `RelayerNode` / `RelayerCleartext`, signer adapters, storage (IndexedDB / Memory / AsyncLocal / ChromeSession), web-extension setup: `.claude/skills/zama-skill/references/zama-sdk-auth-storage.md`
- `Token` / `ReadonlyToken`, shield / unshield (resumable two-phase) / `confidentialTransfer` / balance: `.claude/skills/zama-skill/references/zama-sdk-tokens.md`
- Session model (keypairTTL / sessionTTL), `allow` / `userDecrypt` / `revokeSession`, full delegation API: `.claude/skills/zama-skill/references/zama-sdk-session.md`
- `ZamaProvider`, 59 React hooks grouped by category, Next.js SSR, Vite, web extensions, `zamaQueryKeys` cache control: `.claude/skills/zama-skill/references/zama-sdk-react.md`
- Error taxonomy (26 classes: `ZamaError` base + 25 subclasses), `matchZamaError` patterns, common recovery flows: `.claude/skills/zama-skill/references/zama-sdk-errors.md`
- Activity feeds + event decoders (token + ACL), `WrappersRegistry`, contract builders, operator approvals deep dive, FHE artifact cache: `.claude/skills/zama-skill/references/zama-sdk-activity.md`

The new SDK is a SUPERSET built on top of `@zama-fhe/relayer-sdk@0.4.1` (it re-exports types from `@zama-fhe/relayer-sdk/bundle`). Both packages still ship; the contract toolchain (`@fhevm/mock-utils@0.4.2`, `@fhevm/hardhat-plugin@0.4.2`) still requires `@zama-fhe/relayer-sdk@0.4.1` exact as a transitive install. The new SDK requires `node >= 22`.
