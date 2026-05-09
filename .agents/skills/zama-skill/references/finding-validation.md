# Finding Validation

## Contents

- Gate 1 - Refutation
- Gate 2 - Reachability
- Gate 3 - Trigger
- Gate 4 - Impact
- Confidence Scoring
- Confidence -> Severity -> Remark (assign all three)
- Single-Pass Gate Evaluation Protocol
- Safe Patterns (Do Not Flag)
- Composite Chains
- Lead Promotion
- Leads
- Do Not Report

Every finding passes four sequential gates. Fail any gate = **rejected** or **demoted** to lead. Later gates are not evaluated for rejected findings.

## Gate 1 - Refutation

Construct the strongest argument that the finding is wrong. Find the guard, check, or constraint that blocks the claimed attack - quote the exact line and trace how it stops the claimed step.

- Concrete refutation (specific guard blocks the exact claimed step) -> **REJECTED** (or **DEMOTE** if code smell remains)
- Speculative refutation ("the developer probably intended...") -> **clears**, continue

**FHE-specific refutation patterns:**
- `FHE.select()` already handles both branches safely -> refutes invariant violation claims
- `require(FHE.isInitialized(...))` guard exists -> refutes uninitialized handle claims
- `require(from != to)` guard exists -> refutes self-transfer claims
- `FHE.allowThis()` is called on the final stored value -> refutes ACL gap claims (even if called after `select`, it covers both branches)

## Gate 2 - Reachability

Prove the vulnerable state exists in a live deployment.

- Structurally impossible (enforced invariant prevents the prerequisite state) -> **REJECTED**
- Requires privileged actions outside normal operation -> **DEMOTE**
- Achievable through normal usage or common token behaviors -> **clears**, continue

**FHE-specific reachability:**
- Uninitialized handle bugs require a code path that reads a mapping entry for an account that has never interacted. Is this reachable?
- Self-transfer requires `from == to`. Is this possible given the function's parameter structure (`msg.sender` vs parameter)?
- Overflow requires values large enough to wrap `euint64` (>18.4 quintillion). Is this achievable given the token's supply/decimals?

## Gate 3 - Trigger

Prove an unprivileged actor can execute the attack.

- Only trusted roles can trigger -> **DEMOTE** (unless the finding is about admin violating user confidentiality)
- Costs exceed extraction -> **REJECTED**
- Unprivileged actor triggers profitably -> **clears**, continue

**FHE-specific trigger considerations:**
- **Opaque inputs are still exploitable** when the attack targets *structure*, not *value*: ACL gaps, type mismatches, ordering bugs, overflow-by-wrapping, and select-branch imbalance all fire regardless of the plaintext.
- **Value-dependent attacks require a plaintext oracle** (event emission, revert pattern, gas delta). If the contract never leaks the value, pure value-dependent exploits do NOT clear Gate 3 - demote to LEAD.
- **Transaction ordering** (front-running, back-running, sandwich) clears Gate 3 when ordering alone changes the outcome - the attacker does not need to see the encrypted value.
- **ACL bugs** are auto-triggered: any user who tries to decrypt hits the missing permission, no special attacker action needed.

## Gate 4 - Impact

Prove material harm to an identifiable victim.

- Self-harm only -> **REJECTED**
- Dust-level impact, no compounding -> **DEMOTE**
- Material loss to identifiable victim -> **CONFIRMED**

**FHE-specific impact categories:**
- **Confidentiality breach:** Encrypted data revealed to unauthorized party. Severity depends on what was leaked and to whom.
- **Funds at risk:** Token inflation, unauthorized transfers, balance corruption. Severity depends on amount and exploitability.
- **Denial of service:** Contract stuck due to missing ACL, failed decryption, or unreachable state. Severity depends on whether funds are locked.
- **Functionality broken:** Feature does not work as intended but no funds lost. Lower severity.

## Confidence Scoring

Start at **100**, deduct:

| Condition | Deduction |
|-----------|-----------|
| Partial attack path (some steps unverified) | -20 |
| Bounded, non-compounding impact | -15 |
| Requires specific but achievable state | -10 |
| Encrypted value makes exploitation uncertain | -10 |
| Requires privileged role (not admin-intent) | -15 |

**Confidence >= 80:** Include description + diff-based fix.
**Confidence < 80:** Include description only (no fix - finding needs manual verification).

## Confidence -> Severity -> Remark (assign all three)

Every finding carries three orthogonal tags. See `report-format.md` for
full definitions and the summary-table schema.

| Confidence | Label | Typical Severity | Default Remark |
|-----------|-------|-------------------|----------------|
| >=95  | DEFINITE BUG   | Critical / High  | Exploitable   |
| 80-94| LIKELY ISSUE   | High / Medium    | Exploitable or Needs Review |
| 70-79| PROBABLE ISSUE | Medium           | Needs Review  |
| 40-69| SUGGESTION     | Low              | Hardening or Design Choice |
| <40  | NOTE           | Info             | Design Choice or False Positive (kept for context) |

**Severity** weighs worst-case impact (funds / confidentiality / DoS);
**Confidence** weighs how sure we are the bug exists; **Remark** is the
reviewer's one-word judgement (Exploitable / Needs Review / Design
Choice / False Positive / Hardening). A Low-severity finding can still
have high confidence; a High-severity finding can still have low
confidence. Record all three independently.

## Single-Pass Gate Evaluation Protocol

Evaluate every relevant code path ONCE in fixed order: constructor -> initializer -> state-modifying externals -> internal helpers. One-line verdict per path: `BLOCKS`, `ALLOWS`, `IRRELEVANT`, or `UNCERTAIN`. Commit after all paths - do not re-examine. `UNCERTAIN` = `ALLOWS`.

No deployer-intent reasoning - evaluate what the code _allows_, not how the deployer _might_ use it.

## Safe Patterns (Do Not Flag)

**FHE-specific safe patterns:**
- `FHE.select()` with both branches performing symmetric operations (standard conditional transfer pattern)
- Uninitialized handles used in `FHE.add()` when zero-default is documented and intentional
- Missing `allow()` for internal-only values that no user needs to decrypt
- `allowTransient()` for values consumed by another contract in the same transaction and not stored
- Encrypted arithmetic wrapping when the type is wide enough for the domain (e.g., `euint64` for a token with 6 decimals and reasonable supply)
- `makePubliclyDecryptable` after a phase transition that is properly guarded

**General Solidity safe patterns:**
- `unchecked` in Solidity 0.8+ (but verify the reasoning is correct)
- Explicit narrowing casts in Solidity 0.8+ (reverts on overflow - not a bug)
- `MINIMUM_LIQUIDITY` burn on first deposit (Uniswap v2 pattern - intentional anti-inflation)
- SafeERC20 (`safeTransfer` / `safeTransferFrom`) - properly handles void-return tokens
- `nonReentrant` modifier (only flag cross-contract reentrancy that bypasses it)
- Two-step admin transfer
- Standard protocol-favoring rounding unless compounding or zero-rounding

## Composite Chains

Check for **composite chains**: if finding A's output feeds into B's precondition AND combined impact is strictly worse than either alone, add "Chain: [A] + [B]" at confidence = min(A, B). Most audits have 0-2.

## Lead Promotion

Before finalizing leads, check for promotion opportunities:

- **Cross-contract echo.** Same root cause confirmed as FINDING in one contract -> promote in every contract where the identical pattern appears.
- **Multi-module convergence.** 2+ review modules flagged the same function/area and the lead was demoted (not rejected) -> promote to FINDING at confidence 75.
- **Partial-path completion.** The only weakness is an incomplete trace but the path is reachable and unguarded -> promote to FINDING at confidence 75, description only.

`[modules: 2+]` does NOT override a concrete refutation - demote to LEAD if refutation is uncertain.

## Leads

High-signal trails for manual investigation. No confidence score, no fix - title, code smells, and what remains unverified.

## Do Not Report

Linter/compiler issues, gas micro-opts, naming, NatSpec. Admin privileges by design. Missing events. Centralization without exploit path. Implausible preconditions. Issues in imported library code (unless the contract uses the library incorrectly).
