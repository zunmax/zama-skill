# Solidity Vulnerability Vectors (G1-G29)

## Contents

- Category 1: Reentrancy and State Ordering
- Category 2: Access Control
- Category 3: Token Integration
- Category 4: Math and Precision
- Category 5: Execution Flow
- Category 6: Proxy and Upgrade
- Category 7: Economic and Oracle

> Standard Solidity vulnerability patterns that apply to ANY smart contract code in an FHEVM project,
> beyond the FHE-specific patterns in `fhe-vulnerabilities.md` (P1-P32).
> Each vector: vulnerability (**V:**), safe indicators (**Safe when:**), proof threshold (**Proof requires:**).
>
> The General Security & Periphery module uses this catalog. Classify every vector as
> Skip (construct + concept absent), Drop (guard blocks all paths), or Investigate (no/partial guard).

---

## Category 1: Reentrancy and State Ordering

**G1. Classic Reentrancy**

- **V:** External call made before state update. Callback re-enters the function and reads pre-update state. Exploitable when the function transfers ETH, calls an untrusted token, or invokes a callback hook.
- **Safe when:** `nonReentrant` modifier, checks-effects-interactions pattern (state updated before call), or no external call in the function.
- **Proof requires:** Show external call before state write, with a callback path that re-enters and exploits the stale state.

**G2. Cross-Contract Reentrancy**

- **V:** Contract A calls Contract B, which calls back into Contract A via a different function. The second function reads state that A has not yet finished updating.
- **Safe when:** Global `nonReentrant` across all external functions, or no cross-contract callback paths exist. Prefer `ReentrancyGuardTransient` (`@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol`) since FHEVM mandates `evmVersion: "cancun"` - lower gas (TLOAD/TSTORE), same semantics as `ReentrancyGuard`.
- **Proof requires:** Show the call chain A->B->A with stale state in the second entry.

**G3. Read-Only Reentrancy**

- **V:** A view function returns stale state during a nested external call. Another protocol reads this view during the callback and makes decisions on incorrect data.
- **Safe when:** View functions that report exchange rates/balances are protected by `nonReentrantView` (`@openzeppelin/contracts/utils/ReentrancyGuard.sol:83`), or no external integration reads them during callbacks. The transient variant ships `nonReentrantView` too.
- **Proof requires:** Show a view function returning pre-update values during a nested call, and an external consumer relying on that value.

---

## Category 2: Access Control

**G4. Unprotected Initializer**

- **V:** `initialize()` on an implementation contract can be called by anyone. Attacker initializes with their own admin address and either drains permissioned functions or (UUPS) installs a malicious upgrade through `_authorizeUpgrade`.
- **Safe when:** Constructor of the implementation calls `_disableInitializers()` (`@openzeppelin/contracts/proxy/utils/Initializable.sol:192`). The `initializer` modifier alone is NOT sufficient - it stops re-initialization, not the first initialization on the implementation. Use `reinitializer(uint64 version)` (line 152) for staged upgrades.
- **Proof requires:** Show `initialize()` callable on the implementation without `_disableInitializers()` in its constructor.

**G5. Privilege Escalation via Role Chaining**

- **V:** Role A can grant Role B. Role B can call a function that modifies critical state. An attacker who obtains Role A escalates to Role B without direct authorization.
- **Safe when:** Role granting is restricted to a higher-privilege role that cannot be obtained through the chain.
- **Proof requires:** Show the grant chain and the resulting unauthorized access.

**G6. Missing Access Control on State-Changing Function**

- **V:** A function that modifies critical state (fees, addresses, parameters) has no `onlyOwner`, `onlyRole`, or equivalent modifier.
- **Safe when:** Every state-changing function has explicit access control.
- **Proof requires:** Show the unprotected function and the state it modifies.

**G7. Confused Deputy**

- **V:** Contract A holds token approvals or privileges. An unguarded function in A can be called by anyone, making A spend its approvals on the attacker's behalf.
- **Safe when:** All functions that use stored approvals or privileges have access control.
- **Proof requires:** Show the unguarded function and how it uses A's privileges.

---

## Category 3: Token Integration

**G8. Fee-on-Transfer Token**

- **V:** Code uses `amount` parameter instead of actual received amount (`balanceAfter - balanceBefore`). The difference accumulates as a deficit the contract cannot cover.
- **Safe when:** Uses balance-difference pattern for all token receipts, or explicitly disallows fee-on-transfer tokens.
- **Proof requires:** Show `transferFrom(user, contract, amount)` followed by accounting that credits `amount`.

**G9. Rebasing Token**

- **V:** Contract caches a token balance. After a rebase, the cached value is stale. Positive rebase: excess tokens stuck. Negative rebase: withdrawals exceeding actual balance.
- **Safe when:** Uses `balanceOf` at point of use, or wraps rebasing tokens before interaction.
- **Proof requires:** Show cached balance used after a rebase event could have occurred.

**G10. Void-Return Token**

- **V:** `IERC20(USDT).transfer(...)` returns no data; Solidity decodes the empty returndata against the declared `bool` return type and reverts before `require` runs. The dual bug is `token.transfer(...)` *without* `require` - the missing return value is never checked, so a failed transfer silently passes.
- **Safe when:** Uses OpenZeppelin `SafeERC20.safeTransfer` / `safeTransferFrom` (`@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol:33`), which routes through `_callOptionalReturn` and tolerates both empty-returndata and `bool`-returndata.
- **Proof requires:** Show `require(token.transfer(...))` or `token.transfer(...)` (without `require`) or `require(token.approve(...))` without SafeERC20.

**G11. Blacklistable/Pausable Token**

- **V:** A token revert (blacklist or pause) in a critical path (withdrawal, liquidation) permanently blocks the function for all users.
- **Safe when:** Uses pull-over-push pattern, or has an escape hatch that bypasses the blocked token.
- **Proof requires:** Show a token transfer in a critical path with no fallback if it reverts.

**G12. Non-Standard Decimals**

- **V:** Hardcoded `1e18` applied to a 6-decimal token (USDC, USDT) or >18-decimal token. Results in massive over/under-accounting.
- **Safe when:** Uses `10 ** token.decimals()` dynamically, or explicitly documents supported decimal counts.
- **Proof requires:** Show hardcoded decimal assumption with a plausible token that violates it.

---

## Category 4: Math and Precision

**G13. Division Before Multiplication**

- **V:** `(a / b) * c` truncates the intermediate result. If `a = 1e18 + 1`, `b = 1e18`, intermediate truncates to `1`, then `1 * c` loses precision.
- **Safe when:** Multiplication always precedes division: `(a * c) / b`.
- **Proof requires:** Show division-before-multiplication with concrete values demonstrating material loss.

**G14. Wrong Rounding Direction**

- **V:** Each ERC-4626-style operation has a protocol-favoring rounding rule:
  - `deposit(assets)` rounds shares minted DOWN.
  - `mint(shares)` rounds assets pulled UP.
  - `redeem(shares)` rounds assets returned DOWN.
  - `withdraw(assets)` rounds shares burned UP.
  - Debt accrual rounds UP. Fees round UP. Wrong direction = extractable value.
  See `@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol:175-190` for the canonical implementation (`previewWithdraw` uses `Math.Rounding.Ceil`, `previewRedeem` uses `Math.Rounding.Floor`).
- **Safe when:** Each direction matches the table above; use `Math.mulDiv(x, y, denominator, Math.Rounding.Floor|Ceil)` from `@openzeppelin/contracts/utils/math/Math.sol` (line 282) to make the rounding direction explicit.
- **Proof requires:** Show the division, the rounding direction, and concrete numbers showing extraction.

**G15. Zero-Amount Exploitation**

- **V:** Fees or rewards truncate to zero for small amounts. Attacker makes many small transactions, each paying zero fees, accumulating value.
- **Safe when:** Minimum amount enforced, or fee formula rounds up.
- **Proof requires:** Show concrete input where fee/reward rounds to zero and repeated exploitation accumulates.

**G16. First Depositor Share Inflation**

- **V:** First depositor deposits 1 wei, donates a large amount directly, inflating share price. Subsequent depositors round to 0 shares; their deposits are stolen.
- **Safe when:** `MINIMUM_LIQUIDITY` burn on first deposit (Uniswap v2 pattern), OR virtual shares/assets via OZ ERC4626's `_decimalsOffset()` (`@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol`); offset >= 0 bakes `10**offset` virtual shares + 1 virtual asset into `_convertToShares` / `_convertToAssets`.
- **Proof requires:** Show the inflation math with concrete deposit amounts.

**G17. Unsafe Downcast**

- **V:** `uint256` value cast to `uint128` / `uint96` / `uint64` without bounds check. Solidity 0.8+ does NOT auto-check explicit narrowing casts: `uint128(x)` truncates the high bits silently when `x > type(uint128).max`. Only OpenZeppelin `SafeCast.toUint128(x)` reverts.
- **Safe when:** Explicit bounds check before cast (`require(x <= type(uint128).max)`), or use `SafeCast.toUintXXX(x)` from OpenZeppelin, or value provably fits in target type.
- **Proof requires:** Show the cast and a realistic value that overflows the target type.

**G18. Overflow in Intermediate Multiplication**

- **V:** `a * b / c` where `a * b` overflows `uint256` before the division. Flash-loan-scale values make this realistic.
- **Safe when:** Uses `mulDiv` from OpenZeppelin or equivalent safe math, or values provably cannot overflow.
- **Proof requires:** Show concrete values where `a * b > type(uint256).max`.

---

## Category 5: Execution Flow

**G19. Stale State After External Call**

- **V:** A value is read from storage, an external call is made, then the originally-read value is used for a decision or computation. The external call may have changed the state.
- **Safe when:** Value is re-read after the external call, or no state-changing callback is possible.
- **Proof requires:** Show read -> external call -> use of stale value, with a callback path that changes the state.

**G20. Partial State Update on Revert**

- **V:** A function updates multiple coupled variables. If it reverts mid-way (try-catch, external call failure), some variables are updated and others are not. The inconsistent state is exploitable.
- **Safe when:** All coupled updates happen atomically (revert undoes everything), or try-catch blocks restore state on failure.
- **Proof requires:** Show the coupled variables, the revert point, and the inconsistent state.

**G21. Encoding/Decoding Mismatch and Hash Collisions**

- **V:** Two issues. (1) `abi.encodePacked` produces concatenated bytes; `abi.decode` expects ABI-encoded data with padding - decoding packed data with `abi.decode` reads wrong fields. (2) `keccak256(abi.encodePacked(dynamicA, dynamicB))` collides whenever bytes can shift between A and B (e.g. `encodePacked("AAA", "BBB") == encodePacked("AAAB", "BB")`); never use `abi.encodePacked` for hash inputs with multiple dynamic args - use `abi.encode` (length-prefixed) or hash the args separately.
- **Safe when:** Encoding and decoding use the same format consistently; `abi.encode` (not `abi.encodePacked`) is used when hashing two or more dynamic-typed args.
- **Proof requires:** Show the encode call, the decode call (or hash call), and the resulting misalignment / collision.

**G22. Sentinel Address Bypass**

- **V:** `address(0)` or `type(uint256).max` triggers a special code path. The special path skips validation that the normal path enforces.
- **Safe when:** Special-case paths enforce equivalent validation.
- **Proof requires:** Show the sentinel check, the skipped validation, and exploitation.

---

## Category 6: Proxy and Upgrade

**G23. Storage Layout Collision**

- **V:** In a proxy pattern, the implementation contract's storage overlaps with proxy admin slots, OR an upgrade adds/reorders state variables that shift child storage onto a parent slot. Writing to a business logic variable corrupts the admin slot or vice versa. Modern variant: two ERC-7201 namespaces deriving to the same slot (rare with proper namespace strings, but catastrophic when it happens).
- **Safe when:** Uses EIP-1967 unstructured slots for proxy admin (`@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol:21,83,121`), explicit `__gap` arrays in upgradeable v4 contracts, or ERC-7201 namespaced storage layout (the OZ 5.x default - see `@openzeppelin/contracts/utils/ReentrancyGuard.sol:37` for a derived-slot example).
- **Proof requires:** Show the overlapping storage slots and the corruption scenario.

**G24. Uninitialized Implementation**

- **V:** Implementation contract deployed without calling `_disableInitializers()`. Anyone can call `initialize()` on the implementation and gain admin access. If UUPS, the attacker now owns `_authorizeUpgrade` and can set a malicious implementation that the proxy will accept on the next upgrade. (Pre-Cancun bricking via `SELFDESTRUCT` no longer applies under EIP-6780, which is in effect on every FHEVM chain since the plugin mandates `evmVersion: "cancun"` per `@fhevm/hardhat-plugin/README.md:202`. `SELFDESTRUCT` only deletes contract code if invoked in the same transaction as `CREATE`. A separately-deployed implementation cannot be erased by `SELFDESTRUCT` post-Cancun.)
- **Safe when:** Constructor of the implementation calls `_disableInitializers()` (`@openzeppelin/contracts/proxy/utils/Initializable.sol:192`).
- **Proof requires:** Show the implementation is initializable and the resulting privilege capture.

**G25. UUPS Missing Upgrade Guard**

- **V:** UUPS proxy with `_authorizeUpgrade` not protected by access control - anyone calls `upgradeToAndCall` and replaces the implementation. (Pre-OZ-5, also: upgrading to an implementation without `proxiableUUID` permanently freezes the proxy because the legacy `upgradeTo` did not enforce the ERC-1822 check; OZ 5.x removes `upgradeTo` and `_upgradeToAndCallUUPS` at `@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol:137-147` always validates `proxiableUUID` and reverts with `UUPSUnsupportedProxiableUUID(slot)` (line 140) or `ERC1967InvalidImplementation` (line 145) - the legacy bricking path is no longer reachable through stock UUPS.)
- **Safe when:** `_authorizeUpgrade` override exists and is restricted to an admin/owner role. With OZ >= 5.0 the `proxiableUUID` check is automatic in `_upgradeToAndCallUUPS`.
- **Proof requires:** Show `_authorizeUpgrade` lacking a role gate, or (pre-OZ-5) an upgrade path that lets a non-UUPS implementation install.

---

## Category 7: Economic and Oracle

**G26. Oracle Manipulation**

- **V:** Price oracle can be manipulated in the same transaction (spot price from a DEX, or a TWAP with short window). Attacker manipulates price, executes the victim function, restores price.
- **Safe when:** Uses Chainlink or equivalent tamper-resistant oracle, or TWAP with sufficient window.
- **Proof requires:** Show the oracle read, the manipulation vector, and the resulting exploitation.

**G27. Flash Loan Attack**

- **V:** Attacker borrows a large amount, manipulates a ratio (share price, collateral ratio, voting power), executes the exploit, repays in one tx.
- **Safe when:** Critical ratios use time-weighted values, or flash-loan-scale inputs are bounded.
- **Proof requires:** Show the loan, the manipulation, the exploit, and the profit after repayment.

**G28. Missing Deadline/Slippage Protection**

- **V:** A swap or trade has no deadline parameter and no minimum output check. A validator can hold the transaction and execute it when the price has moved unfavorably.
- **Safe when:** Function accepts a `deadline` parameter and a `minAmountOut`, both enforced.
- **Proof requires:** Show the unprotected swap and the sandwich attack.

**G29. Capacity Starvation**

- **V:** Multiple accounting variables share a capacity cap. An attacker fills one variable to exhaust the shared cap, blocking the other variable permanently.
- **Safe when:** Each variable has an independent cap, or the shared cap cannot be consumed by a single actor.
- **Proof requires:** Show the shared cap, the consumption by one variable, and the resulting block.
