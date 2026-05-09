# FHE Security Audit - Report Format

## Contents

- Report Path
- Severity & Remark Definitions
- Output Template
- Scope
- Findings Summary
- Findings
- Leads
- ACL Coverage Matrix (Workflow 5 only - audit)
- False Positives / Rejected Findings
- Formatting Rules

This format applies to BOTH Workflow 2 (quick review) and Workflow 5 (orchestrated
audit). Same columns, same fields. Workflow 5 additionally includes the ACL
Coverage Matrix.

## Report Path

When `--file-output` is passed, save the report to
`assets/findings/{project-name}-z-auditor-report-{timestamp}.md` where
`{project-name}` is the repo root basename and `{timestamp}` is
`YYYYMMDD-HHMMSS` at scan time.

## Severity & Remark Definitions

Every finding MUST carry three orthogonal tags.

**Confidence** (0-100) - how sure we are the bug exists. Set by
`finding-validation.md` scoring. Controls report placement.

**Severity** - worst-case impact if exploited:

| Severity | Meaning |
|----------|---------|
| Critical | Funds at risk, permanent lockup, or total confidentiality breach |
| High     | Material funds at risk OR systemic failure under reachable state |
| Medium   | Bounded funds at risk, partial confidentiality leak, feature DoS |
| Low      | Hardening / best-practice / defense-in-depth improvement |
| Info     | Code-quality note, no exploit path |

**Remark** - reviewer judgement, one of:

| Remark | Meaning |
|--------|---------|
| Exploitable    | Full attack path traced with concrete values |
| Needs Review   | Strong signal but one step unverified - manual review required |
| Design Choice  | Intentional tradeoff; keep in report with mitigation note |
| False Positive | Refuted by a guard; kept in report to prevent re-flagging |
| Hardening      | Not a bug, but improves robustness |

## Output Template

````
# FHE Security Audit - <Contract or Project Name>

---

## Scope

|                      |                                               |
| -------------------- | --------------------------------------------- |
| **Mode**             | ALL / default / filename                      |
| **Files reviewed**   | `File1.sol` - `File2.sol` - `File3.sol`       |
| **FHEVM version**    | v0.11 (@fhevm/solidity ^0.11.1)          |
| **Hacking modules**  | state-flow - acl - decryption - types - confidentiality - invariants - general-security |
| **Patterns checked** | P1-P32 (fhe-vulnerabilities.md), G1-G29 (solidity-vulnerabilities.md) |
| **Confidence threshold (1-100)** | N                              |

---

## Findings Summary

| # | Severity | Confidence | Category | Location | Remark | Title |
|---|----------|-----------:|----------|----------|--------|-------|
| 1 | Critical | 95 | State Corruption | `Token.transfer:L142` | Exploitable    | <title> |
| 2 | High     | 88 | ACL Gap          | `Vault.deposit:L71`  | Exploitable    | <title> |
| 3 | High     | 82 | Token Integration| `Router.swap:L219`   | Needs Review   | <title> |
| 4 | Medium   | 75 | Type Safety      | `Vote.cast:L55`      | Needs Review   | <title> |
| 5 | Low      | 60 | Hardening        | `Utils.hash:L22`     | Hardening      | <title> |
| 6 | Info     | 30 | Confidentiality  | `Token.balanceOf:L90`| Design Choice  | <title> |

Sort by severity (Critical > High > Medium > Low > Info), then by
confidence descending within each severity band.

---

## Findings

### [1] <Title>   `Critical - Confidence 95 - Exploitable`

- **Location**: `ContractName.functionName` (`path/to/File.sol:L142-L158`)
- **Pattern**: P-ID (or `custom`)
- **Category**: State Corruption / ACL Gap / Decryption Flow / Type Safety / Confidentiality Leak / Logic Invariant / Integration Risk / Reentrancy / Access Control / Math Precision / Token Integration / Economic Exploit
- **Remark**: Exploitable - full path traced with concrete values below.

**Description**
<1-2 sentences: what the bug is and why it is exploitable>

**Attack Path**
```
caller -> function -> state change -> impact
```

**Proof / Trace**
<Concrete values, encrypted handle ordering, or state sequence that
demonstrates the vulnerability against the actual code.>

**Fix**
```diff
- vulnerable line(s)
+ fixed line(s)
```

---

### [2] <Title>   `High - Confidence 88 - Exploitable`

(same structure as [1])

---

### [N] <Title>   `Medium - Confidence 75 - Needs Review`

- **Location**: `ContractName.functionName` (`path/to/File.sol:L55`)
- **Pattern**: P-ID
- **Category**: Type Safety
- **Remark**: Needs Review - [specific step the reviewer could not verify, e.g. "unclear whether `from` can equal `to` via operator hook"].

**Description**
<1-2 sentences>

_No diff fix for findings with confidence < 80. Include a one-line
mitigation suggestion instead._

**Suggested Mitigation**
<one short sentence>

---

< ... findings continue, sorted by severity then confidence ... >

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit
path could not be completed. High-signal leads for manual review.
Confidence not scored; severity left as "?" until path is closed._

| # | Location | Pattern | Code Smell | What is Unverified |
|---|----------|---------|-----------|---------------------|
| L1 | `Contract.function:L42` | P-ID | missing `FHE.allowThis` | whether callers ever read the handle next tx |
| L2 | `Contract.function:L77` | P-ID | encrypted divisor | whether the divisor can be zero under reachable inputs |

---

## ACL Coverage Matrix   _(Workflow 5 only - audit)_

| Contract | Function | Stored Value | `allowThis` | `allow(user)` | Status |
|----------|----------|-------------|-------------|---------------|--------|
| Token | mint     | `_balances[to]`   | L42 | L43 | OK |
| Token | transfer | `_balances[from]` | L80 | -   | **MISSING** |
| Token | transfer | `_balances[to]`   | L82 | L83 | OK |

Status values: `OK` (both calls present) / `MISSING` (gap -> must be a
Finding) / `N/A` (handle never read externally).

---

## False Positives / Rejected Findings   _(optional, keeps repeat-scans stable)_

| # | Location | Reason Rejected |
|---|----------|-----------------|
| R1 | `Token.burn:L90` | `require(from != to)` at L88 blocks self-transfer inflation |
| R2 | `Vault.withdraw:L12` | `FHE.allowThis` is called after `select` at L18 - covers both branches |

---

> **WARNING:** This review was performed by an AI assistant using FHE-specific
> security hacking modules. AI analysis can never verify the complete
> absence of vulnerabilities and no guarantee of security is given.
> Professional security audits, formal verification, and ongoing
> monitoring are strongly recommended before deploying confidential
> smart contracts to production.

````

## Formatting Rules

1. Follow the template exactly. The Findings Summary table is
   **mandatory** and must include the Severity, Confidence, and Remark
   columns.
2. Sort findings by severity (Critical -> Info), then by confidence
   descending within each band.
3. Findings with confidence >= 80 get a diff-based Fix block. Findings
   with confidence < 80 get only a one-line Suggested Mitigation.
4. Every finding detail must carry the three-tag header line
   (`Severity - Confidence N - Remark`) and a `Remark:` field with
   justification.
5. Pattern ID: P1-P32 (FHE patterns), G1-G29 (general Solidity), or
   `custom`.
6. Category values (pick exactly one): State Corruption, ACL Gap,
   Decryption Flow, Type Safety, Confidentiality Leak, Logic Invariant,
   Integration Risk, Reentrancy, Access Control, Math Precision, Token
   Integration, Economic Exploit, Hardening.
7. The ACL Coverage Matrix is mandatory for any contract that stores
   encrypted values (Workflow 5).
8. The False Positives table is optional but recommended - it prevents
   the same rejected finding from being re-flagged in a future scan.
9. Draft findings directly in report format - do not produce
   intermediate formats and then reformat.
10. If `--file-output` is set, also write to
    `assets/findings/{project-name}-z-auditor-report-{timestamp}.md`.
