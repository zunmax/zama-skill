# FHEVM ACL (Access Control List) Reference

## Contents

- Overview
- Granting Access
- Checking Access
- Common ACL Patterns
- Common Mistakes
- Critical Gotchas

## Overview

Every encrypted value (handle) has an on-chain ACL managed by the ACL contract. A contract or user
must have explicit permission to use a handle in FHE operations. Without permission, operations revert.

---

## Granting Access

### `FHE.allow(ct, address)`
Permanently grants `address` access to ciphertext `ct`. Persists across transactions.

```solidity
euint64 balance = FHE.add(oldBalance, amount);
FHE.allow(balance, msg.sender);  /* caller can read/use this value */
FHE.allowThis(balance);          /* this contract can use it in future txs */
```

### `FHE.allowThis(ct)`
Shorthand for `FHE.allow(ct, address(this))`. Use after computing any value you need to store.

### `FHE.allowTransient(ct, address)`
Grants access only for the current transaction. Used for intermediate values passed between contracts.

```solidity
/* In ContractA */
euint64 result = FHE.add(a, b);
FHE.allowTransient(result, address(contractB));
contractB.processResult(result);

/* In ContractB - can use result within this tx only */
```

### `FHE.makePubliclyDecryptable(ct)`
Marks a ciphertext for public decryption. Anyone can then request its cleartext via the relayer SDK.
This is permanent and irreversible.

---

## Checking Access

These functions return **plaintext** `bool` - they CAN be used in `require()` and `if` statements.

| Function | Returns | Use Case |
|----------|---------|----------|
| `FHE.isAllowed(ct, address)` | `bool` | Check if address has access |
| `FHE.isSenderAllowed(ct)` | `bool` | Check if msg.sender has access |
| `FHE.isPubliclyDecryptable(ct)` | `bool` | Check if publicly decryptable |
| `FHE.isInitialized(ct)` | `bool` | Check if handle is non-zero |

```solidity
require(FHE.isSenderAllowed(_balance[msg.sender]), "No access to balance");
require(FHE.isInitialized(_balance[msg.sender]), "Balance not initialized");
```

---

## Common ACL Patterns

### Pattern 1: Store and Share

After any FHE computation that produces a value to be stored:

```solidity
function transfer(address to, externalEuint64 encAmount, bytes calldata proof) external {
    /* Self-transfer guard: writing to _balances[from] then _balances[to] when from == to
       overwrites the first write with the second, inflating balance by `amount`.
       This is P1 in the project's vulnerability catalog; ALWAYS include this guard. */
    require(msg.sender != to, "self-transfer");

    euint64 amount = FHE.fromExternal(encAmount, proof);

    ebool hasEnough = FHE.le(amount, _balances[msg.sender]);
    euint64 newSenderBal = FHE.select(hasEnough, FHE.sub(_balances[msg.sender], amount), _balances[msg.sender]);
    euint64 newRecvBal = FHE.select(hasEnough, FHE.add(_balances[to], amount), _balances[to]);

    _balances[msg.sender] = newSenderBal;
    _balances[to] = newRecvBal;

    /* ACL: contract needs access for future operations */
    FHE.allowThis(newSenderBal);
    FHE.allowThis(newRecvBal);

    /* ACL: users need access to read their own balances */
    FHE.allow(newSenderBal, msg.sender);
    FHE.allow(newRecvBal, to);
}
```

### Pattern 2: Return Encrypted Value to Caller

```solidity
function getBalance() external view returns (euint64) {
    /* The caller must already have ACL permission on this handle.
       This permission was granted earlier, e.g., when their balance was computed:
         FHE.allow(newBalance, msg.sender);
       If `allow` was never called for this address, the caller's decrypt request
       reverts with the ACL custom error `SenderNotAllowed(address)`
       (`@fhevm/host-contracts/contracts/ACL.sol:106`). */
    return _balances[msg.sender];
}
```

### Pattern 3: Cross-Contract Calls

```solidity
/* Granting transient access for cross-contract operations */
function delegateProcess(address processor, euint64 data) external {
    FHE.allowTransient(data, processor);
    IProcessor(processor).process(data);
}
```

### Pattern 4: Public Decryption Setup

```solidity
function revealResult() external {
    require(FHE.isInitialized(_result), "No result yet");
    FHE.makePubliclyDecryptable(_result);
    /* Now anyone can call publicDecrypt off-chain */
}
```

---

## Common Mistakes

1. **Forgetting `FHE.allowThis()`** after computing a new value - the contract loses access to its own data in future transactions
2. **Forgetting `FHE.allow(result, user)`** - the user cannot decrypt or use the value
3. **Calling `FHE.allowForDecryption(...)`** - no such helper exists on the FHE library. Use `FHE.makePubliclyDecryptable(handle)`. (Note: `IACL.allowForDecryption(bytes32[])` does exist on the host ACL contract at `@fhevm/host-contracts/contracts/ACL.sol:209`; `FHE.makePubliclyDecryptable` wraps it for the single-handle path via `Impl.sol:742`.)
4. **Checking ACL on encrypted bool** - `FHE.isAllowed()` returns plaintext bool, but the handle itself is still encrypted

---

## Critical Gotchas

> Non-obvious ACL behaviors that agents consistently get wrong. Applies to `@fhevm/solidity@^0.11.1`.

### 1. `allow()` / `allowThis()` / `makePubliclyDecryptable()` RETURN the Value

```solidity
/* These functions return the encrypted value - chainable: */
_balances[user] = FHE.allowThis(FHE.add(a, b));  /* VALID - saves a line */

/* Equivalent longhand: */
euint64 result = FHE.add(a, b);
FHE.allowThis(result);
_balances[user] = result;
```

This is convenient but can mask bugs if you forget the return value is the same handle, not a new one.

### 2. `allow()` / `allowThis()` Auto-Initialize Uninitialized Handles

```solidity
/* DANGER: Calling on uninitialized (zero) handles silently creates encrypted zero: */
euint64 unset;                  /* Solidity default: zero bytes32 */
FHE.allowThis(unset);           /* Does NOT revert! Internally calls asEuint64(0) */

/* After this, unset is now a VALID encrypted zero with permissions granted.
   This can mask bugs where computation was accidentally skipped. */
```

**Why this matters**: If a developer forgets to assign a value but remembers to call `allowThis`,
the code silently stores an encrypted zero instead of reverting. Guard with `FHE.isInitialized()`:

```solidity
require(FHE.isInitialized(result), "Computation result not set");
FHE.allowThis(result);
```

### 3. `makePubliclyDecryptable()` Is Permanent and Irreversible

```solidity
FHE.makePubliclyDecryptable(secretValue);
/* After this line, ANYONE can decrypt secretValue FOREVER.
   There is NO FHE.revokePubliclyDecryptable() or equivalent.
   Only call this on values that should become public. */
```

**Common mistake**: Calling `makePubliclyDecryptable` on a balance or intermediate value that
should remain private. Only use for final results that are meant to be public (e.g., auction winner,
vote tally, game outcome).

### 4. `fromExternal()` Grants TRANSIENT ACL to the CALLING CONTRACT, not to the user EOA

```solidity
euint64 amount = FHE.fromExternal(encAmount, inputProof);
/* At this point only the CALLING CONTRACT (address(this)) has TRANSIENT
   ACL on `amount` (verified at Impl.sol:670-674 -> IACL.allowTransient(result, msg.sender)
   and FHEVMExecutor.sol:713-727 -> acl.allowTransient(result, msg.sender), where
   msg.sender resolves to the contract that called FHE.fromExternal).
   The user EOA who supplied the proof gets NO ACL on this handle.
   Within this same tx the contract can use the handle; to persist it across txs
   AND let the user decrypt it back, you must add: */
FHE.allowThis(amount);          /* persistent contract ACL across txs */
FHE.allow(amount, msg.sender);  /* persistent user ACL for decryption */
```

`fromExternal` verifies the ZK proof and grants the calling contract transient ACL on the
resulting handle (current tx only). The user EOA gets no ACL automatically. If you store the
value without `allowThis`, the contract will revert with `SenderNotAllowed(address)` on the
next transaction when it tries to use that handle (custom error from
`@fhevm/host-contracts/contracts/ACL.sol:106`).

### 5. `isInitialized()` Checks Handle Bytes, NOT Encrypted Value

```solidity
euint64 encZero = FHE.asEuint64(0);
FHE.isInitialized(encZero);    /* returns TRUE - handle is non-zero */

euint64 defaultVal;              /* Solidity default = zero bytes32 */
FHE.isInitialized(defaultVal);  /* returns FALSE - handle IS zero */
```

An encrypted zero has a non-zero handle (the coprocessor assigns a unique handle for every encryption).
`isInitialized` checks whether the raw handle bytes are non-zero, not whether the encrypted value is zero.
Use it to detect "has this variable been assigned an encrypted value?" - not "is this value zero?"

### 6. Delegation Functions Exist for User Decryption Delegation

```solidity
/* FHE.sol exports delegation functions for user decryption: */
FHE.delegateUserDecryption(delegate, contractAddress, expirationDate);
FHE.delegateUserDecryptionWithoutExpiration(delegate, contractAddress);
FHE.delegateUserDecryptions(delegate, contractAddresses, expirationDate);              /* batch */
FHE.delegateUserDecryptionsWithoutExpiration(delegate, contractAddresses);             /* batch, no expiry */
FHE.revokeUserDecryptionDelegation(delegate, contractAddress);
FHE.revokeUserDecryptionDelegations(delegate, contractAddresses);          /* batch */

/* Check delegation status: */
bool ok = FHE.isDelegatedForUserDecryption(delegator, delegate, contractAddress, handle);
uint64 exp = FHE.getDelegatedUserDecryptionExpirationDate(delegator, delegate, contractAddress);
```

These let the *calling contract* (the delegator is `address(this)`, per `FHE.sol` NatSpec at
`delegateUserDecryption`) hand off the user-decryption rights it holds, for handles tied to a given
target contract, to a `delegate` address. They are NOT a user-to-user delegation primitive: they
are contract-to-delegate, evaluated in the context of `contractAddress`. Most contracts do not
need delegation - it is for advanced multi-sig, governance, and meta-tx patterns.

---

## Reorg Handling

ACL grants take effect the moment the transaction is mined. The gateway and KMS observe `Allowed` events on block inclusion, NOT after finality. On Ethereum mainnet, a reorg can drop blocks **up to 95 slots deep** in the worst case (~19 minutes at 12s/slot, per `https://docs.zama.org/protocol/solidity-guides/v0.11/smart-contract/acl/reorgs_handling.md`). If you grant decrypt access to a handle in a transaction that the network later reorges away, the recipient may have already decrypted the value during the reorg window. The leak is permanent. This is the **dApp developer's responsibility to mitigate** - the protocol does not roll back decryption.

### When this matters

- A buyer pays AND gets decrypt access to a private key / sealed bid / answer in the same transaction.
- A reveal flow where the caller earns access by triggering a state change.
- Any access grant whose business logic depends on a not-yet-final on-chain event.

If the leaked information would not be business-critical (regenerable, low-value, or already-public-eventually), skip the timelock - the pattern below adds UX friction. Apply only when leaked information would be critically important and high-value.

### Two-step ACL with finality timelock

Split the action that triggers the grant from the grant itself, and gate the grant by a `block.number` check that exceeds the worst-case reorg depth.

```solidity
mapping(address => uint256) private _purchaseBlock;
mapping(address => euint64) private _purchasedKey;

function buy(externalEuint64 keyHandle, bytes calldata proof) external payable {
    /* Take payment + record the block. Do NOT grant decrypt access yet. */
    _purchasedKey[msg.sender] = FHE.fromExternal(keyHandle, proof);
    FHE.allowThis(_purchasedKey[msg.sender]);
    _purchaseBlock[msg.sender] = block.number;
}

function claimAccess() external {
    require(_purchaseBlock[msg.sender] != 0, "Not a buyer");
    /* 95 = Ethereum mainnet worst-case reorg depth. Sepolia / L2s differ. */
    require(block.number > _purchaseBlock[msg.sender] + 95, "Too early to request ACL");
    FHE.allow(_purchasedKey[msg.sender], msg.sender);
}
```

The user pays in tx N, calls `claimAccess` in tx N+95+ (about 19 minutes later). A reorg that drops tx N also drops every dependent tx, so `claimAccess` cannot fire on a reorged-out purchase.

### Wrong shape (single-step grant)

```solidity
/* WRONG - leaks on reorg. The buyer can decrypt during the 95-block window
   even if buy() is reorged out. */
function buy(externalEuint64 keyHandle, bytes calldata proof) external payable {
    euint64 key = FHE.fromExternal(keyHandle, proof);
    FHE.allowThis(key);
    FHE.allow(key, msg.sender);  /* leak window starts here */
    _purchasedKey[msg.sender] = key;
}
```

### Reorg depth by network

| Network | Reorg depth budget | Notes |
|---|---|---|
| Ethereum mainnet (chainId 1) | 95 slots (~19 min) | Worst-case finality bound documented by Zama |
| Sepolia (11155111) | similar 95-slot budget | Same finality model; reuse the mainnet pattern |
| L2s | varies | Check the L2's reorg policy; many L2s have deeper or unbounded reorg risk via L1-derived state |
| Local Hardhat (31337) | not applicable | No reorgs in the in-process network |
