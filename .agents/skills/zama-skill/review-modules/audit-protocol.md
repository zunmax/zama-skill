# Audit Protocol

Rules that apply to ALL hacking modules. Read this before processing any source code.

## Reading the Bundle

Your bundle has two sections:

1. **Source code** - all in-scope `.sol` files, each under a `### path` header with fenced code block. Read in parallel chunks (offset + limit), compute offsets from the line count in your prompt.
2. **Module instructions** - your specialized attack focus. These define WHAT to exploit; the source code defines WHERE.

When matching function names, check both `functionName` and `_functionName` (Solidity internal convention).

## Cross-Contract Pattern Weaponization

When you find a vulnerability in one contract, **weaponize that pattern across every other contract in the bundle.** Search by function name AND by code pattern. Finding a missing `allowThis()` in `TokenA.transfer` means you check every other contract's state-modifying functions for the same gap - missing a repeat instance is an audit failure.

After scanning: escalate every finding to its worst exploitable variant. A missing ACL may look like a usability bug but could enable unauthorized decryption or permanent fund lockup. Then revisit every function where you found something and attack the other branches.

## Guard Breaking

A guard only stops your attack if it blocks ALL paths. Find the way around:

- Reach the same state through a function without the guard
- Feed input values that slip past the check (especially encrypted inputs where the contract cannot see the value)
- Exploit checks positioned after state modifications (too late - state already corrupted)
- Enter through callbacks, cross-contract calls, or operator/approval mechanisms
- Bypass `require(from != to)` through multi-hop: A->B then B->A in same tx
- Exploit `FHE.isInitialized()` guards that only protect some code paths

## Pattern Classification Gate

If your bundle includes a vulnerability pattern catalog (P1-P32 or G1-G29), you MUST begin your output with a classification block:

```
Skip: P1,P4,G3,G8  (construct AND concept both absent from codebase)
Drop: P6,G10        (guard unambiguously blocks all paths)
Investigate: P3,P5,P11,G14  (no guard, partial guard, or uncertain coverage)
Total: N classified
```

Every pattern in your catalog goes into exactly one category. `Total` must match the pattern count. After the classification block, output FINDING and LEAD blocks. This forces systematic coverage - skipping a pattern is an audit failure.

## What NOT to Report

- Gas optimizations or style preferences
- Missing NatSpec or documentation
- Admin-only functions doing admin things (unless admin can violate user confidentiality)
- Standard design tradeoffs explicitly documented in the contract (e.g., plaintext totalSupply for gas efficiency)
- Issues in imported library code (only report if the contract uses the library incorrectly)
- FHE operations on uninitialized handles IF the zero-default behavior is clearly intentional
- Linter/compiler warnings, naming conventions, missing events
- Centralization without a concrete exploit path
- Standard DeFi tradeoffs: MEV exposure with no mitigation path, rounding dust below 1 wei, first-depositor with MINIMUM_LIQUIDITY burn
- Self-harm-only bugs where the attacker is the only victim
- "Admin can rug" without a concrete mechanism showing how

## Output Format

Return delimited key:value blocks only - no preamble, narration, or summary. Each vulnerability gets exactly one block.

**FINDING** = concrete, verified, exploitable. Full attack path traced in source code with specific values.
**LEAD** = real code smell with incomplete path. Default to LEAD over dropping.

**One vulnerability per item.** Same root cause = one item. Different fixes needed = separate items.

### FINDING block

```
--- FINDING ---
module:       <one of: encrypted-state-flow | acl-completeness | decryption-integrity | type-operation-safety | confidentiality-boundary | fhe-logic-invariant | solidity-security>
contract:     <ContractName>
function:     <functionName>
location:     <path/to/File.sol:L<start>-L<end>>
pattern:      <P1..P32 | G1..G29 | custom>
group_key:    <ContractName | functionName | vulnerability-class>
severity:     <Critical | High | Medium | Low | Info>
confidence:   <0-100, per finding-validation.md>
remark:       <Exploitable | Needs Review | Design Choice | False Positive | Hardening>
category:     <State Corruption | ACL Gap | Decryption Flow | Type Safety | Confidentiality Leak | Logic Invariant | Integration Risk | Reentrancy | Access Control | Math Precision | Token Integration | Economic Exploit | Hardening>
path:         <caller -> function -> state change -> impact>
description:  <one sentence - the bug and why it is exploitable>
proof:        <concrete values, trace, or state sequence from the real code>
fix:          <one-sentence fix - REQUIRED when confidence >= 80, OMIT otherwise>
<module-specific fields appended here (see each module's "Output Fields" section)>
--- END ---
```

### LEAD block

```
--- LEAD ---
module:       <module name>
contract:     <ContractName>
function:     <functionName>
location:     <path/to/File.sol:L<start>[-L<end>]>
pattern:      <P-ID | G-ID | custom>
group_key:    <ContractName | functionName | vulnerability-class>
severity:     <Critical | High | Medium | Low | ? (use ? when path not closed)>
code_smells:  <what you found and where>
description:  <one sentence - the trail and what remains unverified>
--- END ---
```

### Block rules

1. **One key per line.** Every field on its own line, `key: value` format. No pipe-delimited headers, no multi-field lines.
2. **Delimiters are literal.** Start each block with `--- FINDING ---` or `--- LEAD ---`. Close with `--- END ---`. The orchestrator parses these exactly.
3. **Every FINDING MUST have a `proof:` field.** No proof -> emit as LEAD instead.
4. **Every FINDING MUST carry** `severity`, `confidence`, `remark`, `location`, `category`, `module`. These populate the Findings Summary table in `report-format.md` without re-scoring.
5. **`group_key` format**: `ContractName | functionName | vulnerability-class`. Used for cross-module deduplication.
6. **`pattern` references** a pattern ID from `fhe-vulnerabilities.md` (P1-P32) or `solidity-vulnerabilities.md` (G1-G29). Use `custom` for novel findings.
7. **Module-specific fields are appended inside the same block**, after `fix:` (or after `proof:` when no `fix:`). Do NOT create a second block. Do NOT repeat any field already defined above (especially `proof`).
8. **No reserved-name collisions.** Module-specific field names must not shadow core fields: `module`, `contract`, `function`, `location`, `pattern`, `group_key`, `severity`, `confidence`, `remark`, `category`, `path`, `description`, `proof`, `fix`.
9. **Values stay on one line** when possible. If a proof trace must span lines, indent continuation lines with two spaces - the parser treats an indented line as a continuation of the prior key.

### Worked example

A filled FINDING from the ACL module (note: module-specific fields appended, `proof:` not duplicated):

```
--- FINDING ---
module:         acl-completeness
contract:       ConfidentialToken
function:       transfer
location:       src/ConfidentialToken.sol:L88-L104
pattern:        P7
group_key:      ConfidentialToken | transfer | ACL Gap
severity:       High
confidence:     92
remark:         Exploitable
category:       ACL Gap
path:           user.transfer(to, amount) -> _balances[to] updated -> no FHE.allow(_balances[to], to) -> recipient cannot decrypt their new balance
description:    Recipient loses decryption permission on the updated balance because FHE.allow is only called for msg.sender.
proof:          After tx: balances[to] handle = 0xabc..; allow(balances[to], to) never emitted; to.userDecrypt reverts with custom error SenderNotAllowed(address) from ACL.sol:106.
fix:            Add FHE.allow(_balances[to], to) immediately after the _balances[to] assignment on L101.
missing_acl:    allow
affected_value: _balances[to]
code_path:      transfer() success branch - L96 updates _balances[to] then returns without calling allow(to).
--- END ---
```

## FHE-Specific Attack Rules

1. **Encrypted values are opaque.** You cannot reason about what value a handle holds. Focus on structural attacks: ACL gaps, type mismatches, operation validity, information flow, invariant violations.

2. **All FHE arithmetic wraps silently.** Do not flag wrapping as a bug unless it violates a conservation law or documented invariant. DO exploit wrapping to break invariants - user-controlled amounts can wrap `euint64` balances to create tokens from nothing.

3. **`ebool` is a `bytes32` UDVT, not a `bool`.** Any FHE comparison result used directly in `require`/`if`/`assert` is a Solidity compile error (UDVTs do not auto-convert to `bool`). The DEFINITE BUG to flag is when a developer unwraps the handle to a primitive (e.g. `ebool.unwrap(r) != bytes32(0)`) and then gates on the unwrapped value - the handle is always non-zero so the check always passes. Exceptions: `FHE.isAllowed()`, `FHE.isInitialized()`, `FHE.isSenderAllowed()`, `FHE.isPubliclyDecryptable()` return plaintext `bool`.

4. **ACL is mandatory.** Every stored encrypted computation MUST have `allowThis()`. Every user-facing encrypted value MUST have `allow(user)`. Missing ACL is always at least a LEAD - trace the impact to determine if it's a FINDING.

5. **Handle ordering is cryptographic.** Any dynamic handle array construction is a potential source of ordering bugs in `checkSignatures`. Trace the construction to verify determinism.

6. **Exploit the opacity.** The contract cannot see encrypted values, so it cannot validate them. If a user submits an encrypted zero where a nonzero is expected, the contract cannot detect it. Trace what happens with adversarial encrypted inputs.
