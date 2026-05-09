# Code Style: Strict Rules for Zama Skill

## Contents

- Rule 1: Comment syntax by language
- Rule 2: Banned Unicode characters
- Rule 3: File header on every source file
- Rule 4: Section dividers (asterisk box)
- Rule 5: Solidity NatSpec (contracts, functions, state variables)
- Rule 6: TypeScript / JavaScript JSDoc (not NatSpec)
- Rule 7: Inline comments
- Rule 8: FHE-specific non-obvious constraints (comment subjects)
- Rule 9: Post-delivery grep (enforcement)

This document defines every style rule the skill enforces. Each rule is
stated as a directive (DO / DO NOT) with an explicit example. A style
violation is a review failure even if the code is functionally correct.

Match the documentation style of OpenZeppelin, Uniswap, and Solady. A
reviewer must be able to understand every non-obvious decision by reading
only the comments.

## Rule 1: Comment syntax by language

**Rule:** use block-style comments in C-family languages; use hash-style
in hash-comment languages. Do not mix styles.

**C-family languages** (file extensions: `.sol`, `.ts`, `.tsx`, `.js`,
`.jsx`, `.rs`, `.go`, `.c`, `.cpp`, `.h`, `.hpp`, `.java`):

- DO use `/* comment */` for inline or multi-line comments.
- DO use `/** comment */` for documentation blocks (NatSpec in Solidity,
  JSDoc in TS / JS).
- DO NOT use `//` for any comment.
- DO NOT use `///` for any comment, even though Solidity NatSpec accepts
  it. This project rejects `///`.

**Hash-comment languages** (file extensions: `.py`, `.sh`, `.bash`,
`.zsh`, `.yml`, `.yaml`, `.toml`, `Dockerfile`, `Makefile`, `.rb`):

- DO use `#` for comments.
- Python may additionally use triple-quoted docstrings (`""" ... """`)
  for module and function documentation.

## Rule 2: Banned Unicode characters

**Rule:** four Unicode characters are banned in every file the skill
produces, regardless of language. The first two are dashes that the
skill's grep already covers; the latter two are the project-level banned
emojis from the user-global `~/.claude/CLAUDE.md` rule 9.

- BANNED: U+2014 EM DASH (the "long dash" character).
- BANNED: U+2013 EN DASH (the "medium dash" character).
- BANNED: U+1F680 ROCKET emoji.
- BANNED: U+26A0 WARNING SIGN emoji.
- DO replace dashes with one of: `-` (U+002D HYPHEN-MINUS), `:`, `,`,
  parentheses, or rephrase the sentence. DO drop emojis entirely or
  rephrase ("warning:" / "ship", etc.).

**Why:** em dashes and these two emojis frequently appear in text pasted
from chat transcripts or AI output and immediately tag the file as
auto-generated. The skill must produce zero occurrences.

**How to detect:** run the regex `[\x{2013}\x{2014}\x{1F680}\x{26A0}]`
against every emitted file. Zero matches is the pass condition.

## Rule 3: File header on every source file

**Rule:** every source file the skill creates or modifies begins with a
`@file` + `@description` header. Place it at the top of the file, after
the SPDX license + pragma for Solidity.

**C-family format** (block JSDoc / NatSpec):

```solidity
/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.28;

/**
 * @file FileName.ext
 * @description One sentence, maximum 120 characters. Declarative. States
 *              what the file does, not how it does it.
 */
```

For TypeScript / JavaScript, omit the SPDX line and pragma; the
`@file` / `@description` block is the first content in the file.

**Hash-comment format:**

```python
#####
# @file filename.py
# @description One sentence, maximum 120 characters.
#####
```

**Python alternative** (module docstring):

```python
"""
@file filename.py
@description One sentence, maximum 120 characters.
"""
```

**Rules for `@file`:**
- MUST match the exact filename including extension.
- MUST appear once per file.

**Rules for `@description`:**
- MUST be a single sentence.
- MUST NOT contain em dashes or marketing language.
- SHOULD be under 120 characters.

## Rule 4: Section dividers (asterisk box)

**Rule:** inside a long file, use asterisk-bordered box comments to
separate logical sections.

**Format:**

```solidity
/*************** Internal ***************/
/*************** Public Decryption - 3-Step Self-Relaying ***************/
/*************** Storage Layout ***************/
```

**Format requirements:**
- MUST use block-style `/* */`.
- MUST have at least 10 leading `*` and at least 10 trailing `*`.
- MUST fit on a single line.
- MUST use Title Case for the label.
- MUST NOT use multi-line box art (no top / bottom border lines).

**Placement requirements:**
- DO place one divider above each logical section: External, Internal,
  View, Pure, Storage, Events, Errors, Modifiers, Admin.
- DO NOT add a divider inside a single section.
- DO NOT add a divider in files under 50 lines.

**Counter-example (do not produce this):**

```solidity
/*******************
 *    Internal     *
 *******************/
```

Multi-line box art is forbidden. Use the one-line form only.

## Rule 5: Solidity NatSpec (contracts, functions, state variables)

**Rule:** every `external` / `public` function, every storage variable
exposed to the ABI, and every contract MUST carry a NatSpec block.
Always use the `/** */` form. Never use `///`.

### 5.1 Solidity NatSpec tags (authoritative list)

| Tag | Required? | Scope | Purpose |
|-----|-----------|-------|---------|
| `@title` | optional | contract | Contract title. |
| `@author` | optional | contract | Author attribution. |
| `@notice` | required | contract, function, state variable | User-observable behavior. Describes WHAT the code does for a user, not HOW. Plain English. |
| `@dev` | required when non-obvious | contract, function, state variable | Implementation detail for developers: invariants, preconditions, gas / HCU considerations, rationale. |
| `@param <name>` | required for every parameter | function | One line per parameter. Parameter name MUST match the signature exactly. |
| `@return [<name>] <desc>` | required for every return value | function | One line per return. If the function uses named returns, include the name. Otherwise omit the name. |
| `@inheritdoc <Parent>` | required when implementing an interface function | function | Inherits `@notice`, `@param`, `@return` from the interface. DO NOT add a separate `@notice` when using `@inheritdoc`. |
| `@custom:security-contact` | required on contracts | contract | Security contact email. OpenZeppelin and ethereum-lists convention. |
| `@custom:storage-location` | required on upgradeable contracts using ERC-7201 | contract or struct | Namespaced storage slot identifier. |
| `@custom:invariant` | optional | contract or function | Project-specific invariant the reviewer should verify. |

### 5.2 Rules for `@notice`

- MUST describe the user-visible effect.
- MUST NOT mention implementation terms (`revert`, `payable`, `storage`,
  `calldata`, `require`). Put those in `@dev`.
- MUST be a complete sentence ending with a period.

### 5.3 Rules for `@dev`

- MUST describe at least one of: invariants, preconditions, side
  effects, gas / HCU cost, rationale for a non-obvious design.
- MUST NOT repeat the `@notice` content.

### 5.4 Rules for `@inheritdoc`

- DO use when implementing a function declared in an interface or
  abstract contract.
- DO NOT add a separate `@notice` on the same function; `@inheritdoc`
  inherits it.
- DO add a separate `@dev` if the implementation has details the
  interface does not document.

### 5.5 Contract-level example

```solidity
/**
 * @title ConfidentialERC20
 * @author YourOrg
 * @notice Minimal confidential ERC-20 with encrypted balances and transfers.
 * @dev Balances are encrypted euint64 handles. Transfers route through
 *      FHE.select so the contract never branches on an encrypted value.
 *      Overflow wraps silently; the transfer path uses FHE.le + FHE.select
 *      to enforce the balance check.
 * @custom:security-contact security@yourorg.example
 */
contract ConfidentialERC20 is ZamaEthereumConfig { }
```

### 5.6 Function-level example

```solidity
/**
 * @notice Transfer encrypted tokens from the caller to `to`.
 * @dev Uses FHE.select so insufficient balance becomes a zero-value
 *      transfer rather than a revert. Grants persistent ACL on the new
 *      balance handles to both parties; without this, users cannot
 *      decrypt their own balance afterward.
 * @param to Recipient address. MUST NOT equal msg.sender (self-transfer
 *        would corrupt the balance via double-write).
 * @param encAmount Encrypted transfer amount (externalEuint64).
 * @param inputProof ZK proof bound to the same encrypt() call that
 *        produced `encAmount`.
 */
function transfer(
    address to,
    externalEuint64 encAmount,
    bytes calldata inputProof
) external { }
```

### 5.7 Interface implementation example

```solidity
/**
 * @inheritdoc IConfidentialERC20
 */
function balanceOf(address account) external view returns (euint64) { }
```

Note: no `@notice`, no `@param`, no `@return`. The interface provides
them.

## Rule 6: TypeScript / JavaScript JSDoc (not NatSpec)

**Rule:** NatSpec tags are Solidity-only. They are parsed by the
Solidity compiler and by `solidity-docgen`. They are NOT valid JSDoc.

**BANNED in `.ts`, `.tsx`, `.js`, `.jsx`:** `@notice`, `@dev`,
`@inheritdoc`, `@title`, `@author`, any `@custom:*`.

**Use instead:** the JSDoc / TSDoc tags below.

### 6.1 JSDoc / TSDoc tags (authoritative list)

| Tag | Required? | Purpose |
|-----|-----------|---------|
| (leading text) | required | Description. Place at the top of the block, with no tag. Do NOT use a `@description` tag. |
| `@param <name> <desc>` | required for every parameter | One line per parameter. Name MUST match the signature. |
| `@returns <desc>` | required when the function returns a value | Use `@returns` (plural). Do NOT use `@return` - this project uses `@returns` for consistency. |
| `@throws <desc>` | required for every throwable error | Describe the error and when it is thrown. |
| `@example` | optional | Usage example block. |
| `@deprecated <replacement>` | required on deprecated APIs | State the replacement or migration path. |
| `@see <ref>` | optional | Cross-reference. |
| `@remarks <note>` | optional (TSDoc) | Extended notes that do not fit the summary. |

### 6.2 JSDoc example

```typescript
/**
 * Encrypt a euint64 input bound to the given contract and user.
 *
 * Handle order matches the `add*()` call order: the first `add*()` call
 * produces `handles[0]`. Mixing handles from different encrypt() calls
 * fails proof verification on-chain.
 *
 * @param contractAddr Destination contract (binds the proof).
 * @param userAddr User the input is attributed to.
 * @param amount Cleartext amount. Must fit in 64 bits.
 * @returns `{ handle, proof }`. Pass both to the contract call.
 * @throws If `initSDK()` has not been awaited in the browser.
 */
export async function encryptAmount(
  contractAddr: `0x${string}`,
  userAddr: `0x${string}`,
  amount: bigint,
): Promise<{ handle: Uint8Array; proof: Uint8Array }> { }
```

## Rule 7: Inline comments

**Rule:** an inline comment must explain WHY the code is written this
way. Do NOT write a comment that restates WHAT the code does.

**DO write an inline comment when:**
- The code enforces a hidden invariant (e.g., handle ordering, ACL
  lifecycle).
- The code is a workaround for a compiler or runtime bug.
- The code has a subtle ordering requirement.
- The behavior would surprise a reader who understands Solidity but not
  FHEVM.

**DO NOT write an inline comment when:**
- The code is self-explanatory from identifier names.
- The comment restates the operator (e.g., `/* add amount */`).
- The comment references the current task, PR number, or ticket ID
  (those belong in the commit message).

**Format:** `/* */`, single line where possible. Use a multi-line
`/* ... */` block only when the constraint genuinely needs more than one
line.

**Good examples:**

```solidity
/* Handle order MUST match the order passed to publicDecrypt.
   checkSignatures binds the cleartext to this exact sequence. */

/* allowThis required - fromExternal grants only TRANSIENT ACL which
   expires at the end of this transaction. */
```

**Bad examples (delete these):**

```solidity
/* Increment balance */        balance += amount;
/* Loop over items */          for (uint i; i < n; i++) { }
/* Check ownership */          if (msg.sender != owner) revert();
/* Added in PR #123 */         FHE.allowThis(result);
```

## Rule 8: FHE-specific non-obvious constraints (comment subjects)

**Rule:** when the skill writes FHEVM code, it must add inline comments
on the following five classes of constraint. These are the comments
that save a reviewer from re-deriving FHE subtleties.

1. **Handle ordering** in `checkSignatures`. The on-chain handle array
   MUST match the off-chain `publicDecrypt` call order.
2. **Transient vs persistent ACL.** `fromExternal` grants only transient
   ACL; `allowThis` is required for persistent access.
3. **Type mismatch in `FHE.select`.** Both branches must have identical
   encrypted types. Upcast before selecting.
4. **Irreversibility of `makePubliclyDecryptable`.** Once called, the
   handle is readable by anyone. No revoke exists.
5. **Silent wrap in FHE arithmetic.** Unlike Solidity 0.8+, FHE
   operations wrap on overflow. Use `FHE.le` + `FHE.select` as a guard.

## Rule 9: Post-delivery grep (enforcement)

**Rule:** before marking any FHEVM task complete, run the following two
grep patterns against every file touched. Zero matches on each pattern
is the pass condition.

Run BOTH patterns. The leading-line pattern is the project's required check (used by every skill bundle). The any-position pattern is a stricter optional check that catches trailing inline `// note`-style comments too.

```
Comments (required, leading-line):  ^\s*//[^\*]|^\s*///
Comments (optional, any position):  (^|\s)//[^\*]|(^|\s)///
Glyphs   (required, anywhere):      [\x{2013}\x{2014}\x{1F680}\x{26A0}]
```

- **Comments (leading)** matches `//` or `///` line comments at the start of a line.
- **Comments (any position)** also catches trailing/inline `// note`. Designed to skip `https://` URLs (no whitespace before `//`).
- **Glyphs** matches U+2013 (en dash), U+2014 (em dash), U+1F680 (rocket emoji), or U+26A0 (warning emoji) anywhere.

**Note:** the pattern `/\*{5,}` (used in earlier versions of this file)
is NOT grepped. Asterisk-box section dividers
`/*************** Name ***************/` are the preferred project style
(Rule 4).

If either pattern returns a match, fix the violation before delivering.
