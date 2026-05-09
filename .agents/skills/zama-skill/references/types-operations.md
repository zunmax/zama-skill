# FHEVM Encrypted Types and Operations Reference

## Contents

- Type System
- Operations by Type
- Operation Details
- HCU (Homomorphic Complexity Units)
- Critical Gotchas

## Type System

All encrypted types are opaque `bytes32` handles on-chain. The coprocessor performs actual FHE computation.

### Available Types

| Solidity Type | Bit Width | Category |
|---------------|-----------|----------|
| `ebool` | 2 | Boolean |
| `euint8` | 8 | Unsigned integer |
| `euint16` | 16 | Unsigned integer |
| `euint32` | 32 | Unsigned integer |
| `euint64` | 64 | Unsigned integer |
| `euint128` | 128 | Unsigned integer |
| `eaddress` | 160 | Encrypted Ethereum address |
| `euint160` | 160 | **Declared but has ZERO FHE functions** - use `eaddress` instead |
| `euint256` | 256 | Large unsigned |

### Declared but Unusable: Signed Integers and Non-Standard Widths

`encrypted-types/EncryptedTypes.sol` declares all 32 signed-integer aliases as `bytes32` UDVTs:
`eint8`, `eint16`, `eint24`, `eint32`, `eint40`, `eint48`, `eint56`, `eint64`, `eint72`, `eint80`,
`eint88`, `eint96`, `eint104`, `eint112`, `eint120`, `eint128`, `eint136`, `eint144`, `eint152`,
`eint160`, `eint168`, `eint176`, `eint184`, `eint192`, `eint200`, `eint208`, `eint216`, `eint224`,
`eint232`, `eint240`, `eint248`, `eint256`. Plus the same 32 `externalEint*` aliases.

Likewise the file declares unsigned non-power-of-two widths `euint24`, `euint40`, `euint48`, ...,
`euint248` (and matching `externalEuint*`).

A bare `eint64 x;` or `euint40 y;` therefore COMPILES against `@fhevm/solidity@0.11.1`. What does
NOT compile is the first FHE operation: `@fhevm/solidity@0.11.1` ships zero `FHE.*` overloads for
any of these aliases (verified by grep of `lib/FHE.sol`). The first call site fails with
`Member "<op>" not found ... after argument-dependent lookup in type(library FHE)`.

Do NOT use signed `eint*` or non-power-of-two `euint*` widths. Stick to `ebool`, `euint8`,
`euint16`, `euint32`, `euint64`, `euint128`, `euint256`, and `eaddress` (and their `externalE*`
forms) - those have full FHE.* overload coverage.

### External Input Types

For function parameters receiving user-encrypted values:
`externalEbool`, `externalEuint8`, `externalEuint16`, `externalEuint32`, `externalEuint64`,
`externalEuint128`, `externalEuint256`, `externalEaddress`

These are `bytes32` values paired with a `bytes calldata inputProof`.

---

## Operations by Type

### ebool

| Category | Operations |
|----------|-----------|
| Logic | `FHE.and`, `FHE.or`, `FHE.xor`, `FHE.not` |
| Comparison | `FHE.eq`, `FHE.ne` |
| Conditional | `FHE.select` |
| Random | `FHE.randEbool()` |

### euint8 through euint128 (full arithmetic)

| Category | Operations |
|----------|-----------|
| Arithmetic | `FHE.add`, `FHE.sub`, `FHE.mul`, `FHE.div`*, `FHE.rem`*, `FHE.neg`, `FHE.min`, `FHE.max` |
| Bitwise | `FHE.and`, `FHE.or`, `FHE.xor`, `FHE.not`, `FHE.shl`, `FHE.shr`, `FHE.rotl`, `FHE.rotr` |
| Comparison | `FHE.eq`, `FHE.ne`, `FHE.lt`, `FHE.le`, `FHE.gt`, `FHE.ge` |
| Conditional | `FHE.select` |
| Random | `FHE.randEuint8()`, `FHE.randEuint16()`, ... `FHE.randEuint128()`, `FHE.randEuint8(upperBound)`, ... (overload) |

*`FHE.div` and `FHE.rem` only accept a **plaintext** right-hand side. Passing an *encrypted* divisor is a Solidity compile error (`Member "div" not found ... after argument-dependent lookup` - no overload exists). At runtime, a plaintext zero divisor reverts with the custom error `DivisionByZero()` raised by `FHEVMExecutor` (NOT EVM `Panic(0x12)`).

### eaddress

| Category | Operations |
|----------|-----------|
| Comparison | `FHE.eq`, `FHE.ne` |
| Conditional | `FHE.select` |

No arithmetic, no bitwise, no ordering comparisons.

**Note**: `euint160` is declared in EncryptedTypes.sol at the same 160-bit width as `eaddress`,
but FHE.sol has **ZERO functions** for `euint160`. Only `eaddress` is usable. They are NOT
interchangeable - you cannot cast between them.

### euint256

| Category | Operations |
|----------|-----------|
| Bitwise | `FHE.and`, `FHE.or`, `FHE.xor`, `FHE.not`, `FHE.shl`, `FHE.shr`, `FHE.rotl`, `FHE.rotr` |
| Comparison | `FHE.eq`, `FHE.ne` |
| Conditional | `FHE.select` |
| Other | `FHE.neg`, `FHE.randEuint256()`, `FHE.randEuint256(upperBound)` (overload) |

No arithmetic (add/sub/mul/div/rem/min/max). No ordering (lt/le/gt/ge).

---

## Operation Details

### Arithmetic Overflow

All FHE arithmetic is **unchecked** - values wrap on overflow. This is intentional to preserve
confidentiality (overflow detection would leak information about encrypted values).

### Shift and Rotate Operations

**CRITICAL**: The shift/rotate amount parameter must be `uint8` (plaintext) or `euint8`
(encrypted), regardless of the first operand's bit width. Wider shift amounts do not compile.
This is an exception to the "scalar matches bit width" rule.

```solidity
/* CORRECT - plaintext uint8 shift amount */
FHE.shl(euint64Value, uint8(4));
FHE.shr(euint64Value, uint8(16));
FHE.rotl(euint64Value, uint8(8));
FHE.rotr(euint64Value, uint8(1));

/* CORRECT - encrypted euint8 shift amount */
FHE.shl(euint64Value, euint8ShiftAmount);

/* WRONG - wider shift amount does NOT compile */
FHE.shl(euint64Value, uint64(4));   /* NO plaintext overload */
FHE.shl(euint64Value, euint64Shift); /* NO encrypted overload - fails with
                                        Member "shl" not found */
```

The shift amount is computed modulo the bit width of the first operand:
- `FHE.shr(euint64 x, 70)` is equivalent to `FHE.shr(euint64 x, 6)` because `70 % 64 = 6`
- This differs from standard Solidity `>>` which would return 0 for shifts >= bit width

### Scalar vs Encrypted Operands

Most binary operations have two versions:
1. Both operands encrypted: `FHE.add(euint64, euint64)` - more expensive
2. One operand plaintext: `FHE.add(euint64, uint64)` - cheaper (use when possible)

```solidity
/* More expensive */
euint64 result = FHE.add(a, FHE.asEuint64(42));

/* Cheaper - prefer this */
euint64 result = FHE.add(a, 42);
```

**Exception - shift/rotate amounts**: always `uint8` or `euint8`, never the wider type. See "Shift and Rotate Operations" above.

### Type Casting

```solidity
/* Plaintext to encrypted */
euint64 enc = FHE.asEuint64(42);
ebool flag = FHE.asEbool(true);

/* Between encrypted types (upcasting) */
euint64 wide = FHE.asEuint64(narrowEuint8);
```

### Encrypted Conditional (select)

The ONLY way to do conditional logic on encrypted values:

```solidity
/* FHE.select(condition, valueIfTrue, valueIfFalse) */
euint64 result = FHE.select(FHE.le(amount, balance), FHE.sub(balance, amount), balance);
```

### Random Number Generation

Each encrypted type has its own rand function - replace the type suffix with the exact type you need:

```solidity
euint64 randomVal = FHE.randEuint64();             /* random encrypted 64-bit value */
euint32 bounded = FHE.randEuint32(128);             /* random 0 to 127 (upperBound MUST be power of 2) */
euint8 small = FHE.randEuint8();                   /* random encrypted 8-bit value */
ebool coinFlip = FHE.randEbool();                  /* random encrypted boolean */
euint256 big = FHE.randEuint256();                 /* random encrypted 256-bit value */
/* Bounded random uses an OVERLOAD of the same function name:
   FHE.randEuint32()       -> full-range random
   FHE.randEuint32(128)    -> bounded random [0, 127]
   CRITICAL: upperBound MUST be a power of 2. Non-power-of-2 values cause
   `revert NotPowerOfTwo()` at runtime (enforced by FHEVMExecutor).
   There is NO "FHE.randBoundedEuintXX()" - that function does not exist.
   Pattern: FHE.randEuint{8,16,32,64,128,256}() or FHE.randEuint{8,16,32,64,128,256}(powerOf2) */

/* For non-power-of-2 ranges, generate with next power of 2, then use FHE.rem: */
euint32 raw = FHE.randEuint32(128);    /* [0, 127] - power of 2 */
euint32 d100 = FHE.rem(raw, 100);      /* [0, 99]  - plaintext divisor required */
```

---

## HCU (Homomorphic Complexity Units)

Each FHE operation costs HCU. The caps and per-operation costs ARE defined in installed source
at `@fhevm/host-contracts/contracts/HCULimit.sol` (NOT in `@fhevm/solidity/lib/FHE.sol`, which
is why a `grep HCU` of the latter returns zero hits). Treat the values below as installed-source
tier; the live coprocessor mirrors `HCULimit.sol`.

Verified constants (`HCULimit.sol`):
- `MAX_HOMOMORPHIC_COMPUTE_UNITS_PER_TX = 20_000_000` (line 54).
- `MAX_HOMOMORPHIC_COMPUTE_UNITS_DEPTH_PER_TX = 5_000_000` (line 50).
- Exceeding either reverts the transaction at the coprocessor.

**Per-op costs** (verified ranges from `checkHCUForFhe*` functions in `HCULimit.sol`):
- `checkHCUForFheAdd` (line 91): ~84k-259k HCU
- `checkHCUForFheMul` (line 195): ~122k-1,686k HCU
- `checkHCUForFheDiv` (line 246): ~210k-1,225k HCU
- `checkHCUForFheRem` (line 280): ~440k-1,943k HCU
- Bitwise / comparison / cast / trivialEncrypt: see `HCULimit.sol` for exact ranges per bit width.

**Optimization**: Use the smallest type that fits your data. `euint8` operations cost ~2-10x less than `euint128`.

### Budgeting per Function

A single transaction has 20M total HCU and 5M sequential-depth HCU (`HCULimit.sol:50, 54`).
The total cap charges every op linearly. The depth cap charges by data dependency:
`totalHCU = opHCU + max(depth(input1), depth(input2), ...)` (`HCULimit.sol:1388-1437`),
so independent ops do NOT compound depth - only chains where each op feeds the next do.

**Per-op HCU at `euint64`** (encrypted-encrypted form, the default for state-mutation patterns
like `_balances[user] = FHE.add(_balances[user], amount)`; verified at `HCULimit.sol`):

| Op | HCU @ euint64 | Source line |
|---|---|---|
| `FHE.add(euint, euint)`     | 162,000 | `HCULimit.sol:124` |
| `FHE.mul(euint, euint)`     | 596,000 | `HCULimit.sol:228` |
| `FHE.div(euint, uintN)`     | 715,000 | `HCULimit.sol:263` (only scalar RHS exists) |
| `FHE.le(euint, euint)`      | 149,000 | `HCULimit.sol:984` |
| `FHE.select` (`IfThenElse`) |  55,000 | `HCULimit.sol:1289` |

**Iterations before each cap (sequential chain, each result feeds the next):**

| Op chain | Total cap (20M) | Depth cap (5M) |
|---|---|---|
| `FHE.add`                        | 123 | 30 |
| `FHE.mul`                        |  33 |  8 |
| `FHE.div(euint64, uint64)`       |  27 |  6 |
| `FHE.le` + `FHE.select` per item |  98 | 24 |

The depth cap is the binding constraint for sequential `FHE.mul` / `FHE.div` chains. Two rules
follow:

1. **Mul or div in a loop is the first thing to budget.** An 8-iteration `FHE.mul` chain on
   `euint64` already costs ~4.8M depth - one more iteration reverts with
   `HCUTransactionDepthLimitExceeded()`.
2. **Reshape sequential reductions as trees.** A function that fans out 30 independent `FHE.add`
   calls and reduces them pairwise has depth = log2(30) ~= 5 levels (each level adds one
   `FHE.add`), so depth ~5 * 162k = 810k - well under 5M. The same 30 adds done in series would
   spend ~4.86M depth and leave no margin.

Use `fhevm.computeTransactionHCU(receipt)` in tests (returns `{ globalHCU, maxHCUDepth,
HCUDepthByHandle }`) to measure the exact spend before shipping. Splitting work across two
transactions is the standard fix - persist the intermediate handle with `FHE.allowThis` and
`FHE.allow(_, msg.sender)` and let the user follow up with a second call.

---

## Critical Gotchas

> Non-obvious FHE.sol behaviors that agents consistently get wrong. Applies to `@fhevm/solidity@^0.11.1`.

### 1. Cross-Type Operations Auto-Upcast

Binary operations (add, sub, mul, eq, ne, lt, le, gt, ge, min, max, and, or, xor) support
**cross-type operands**. The result type is the WIDER of the two:

```solidity
/* VALID - auto-upcasts euint8 to euint64, returns euint64 */
euint64 result = FHE.add(euint8Value, euint64Value);

/* VALID - all cross-type combinations between euint8/16/32/64/128 */
euint128 big = FHE.mul(euint32Value, euint128Value);

/* INVALID - euint256 does NOT support cross-type arithmetic (no arithmetic at all) */
/* INVALID - eaddress does NOT support cross-type operations */
```

There are 35 overloads of `add` alone (5x5 encrypted-encrypted pairs + 5x2 scalar directions).

### 2. `FHE.select()` Requires EXACT Same Type for Both Branches

Unlike arithmetic ops, `select` does NOT support cross-type branches:

```solidity
/* VALID */
euint64 result = FHE.select(cond, euint64A, euint64B);

/* INVALID - will not compile */
euint64 result = FHE.select(cond, euint8Value, euint64Value);
```

**Fix**: Cast the narrower type first: `FHE.select(cond, FHE.asEuint64(euint8Value), euint64Value)`.

### 3. `isInitialized()` Checks Handle != 0, NOT Value != 0

```solidity
euint64 encZero = FHE.asEuint64(0);
FHE.isInitialized(encZero);  /* returns TRUE - handle is non-zero */

euint64 defaultVal;           /* Solidity default = zero bytes32 */
FHE.isInitialized(defaultVal); /* returns FALSE - handle IS zero */
```

An encrypted zero has a non-zero handle (the coprocessor assigns a unique handle for every encryption).
`isInitialized` checks whether the handle bytes are non-zero, not whether the encrypted value is zero.

### 4. `allow`/`allowThis`/`makePubliclyDecryptable` Return the Value AND Auto-Initialize

```solidity
/* These functions RETURN the encrypted value (chainable): */
_balances[user] = FHE.allowThis(FHE.add(a, b));  /* valid chaining */

/* DANGER: Calling on uninitialized handles silently creates encrypted zero: */
euint64 unset;
FHE.allowThis(unset);  /* Does NOT revert - creates encrypted 0 and allows it */
```

If you call `FHE.allowThis()` on an uninitialized handle (zero bytes32), it calls `asEuint64(0)`
internally and allows the resulting encrypted zero. This can mask bugs where computation was skipped.

### 5. Scalar Operand Type Must Match the Encrypted Type's Width (Except Shifts)

```solidity
/* The plaintext type must match the encrypted type's bit width: */
FHE.add(euint64Value, uint64(42));  /* CORRECT */
FHE.add(euint8Value, uint8(42));    /* CORRECT */

/* A Solidity integer literal auto-fits the encrypted type when it is representable in that type's bit width: */
FHE.add(euint64Value, 42);          /* CORRECT - 42 fits in uint64 */

/* EXCEPTION: shift/rotate amounts are ALWAYS uint8, regardless of encrypted type: */
FHE.shl(euint64Value, uint8(4));    /* CORRECT - uint8, NOT uint64 */
FHE.shr(euint128Value, uint8(16));  /* CORRECT - still uint8 */
/* FHE.shl(euint64Value, uint64(4)); - WRONG, will not compile */
```

### 6. `checkSignatures` Reverts on Failure (Does NOT Return bool)

```solidity
/* checkSignatures reverts with InvalidKMSSignatures() on invalid proof */
FHE.checkSignatures(cts, cleartexts, proof);
/* If you reach this line, the proof is valid */

/* There is also a VIEW variant that returns bool (use with caution): */
bool valid = FHE.isPublicDecryptionResultValid(cts, cleartexts, proof);
/* WARNING: The source code itself warns against this - if you forget to
   require(valid), invalid proofs silently pass. Prefer checkSignatures. */
```

### 7. `FheType` Enum Has Many More Types Than FHE.sol Supports

The `FheType` enum in `FheType.sol` includes `Uint512`, `Uint1024`, `Uint2048`, `AsciiString`,
odd-width types (`Uint6`, `Uint10`, `Uint14`...), and all signed types. These exist in the
coprocessor protocol but have **NO functions in FHE.sol**. Do NOT attempt to use them.

Only these types have FHE.sol functions: `ebool`, `euint8`, `euint16`, `euint32`, `euint64`,
`euint128`, `eaddress`, `euint256`. (`euint160` is declared but has zero functions.)

### 8. `ZamaEthereumConfig` Works on THREE Chains

From `ZamaConfig.sol`, `ZamaEthereumConfig` auto-detects:
- **Chain 1** (Ethereum mainnet) - LIVE since 2025-12-30. Addresses in `_getEthereumConfig()` are
  real deployed contracts; the inline source comment claiming "placeholders" was never updated
  post-deployment (see `anti-patterns.md` #31).
- **Chain 11155111** (Sepolia) - testnet addresses (deployed).
- **Chain 31337** (Hardhat local) - mock addresses injected by `@fhevm/hardhat-plugin` on test startup.

Any other chain ID causes `revert ZamaProtocolUnsupported()`.

### 9. `fromExternal()` Has Two Code Paths

```solidity
/* Path 1 (normal): inputProof.length != 0 -> verifies ZK proof */
euint64 amount = FHE.fromExternal(encAmount, inputProof);

/* Path 2 (re-use): inputProof.length == 0 -> treats handle as raw bytes32.
   First: if the handle is zero, returns the type-matched encrypted zero
   immediately (asEbool(false) / asEuintXX(0) / asEaddress(address(0)))
   WITHOUT performing an ACL check.
   Otherwise: checks that msg.sender has ACL permission on the handle and
   reverts with SenderNotAllowedToUseHandle(bytes32, address) if not
   (declared FHE.sol:74; first revert site at FHE.sol:8502; analogous
   reverts in each fromExternal overload).
   Path 2 is for internal re-use, NOT for user-submitted inputs. */
```

After `fromExternal`, only the calling CONTRACT has TRANSIENT ACL on the resulting handle
(verified at `Impl.sol:670-674` and `FHEVMExecutor.sol:713-727`). The user EOA who supplied
the proof gets no ACL automatically. Call `FHE.allowThis(amount)` for cross-tx contract use
and `FHE.allow(amount, msg.sender)` to let the user decrypt.

---

## Trivial Encryption Is Not Encryption

`FHE.asEuintXX(literal)`, `FHE.asEbool(literal)`, and `FHE.asEaddress(literal)` perform **trivial encryption**: they convert a Solidity plaintext value into the on-chain handle/UDVT format that FHE operations accept. The original plaintext value REMAINS PUBLICLY VISIBLE: it sits in the transaction calldata, in the bytecode if it is a constant, and in any block explorer that decodes the call. Per `https://docs.zama.org/protocol/solidity-guides/v0.11/smart-contract/operations/casting.md`: "the data is made compatible with FHE operations but remains publicly visible on-chain unless explicitly encrypted."

**Use `asEuintXX(literal)` when:**

- Initializing an encrypted-zero counter (`FHE.asEuint64(0)`); zero is never secret.
- Loop sentinels and constants (`euint8 NO_ERROR = FHE.asEuint8(0)`).
- Mixing a public scalar into an encrypted op (`FHE.add(privateBalance, FHE.asEuint64(1))` to increment by 1).
- Boundary constants (`FHE.le(amount, FHE.asEuint64(MAX_PER_TX))`).

**Do NOT use `asEuintXX(...)` for user-submitted private input.** Writing `FHE.asEuint64(userParam)` makes `userParam` plaintext on-chain, defeating the entire FHEVM threat model. To accept private input from a user, use `FHE.fromExternal(externalEuint64, inputProof)` after the user encrypted the value client-side via `instance.createEncryptedInput(...).add64(...).encrypt()`.

### Casting between encrypted widths

| Direction | Function | Behavior |
|---|---|---|
| smaller -> larger (`euint8` -> `euint64`) | `FHE.asEuint64(narrowEuint8)` | Preserves value (zero-extension) |
| larger -> smaller (`euint64` -> `euint8`) | `FHE.asEuint8(wideEuint64)` | Truncates high bits (lossy by design) |
| `ebool` -> `euintXX` | `FHE.asEuintXX(eboolValue)` | `1` or `0` in the target width |
| `euintXX` -> `ebool` | `FHE.asEbool(value)` | True if non-zero, false if zero |
| `address` -> `eaddress` | `FHE.asEaddress(addr)` | Trivial encryption, address stays plaintext |

There is NO `FHE.asEbool8`, `asEbool16`, etc. - `ebool` is always 1 bit, no width suffix exists. Writing `FHE.asEbool32(...)` is a compile error.

A handle returned by `asEuintXX(literal)` IS still an encrypted handle from the EVM's point of view (it is a `bytes32`, not a plain `uint`). The FHE coprocessor produces a real ciphertext for it. The only privacy claim that fails is the inference one: anyone reading the tx can see the plaintext that went in. So if the value should be private, it must reach the contract through `fromExternal`, not through `asEuintXX`.
