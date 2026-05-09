# FHE Vulnerability Patterns (P1-P32)

## Contents

- Category 1: Encrypted State Corruption
- Category 2: ACL Permission Gaps
- Category 3: Decryption Flow Vulnerabilities
- Category 4: Type System and Operation Violations
- Category 5: Confidentiality Boundary Violations
- Category 6: Cross-Contract and Integration Risks
- Category 7: FHEVM-Specific Logic Errors

> Vulnerability patterns specific to FHE smart contracts.
> Each pattern: **V:** vulnerability, **Safe when:** false-positive indicators, **Proof requires:** minimum evidence to confirm.

---

## Category 1: Encrypted State Corruption

**P1. Self-Transfer Balance Inflation**

- **V:** When `from == to` in a transfer, the contract computes `newFrom = balance - amount` and `newTo = balance + amount` from the ORIGINAL balance. Since both map to the same storage slot, `_balances[to] = newTo` overwrites `_balances[from] = newFrom`. Result: `balance = original + amount` - tokens created from nothing.
- **Safe when:** Explicit `require(from != to)` or `revert SelfTransfer()` guard before any balance computation. Or single-write pattern that computes net change.
- **Proof requires:** Show both storage writes target the same slot and the second overwrites the first.

**P2. Stale Handle Reference After Reassignment**

- **V:** A local variable holds a handle to an encrypted value. The underlying storage is then updated (reassigned to a new FHE computation result). The local variable still points to the old handle, which is now stale. Operations on the stale handle produce results based on the old value, not the current state.
- **Safe when:** Local variable is reassigned after storage update, or the function reads storage only once and operates on the local copy throughout.
- **Proof requires:** Show the local variable is used after the storage slot it references has been overwritten.

**P3. Uninitialized Handle in Arithmetic**

- **V:** An `euint*` mapping entry that was never written has handle `0x000...0`. Performing `FHE.add(uninitializedHandle, amount)` does not revert - it silently creates an encrypted zero and adds to it. This can mask missing initialization logic or allow operations on accounts that should not yet exist.
- **Safe when:** `require(FHE.isInitialized(handle))` guard before arithmetic, or the zero-default behavior is intentional and documented.
- **Proof requires:** Show a code path where an uninitialized mapping entry is used in an FHE operation without an initialization check.

**P4. Double-Spend via Concurrent Handle References**

- **V:** Two functions read the same encrypted balance into separate local handles, perform independent modifications, and write back. The second write overwrites the first. In single-transaction context this requires reentrancy; in multi-transaction context it requires understanding that each tx reads fresh state.
- **Safe when:** `nonReentrant` modifier on all external functions that modify encrypted balances, or no external calls between balance read and write.
- **Proof requires:** Show a reentrant call path where the balance is read, an external call is made, and the pre-call balance is used for the write-back.

**P5. Encrypted Overflow Without Guard**

- **V:** FHE arithmetic wraps silently on overflow (no revert). `FHE.add(nearMaxValue, amount)` wraps to a small number. Unlike Solidity 0.8+ checked arithmetic, this is by design - but contracts that assume "add always increases" will have broken invariants.
- **Safe when:** The contract uses `FHE.le()` + `FHE.select()` to guard against overflow before the operation, or the domain makes overflow impossible (e.g., token with capped supply fitting in euint64).
- **Proof requires:** Show concrete values where the add/mul wraps and produces a state violation (e.g., balance decreases after a deposit).

---

## Category 2: ACL Permission Gaps

**P6. Missing `allowThis()` After Stored Computation**

- **V:** A new encrypted result is stored in contract state without calling `FHE.allowThis(result)`. The contract loses access to the handle in subsequent transactions. Any function that reads this handle in a later tx reverts with the custom error `SenderNotAllowed(address)` from `@fhevm/host-contracts/contracts/ACL.sol:106`.
- **Safe when:** Every code path that stores an encrypted value into state calls `FHE.allowThis()` on that value before the function returns.
- **Proof requires:** Trace a stored encrypted value from computation to storage, showing no `FHE.allowThis()` call on any code path.

**P7. Missing `allow()` for User Decryption**

- **V:** An encrypted value is stored and `allowThis()` is called, but `FHE.allow(result, user)` is never called. The user cannot decrypt their own data (e.g., their balance). The contract functions correctly but the user has no way to read their encrypted values.
- **Safe when:** Every value a user should be able to decrypt has a corresponding `FHE.allow(result, userAddress)` call.
- **Proof requires:** Show a stored encrypted value that a user should be able to decrypt, with no `FHE.allow()` granting access to that user.

**P8. ACL Not Updated After Balance Transfer**

- **V:** After a transfer, the sender's new balance handle changes but `FHE.allow(newBalance, sender)` is not called. The sender can no longer decrypt their own updated balance. Similarly, if the recipient's `allow()` uses the wrong address or handle.
- **Safe when:** Both sender and recipient get `FHE.allow()` on their respective new balance handles after transfer.
- **Proof requires:** Show a transfer function where either party's new balance lacks an `allow()` call.

**P9. `allowTransient()` Used Where `allowThis()` Is Needed**

- **V:** `FHE.allowTransient(result, address)` grants access only within the current transaction. If the result is stored in contract state for future use, the contract needs `allowThis()` (permanent) not `allowTransient()` (expires at tx end). Using `allowTransient()` for stored values means the next transaction will fail with ACL errors.
- **Safe when:** `allowTransient()` is only used for values passed to another contract within the same transaction (cross-contract calls), never for values stored in mappings or state variables.
- **Proof requires:** Show an `allowTransient()` call on a value that is also stored in contract state.

**P10. Missing ACL on Conditional Branch**

- **V:** An `FHE.select()` produces two possible results, but only one code path calls `allowThis()`. Or a function has an early return that skips the ACL calls. The unhandled path stores a value without proper permissions.
- **Safe when:** `allowThis()` and `allow()` are called after the `FHE.select()` on the final result (which covers both branches), not inside conditional logic.
- **Proof requires:** Show a code path (early return, error path, or conditional branch) where a stored encrypted value bypasses ACL calls.

---

## Category 3: Decryption Flow Vulnerabilities

**P11. Handle Order Mismatch in `checkSignatures`**

- **V:** The `handles[]` array passed to `FHE.checkSignatures()` must match the exact order used in the off-chain `publicDecrypt()` call. If the order differs, the proof verification fails and the transaction reverts. This is cryptographically binding - there is no tolerance for reordering.
- **Safe when:** The contract maintains a deterministic handle ordering (e.g., array index, sequential storage) and the off-chain code uses the same ordering.
- **Proof requires:** Show that the handle array construction in `checkSignatures` could differ from the `publicDecrypt` call order (e.g., dynamic array manipulation, conditional inclusion).

**P12. `makePubliclyDecryptable` on Sensitive Data**

- **V:** `FHE.makePubliclyDecryptable(handle)` is permanent and irreversible. Once called, anyone can decrypt the value forever. If called on a balance, vote, bid, or other sensitive data before the appropriate reveal time, confidentiality is permanently lost.
- **Safe when:** Only called on values that are meant to be public (e.g., election results after voting ends, auction winner after bidding closes). Protected by a time/phase gate.
- **Proof requires:** Show `makePubliclyDecryptable` called on a value that should remain confidential, or called without a phase/time guard.

**P13. Missing Replay Protection on Finalization**

- **V:** A function calls `FHE.checkSignatures()` to finalize a decrypted result but has no guard against being called multiple times with the same proof. An attacker could replay the finalization to trigger side effects (e.g., double-claiming rewards).
- **Safe when:** A boolean flag, nonce, or state transition prevents the same finalization from executing twice. Or `checkSignatures` is idempotent (sets state to the same value).
- **Proof requires:** Show `checkSignatures` in a function with no replay guard and with non-idempotent side effects.

**P14. Premature Decryption Request**

- **V:** A contract calls `makePubliclyDecryptable` before all participants have submitted their encrypted inputs. In an auction or voting scenario, this could reveal partial results and influence remaining participants.
- **Safe when:** Decryption is gated behind a participation threshold, deadline, or explicit phase transition that ensures all inputs are final.
- **Proof requires:** Show a code path where `makePubliclyDecryptable` can execute before the input collection phase is complete.

---

## Category 4: Type System and Operation Violations

**P15. Cross-Type `FHE.select()` Mismatch**

- **V:** `FHE.select(ebool, euint8, euint64)` fails to compile. Unlike `FHE.add()` which has 35 overloads supporting mixed types with auto-upcast, `FHE.select()` requires EXACT same type for both branches. This is the #1 source of unexpected compilation errors.
- **Safe when:** Both branches of `FHE.select()` are the same encrypted type. If mixing types, explicit cast with `FHE.asEuint64()` on the narrower operand.
- **Proof requires:** Show `FHE.select()` called with different encrypted types in the two branch positions.

**P16. Encrypted Divisor in `FHE.div()` or `FHE.rem()`**

- **V:** `FHE.sol` ships only `(euint8..euint128, uintN)` overloads of `div`/`rem` (no `euint256` div/rem and no encrypted-divisor variant). Passing an encrypted RHS is a Solidity compile error: `Member "div" not found ... after argument-dependent lookup in type(library FHE)`. There is no low-level path to bypass it from Solidity. A *plaintext* divisor of zero, in contrast, IS a runtime revert raised by `FHEVMExecutor` with the custom error `DivisionByZero()` (see `FHEVMExecutor.sol:232,253`) - not EVM `Panic(0x12)`.
- **Safe when:** The divisor is a Solidity literal, constant, or `uint` variable - never an encrypted type - AND the contract guards against a zero divisor before calling.
- **Proof requires:** Show `FHE.div()` or `FHE.rem()` invoked with an encrypted right-hand operand, OR a plaintext divisor that can reach zero with no guard.

**P17. Non-Power-of-2 Bounded Random**

- **V:** `FHE.randEuint32(upperBound)` requires `upperBound` to be a power of 2. The FHEVMExecutor enforces this with `_isPowerOfTwo()` check and reverts with `NotPowerOfTwo()` if violated. This is a runtime revert, not a compilation error.
- **Safe when:** Upper bound is a compile-time constant that is a power of 2 (1, 2, 4, 8, 16, 32, 64, 128, 256...). For non-power-of-2 ranges, use `FHE.rem(FHE.randEuint32(nextPowerOf2), desiredRange)`.
- **Proof requires:** Show `FHE.randEuintX(N)` where N is not a power of 2.

**P18. Using `euint160` Instead of `eaddress`**

- **V:** `euint160` is declared in `EncryptedTypes.sol` but `FHE.sol` has ZERO functions for it - no arithmetic, no comparison, no select, no conversion. Any code using `euint160` will fail to find matching FHE functions. The correct type for 160-bit encrypted values is `eaddress`.
- **Safe when:** Code uses `eaddress` for all 160-bit encrypted address values. `euint160` does not appear in any function signatures or variable declarations.
- **Proof requires:** Show `euint160` used in a variable declaration, function parameter, or FHE operation.

**P19. Signed Integer Types (`eint*`)**

- **V:** All 32 signed aliases `eint8`..`eint256` (and matching `externalEint*`) ARE declared as `bytes32` UDVTs in `encrypted-types/EncryptedTypes.sol`, so a bare `eint64 x;` compiles. However `@fhevm/solidity@0.11.1` ships ZERO `FHE.*` overloads for any of them (verified by grep). The first FHE call site fails with `Member "<op>" not found ... after argument-dependent lookup in type(library FHE)`. Treat the type as unusable.
- **Safe when:** Only unsigned encrypted types are used (`ebool`, `euint8`, `euint16`, `euint32`, `euint64`, `euint128`, `euint256`, `eaddress`).
- **Proof requires:** Show `eint*` used as a function parameter, return type, state variable, OR passed to any `FHE.*` call.

---

## Category 5: Confidentiality Boundary Violations

**P20. Information Leak via Revert Conditions**

- **V:** Using plaintext conditions derived from encrypted comparisons to decide whether to revert. `ebool` is a `bytes32` UDVT, so `require(FHE.le(a, b))` is a Solidity compile error - but if a developer works around this by decrypting first and then reverting, the revert/success pattern leaks information about encrypted values. (The same leakage occurs if the dev unwraps the handle and gates on non-zero - the check always passes, but the mere act of decrypting+branching can leak.)
- **Safe when:** All encrypted conditional logic uses `FHE.select()` with both branches succeeding (no revert). Revert conditions only check plaintext values (addresses, timestamps, phase flags).
- **Proof requires:** Show a code path where an encrypted value is decrypted within the same transaction and used to decide whether to revert.

**P21. Information Leak via Event Parameters**

- **V:** Emitting encrypted handles in events does not leak data (handles are opaque). But emitting derived plaintext values (e.g., `emit Transfer(from, to, decryptedAmount)`) reveals confidential information on-chain.
- **Safe when:** Events emit only non-sensitive data (addresses, timestamps, phase transitions) or opaque handles. No decrypted values appear in event parameters.
- **Proof requires:** Show an event emission containing a value derived from decryption of confidential data.

**P22. Gas-Based Side Channel**

- **V:** FHE operations have variable gas costs depending on the operation and type size. If a function's execution path varies based on encrypted values (through `FHE.select`), and different paths have measurably different gas consumption, an observer can infer information about encrypted state by watching gas usage.
- **Safe when:** Both branches of all `FHE.select()` calls perform the same set of FHE operations (same number and types). Or the contract is designed for public knowledge of the branch taken.
- **Proof requires:** Show `FHE.select()` where one branch performs significantly more/fewer FHE operations than the other, and the choice leaks sensitive information.

**P23. Timestamp/Block-Based Correlation**

- **V:** If encrypted operations (e.g., bids in a sealed auction) are submitted one at a time, an observer can correlate the submitter's address and timestamp with the position in an encrypted array. When results are later revealed, position correlation reveals who submitted what.
- **Safe when:** Multiple submissions are batched, or reveal order is randomized, or the application does not require hiding which participant submitted which value.
- **Proof requires:** Show a sequential submission pattern where position in storage directly maps to submission order, and later reveal exposes position-value pairs.

---

## Category 6: Cross-Contract and Integration Risks

**P24. `allowTransient` Expiry in Multi-Hop Calls**

- **V:** `FHE.allowTransient(handle, contractB)` grants access only for the current transaction. If Contract B stores the handle and tries to use it in a subsequent transaction, it fails. This is correct behavior but a common integration mistake when building composable FHE protocols.
- **Safe when:** The receiving contract calls `FHE.allowThis(handle)` on any value it intends to store. `allowTransient` is only used for "pass-through" values consumed within the same tx.
- **Proof requires:** Show Contract A granting `allowTransient` to Contract B, and Contract B storing the handle in state without calling `allowThis`.

**P25. Operator Pattern Without Encrypted Allowance**

- **V:** An ERC-20-style approval system uses plaintext allowances (`mapping(address => mapping(address => uint256))`). The approved amount is visible on-chain, breaking confidentiality. An observer knows exactly how many tokens each spender is authorized to transfer.
- **Safe when:** Allowances use encrypted types (`mapping(address => mapping(address => euint64))`), or the application intentionally uses a simpler operator model (`bool` approved/not) that does not reveal amounts.
- **Proof requires:** Show a plaintext `uint256` allowance mapping in a contract that otherwise keeps balances encrypted.

**P26. Front-Running Encrypted Input Submission**

- **V:** Encrypted inputs submitted via `externalEuint*` + `inputProof` are opaque - the value is hidden. But the TRANSACTION itself is visible in the mempool. A miner/validator can observe the tx, infer its purpose (e.g., "this is a bid in the auction"), and submit their own tx first or reorder.
- **Safe when:** The application uses commit-reveal with encrypted inputs (commit the encrypted value, reveal in a separate phase), or front-running does not confer advantage because values are hidden.
- **Proof requires:** Show a scenario where transaction ordering affects outcomes and a front-runner can benefit from reordering despite not knowing encrypted values.

**P27. Callback Trust Assumption in Decryption Flow**

- **V:** The 3-step public decryption flow (makePubliclyDecryptable -> off-chain publicDecrypt -> checkSignatures) relies on an off-chain relayer to submit the decryption proof. If the relayer is untrusted or censoring, decryption may never complete, leaving the contract in a stuck state.
- **Safe when:** The contract has a timeout mechanism that resolves the pending decryption (e.g., default outcome after deadline). Or multiple independent relayers can submit the proof.
- **Proof requires:** Show a decryption-dependent state transition with no timeout/fallback if the relayer fails to submit.

---

## Category 7: FHEVM-Specific Logic Errors

**P28. Encrypted Comparison Used as Plaintext Guard**

- **V:** `FHE.le(a, b)` returns `ebool` (`type ebool is bytes32` UDVT). Using it directly in `require()`, `if()`, or `assert()` is a Solidity compile error - UDVTs do not auto-convert to `bool` (`TypeError: No matching declaration found ... Candidate: function require(bool)`). The vulnerable shape is when a developer routes around this by unwrapping to a primitive (`ebool.unwrap(r) != bytes32(0)`, casting via `bytes32`, or any other extraction of the handle to a primitive) and then gating on the unwrapped value - the handle is always non-zero so the check always passes and provides no actual protection.
- **Safe when:** Encrypted comparisons are used exclusively with `FHE.select()` for conditional logic. `require`/`if`/`assert` only use `FHE.isAllowed()`, `FHE.isInitialized()`, `FHE.isSenderAllowed()`, `FHE.isPubliclyDecryptable()`, or `FHE.isPublicDecryptionResultValid()` (returns plaintext bool, intended for require-wrapping per `FHE.sol:9512-9520`).
- **Proof requires:** Show `require(FHE.xx(...))`, `if(FHE.xx(...))`, or `assert(FHE.xx(...))` where `xx` is NOT one of `isAllowed`, `isInitialized`, `isSenderAllowed`, `isPubliclyDecryptable`, or `isPublicDecryptionResultValid`.

**P29. `fromExternal` vs `asEuint` Confusion**

- **V:** `FHE.asEuintXX(N)` (verified: `FHE.sol:8536` for `asEuint8(uint8)`, `:8614` for `asEuint64(uint64)`, etc.) converts a Solidity literal / `uintN` variable into a *trivial encryption* with no proof. `FHE.fromExternal(extHandle, inputProof)` (`FHE.sol:8494-8676`, eight overloads) is the only API that ingests a user-submitted encrypted input + ZK proof; it grants TRANSIENT ACL only via `Impl.allowTransient(result, msg.sender)`. There is NO `FHE.asEuintXX(externalEuintX, bytes)` overload - that call is a Solidity compile error. The actual vulnerable shape is treating an `externalEuintX` as a regular `euintX` (for instance accidentally re-declaring the param without the `external` prefix), or skipping `fromExternal` and reusing a previously-allowed handle without checking the ACL flow - the ZK proof never runs for fresh inputs.
- **Safe when:** Every parameter receiving a fresh user encryption is declared `externalEuintXX` + `bytes calldata inputProof` and converted exactly once at the function boundary via `FHE.fromExternal(extHandle, inputProof)`. Plaintext literals/variables stay on `FHE.asEuintXX(N)`.
- **Proof requires:** Show an `externalEuintX` flowing into an FHE op without going through `FHE.fromExternal`, OR `inputProof` empty/uninitialized while the input handle has not been previously `allow`-ed to `msg.sender`.

**P30. Conservation Law Violation in Encrypted Token**

- **V:** In a standard ERC-20, `totalSupply == sum(balances)` is enforced by checked arithmetic. In an encrypted ERC-20, balances are encrypted and arithmetic wraps silently. There is no built-in enforcement of conservation laws because the contract cannot see the actual values.
- **Safe when:** The contract maintains a plaintext `totalSupply` that is updated on mint/burn and uses `FHE.select()` to ensure transfers are zero-sum. Or the application does not require strict conservation.
- **Proof requires:** Show a mint, burn, or transfer path where the encrypted balance changes do not mathematically correspond to a conservation law, and no plaintext tracking enforces it.

**P31. Encrypted Accumulator Drift**

- **V:** An encrypted accumulator (e.g., total staked, total votes) is updated incrementally via `FHE.add()` and `FHE.sub()`. Over many operations, the wrapping arithmetic can accumulate rounding drift or wrap-around errors that make the accumulator diverge from the true sum of individual values.
- **Safe when:** The accumulator type is wide enough for the expected range (e.g., `euint128` for a sum of `euint64` values). Or the accumulator is periodically recomputed from individual values.
- **Proof requires:** Show an accumulator updated incrementally without overflow protection, where the domain allows values large enough to wrap.

**P32. Phase Transition Allowing Late Submission**

- **V:** In a multi-phase protocol (e.g., sealed auction: bidding -> reveal -> settlement), the phase transition is controlled by a plaintext flag or timestamp. If the transition check and the encrypted input submission are not atomic, a participant can observe the phase change transaction in the mempool and submit a late encrypted input in the same block.
- **Safe when:** Phase transitions use `block.timestamp` or `block.number` with strict `<` (not `<=`), or the submission function checks the phase AFTER processing the input, or a commit-reveal pattern makes late submission useless.
- **Proof requires:** Show a phase-gated function where the phase check could be bypassed by same-block transaction ordering.
