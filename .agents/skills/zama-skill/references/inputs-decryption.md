# FHEVM Input Handling and Decryption Reference

## Contents

- Part 1: Encrypted Inputs
- Part 2: Public Decryption (Three-Step Flow)
- Part 3: User Decryption (Private, EIP-712)
- Part 4: Encrypted Error Handling Pattern

## Part 1: Encrypted Inputs

### What Is an Input Proof?

An input proof is a ZK (zero-knowledge) proof generated client-side that cryptographically binds an encrypted value to a specific contract address and user address. It proves the ciphertext was correctly formed without revealing the plaintext. The contract verifies this proof via `FHE.fromExternal()` - without it, an attacker could submit arbitrary `bytes32` handles (replay from other contracts, forged values, or handles belonging to other users). The proof prevents handle forgery, cross-contract replay, and cross-user replay.

### Solidity Side

User-submitted encrypted values use `external` types + input proof:

```solidity
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external {
    euint64 amount = FHE.fromExternal(encAmount, inputProof);
    euint64 newBalance = FHE.add(_balances[msg.sender], amount);
    _balances[msg.sender] = newBalance;

    /* ACL: grant this contract access to use newBalance in FUTURE transactions.
       Without allowThis, the contract loses access to this handle after the tx ends.
       (See Zama docs: "allowThis authorizes the contract to reuse a ciphertext in future transactions") */
    FHE.allowThis(newBalance);

    /* ACL: grant the user access so they can decrypt their own balance */
    FHE.allow(newBalance, msg.sender);
}
```

**When to call ACL functions:**
- `FHE.allowThis(result)` - call on every encrypted value you STORE in a state variable (required for the contract to use it in future transactions)
- `FHE.allow(result, user)` - call on stored values the user needs to decrypt or read
- For intermediate values passed to OTHER contracts within the same tx, use `FHE.allowTransient(result, targetContract)` - this is cheaper (transient storage) and expires after the tx

**Available external types**: `externalEbool`, `externalEuint8`, `externalEuint16`, `externalEuint32`,
`externalEuint64`, `externalEuint128`, `externalEuint256`, `externalEaddress`

**CRITICAL**: Use `FHE.fromExternal(externalVal, inputProof)` - NOT `FHE.asEuint64()`.
`FHE.asEuint64()` is for plaintext-to-encrypted conversion only.

### Frontend Side (Relayer SDK)

```typescript
import { createInstance, initSDK, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';

await initSDK();
const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });

/* Create and encrypt input */
const input = instance.createEncryptedInput(contractAddress, userAddress);
input.add64(1000n);  /* add a 64-bit value */
const encrypted = await input.encrypt();

/* Send to contract */
const tx = await contract.deposit(encrypted.handles[0], encrypted.inputProof);
```

**Encryption methods**: `addBool`, `add8`, `add16`, `add32`, `add64`, `add128`, `add256`, `addAddress`

**Limits**: Max 2048 bits total, max 256 variables per input batch. (Verified by error-message strings in `@zama-fhe/relayer-sdk/lib/internal.js`: "Packing more than 2048 bits ..." and "Packing more than 256 variables ..." - the numeric limits are not exported as named constants.)

### Hardhat Test Side

```typescript
import { fhevm } from "hardhat";

const input = fhevm.createEncryptedInput(contractAddress, signers.alice.address);
input.add64(1000n);
const encrypted = await input.encrypt();

const tx = await contract.deposit(encrypted.handles[0], encrypted.inputProof);
await tx.wait();
```

---

## Part 2: Public Decryption (Three-Step Flow)

The v0.8 `FHE.requestDecryption()` and `GatewayCaller` are **REMOVED** in v0.9.
There is no on-chain oracle/gateway anymore. Instead, your dApp (frontend or backend script)
drives the decryption by calling the relayer SDK off-chain and relaying the result back on-chain.
This is called "self-relaying" because your application relays the decrypted value, not a third-party gateway.

### Step 1: On-Chain - Mark as Publicly Decryptable

```solidity
function requestClearResult() external {
    require(FHE.isInitialized(_encryptedResult), "Not initialized");
    FHE.makePubliclyDecryptable(_encryptedResult);
    /* Emit event so off-chain client knows to decrypt */
    emit DecryptionRequested(FHE.toBytes32(_encryptedResult));
}
```

### Step 2: Off-Chain - Decrypt via Relayer SDK

```typescript
import { createInstance, SepoliaConfig } from '@zama-fhe/relayer-sdk/web';

const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });

/* Get the handle(s) to decrypt */
const handles = [handle1, handle2];

/* Call publicDecrypt - returns cleartext + proof */
const results = await instance.publicDecrypt(handles);

/* Access decrypted values */
const clearValue1 = results.clearValues[handle1];  /* bigint | boolean | hex */
const clearValue2 = results.clearValues[handle2];

/* Get the proof and encoded values for on-chain verification */
const abiEncoded = results.abiEncodedClearValues;
const proof = results.decryptionProof;
```

**CRITICAL**: Use `results.clearValues[handle]` - NOT `results.values[handle]` (wrong field name).

**Return type**:
```typescript
type PublicDecryptResults = {
    clearValues: Record<`0x${string}`, bigint | boolean | `0x${string}`>;
    abiEncodedClearValues: `0x${string}`;
    decryptionProof: `0x${string}`;
};
```

### Step 3: On-Chain - Verify Signatures and Finalize

```solidity
function finalizeClearResult(
    uint64 clearResult,
    bytes calldata decryptionProof
) external {
    /* Build the handles list - MUST match the order used in publicDecrypt.
       FHE.toBytes32() converts a typed encrypted value (euint64, ebool, eaddress, etc.)
       into its raw bytes32 handle, which is what checkSignatures expects. */
    bytes32[] memory cts = new bytes32[](1);
    cts[0] = FHE.toBytes32(_encryptedResult);

    /* ABI-encode the cleartext values in the same order.
       The cleartext Solidity type MUST match the encrypted type:
       euint64 -> uint64, euint32 -> uint32, ebool -> bool, eaddress -> address.
       For multiple values: abi.encode(val1, val2, ...) matching cts[] order. */
    bytes memory cleartexts = abi.encode(clearResult);

    /* Verify - reverts if proof is invalid */
    FHE.checkSignatures(cts, cleartexts, decryptionProof);

    /* Safe to use clearResult now */
    _clearResult = clearResult;
}
```

**CRITICAL**: Handle ordering is cryptographically binding. The proof for `[handleA, handleB]` is
different from `[handleB, handleA]`. The order in `cts` MUST match the order passed to `publicDecrypt`.

**Function signature**: `FHE.checkSignatures(bytes32[] memory, bytes memory, bytes memory)`
- NOT `checkSignatures(uint256, bytes, bytes[])` (v0.8 signature)
- NOT `FHE.verifySignatures()` (wrong name)

---

## Part 3: User Decryption (Private, EIP-712)

For values that should only be visible to a specific user (e.g., checking your own balance):

### Hard Limits (source-verified)

The relayer SDK enforces three numeric caps on every `userDecrypt` call. Hitting any of them
throws synchronously before the request reaches the KMS.

| Limit | Value | Source |
|-------|-------|--------|
| Total ciphertext width per call | `<= 2048 bits` | `@zama-fhe/relayer-sdk/src/relayer/decryptUtils.ts` `check2048EncryptedBits` (throws `"Cannot decrypt more than 2048 encrypted bits in a single request"`) |
| Contract addresses per call | `<= 10` | `@zama-fhe/relayer-sdk/src/relayer/userDecrypt.ts` `MAX_USER_DECRYPT_CONTRACT_ADDRESSES = 10` |
| EIP-712 grant duration | `<= 365 days` | `@zama-fhe/relayer-sdk/src/relayer/userDecrypt.ts` `MAX_USER_DECRYPT_DURATION_DAYS = BigInt(365)` |

Practical batching against the 2048-bit cap: 1x `euint256`, 2x `euint128`, 4x `euint64`+`euint128`,
up to 32x `euint64`, or 256x `euint8`. Mix freely up to the total. For requests exceeding the cap,
issue parallel `userDecrypt` calls; the 365-day signed grant covers all of them.

### Frontend

```typescript
/* Generate ephemeral keypair */
const keypair = instance.generateKeypair();

/* Create EIP-712 typed data for signing */
const eip712 = instance.createEIP712(
    keypair.publicKey,
    [contractAddress],  /* list of contract addresses */
    startTimestamp,      /* validity start */
    durationDays         /* how many days the permission lasts */
);

/* User signs the EIP-712 message - drop EIP712Domain (ethers v6 derives it)
   and cast away SDK readonly tuples. */
const { EIP712Domain: _omit, ...typesWithoutDomain } = eip712.types;
const signature = await signer.signTypedData(
    eip712.domain,
    typesWithoutDomain as unknown as Record<string, Array<{ name: string; type: string }>>,
    eip712.message
);

/* Decrypt */
const clearValues = await instance.userDecrypt(
    [{ handle, contractAddress }],  /* handle-contract pairs */
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [contractAddress],
    userAddress,
    startTimestamp,
    durationDays
);
```

### Hardhat Test (3 Different Functions!)

```typescript
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/* For euint types - FhevmType parameter IS REQUIRED */
const clearUint: bigint = await fhevm.userDecryptEuint(
    FhevmType.euint64,   /* FhevmTypeEuint - REQUIRED */
    encryptedHandle,      /* string (bytes32 hex) */
    contractAddress,      /* ethers.AddressLike */
    signers.alice         /* ethers.Signer */
);

/* For ebool - NO FhevmType parameter */
const clearBool: boolean = await fhevm.userDecryptEbool(
    encryptedHandle,      /* string - NO FhevmType here */
    contractAddress,      /* ethers.AddressLike */
    signers.alice         /* ethers.Signer */
);

/* For eaddress - NO FhevmType parameter */
const clearAddr: string = await fhevm.userDecryptEaddress(
    encryptedHandle,      /* string - NO FhevmType here */
    contractAddress,      /* ethers.AddressLike */
    signers.alice         /* ethers.Signer */
);
```

**CRITICAL**: `userDecryptEbool` and `userDecryptEaddress` do NOT take a FhevmType parameter.
Only `userDecryptEuint` requires it. This is the #1 Hardhat testing mistake.

### Public Decrypt in Hardhat Tests

```typescript
const clearUint = await fhevm.publicDecryptEuint(FhevmType.euint64, handle);
const clearBool = await fhevm.publicDecryptEbool(handle);
const clearAddr = await fhevm.publicDecryptEaddress(handle);
```

Same signature pattern: `publicDecryptEuint` takes FhevmType, the others don't.

---

## Part 4: Encrypted Error Handling Pattern

You CANNOT revert based on an encrypted condition. `require(FHE.le(...))` is a Solidity compile error because `ebool` is a `bytes32` UDVT with no implicit `bool` conversion. The vulnerable shape is when a developer routes around it by unwrapping the handle (`ebool.unwrap(r) != bytes32(0)`) - the handle is always non-zero so this always passes silently. To surface a logical error that depends on an encrypted value, use the **encrypted error-code register** documented at `https://docs.zama.org/protocol/solidity-guides/v0.11/smart-contract/logics/error_handling.md`.

### Pattern

Store an encrypted error sentinel per user, set it via `FHE.select`, and let the frontend decrypt it.

```solidity
contract Vault is ZamaEthereumConfig {
    /* Sentinels - declare once and reuse across all error sites. */
    euint8 private NO_ERROR;          /* 0 = success */
    euint8 private NOT_ENOUGH_FUNDS;  /* 1 = insufficient balance */
    euint8 private FROZEN_ACCOUNT;    /* 2 = account is frozen */

    struct LastError {
        euint8 error;
        uint256 timestamp;
    }
    mapping(address => LastError) private _lastErrors;
    mapping(address => euint64) private _balances;

    event ErrorChanged(address indexed user);

    constructor() {
        /* Trivial-encrypt the sentinels at deploy time and grant the contract permanent access. */
        NO_ERROR = FHE.asEuint8(0);
        NOT_ENOUGH_FUNDS = FHE.asEuint8(1);
        FROZEN_ACCOUNT = FHE.asEuint8(2);
        FHE.allowThis(NO_ERROR);
        FHE.allowThis(NOT_ENOUGH_FUNDS);
        FHE.allowThis(FROZEN_ACCOUNT);
    }

    function _setLastError(euint8 errorCode, address user) private {
        _lastErrors[user] = LastError(errorCode, block.timestamp);
        FHE.allowThis(errorCode);
        FHE.allow(errorCode, user);   /* user MUST be granted to read their own outcome */
        emit ErrorChanged(user);
    }

    function transfer(address to, externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        ebool canTransfer = FHE.le(amount, _balances[msg.sender]);

        /* Encrypted-conditional update: tx always succeeds, but the state changes
           only on the success branch. */
        euint64 newFrom = FHE.select(canTransfer, FHE.sub(_balances[msg.sender], amount), _balances[msg.sender]);
        euint64 newTo   = FHE.select(canTransfer, FHE.add(_balances[to], amount),         _balances[to]);

        _balances[msg.sender] = newFrom;
        _balances[to] = newTo;
        FHE.allowThis(newFrom); FHE.allow(newFrom, msg.sender);
        FHE.allowThis(newTo);   FHE.allow(newTo, to);

        /* Surface the outcome via the error register. */
        _setLastError(FHE.select(canTransfer, NO_ERROR, NOT_ENOUGH_FUNDS), msg.sender);
    }

    function getLastError(address user) external view returns (euint8 error, uint256 timestamp) {
        return (_lastErrors[user].error, _lastErrors[user].timestamp);
    }
}
```

### Why this works

- The on-chain function never reverts based on the encrypted condition; it always succeeds.
- State is updated unconditionally via `FHE.select` choosing between the "success" and "no-op" branches. The contract has no way to know on-chain which branch ran - the privacy property is preserved.
- The user calls `getLastError(addr)` and `userDecrypt`s the returned `euint8` to learn whether the last action succeeded and which error code fired.
- The `ErrorChanged(address indexed user)` event lets a frontend or indexer trigger a refresh without exposing any encrypted state in logs.

### Anti-patterns to reject during review

- `require(FHE.le(amount, balance))` - Solidity compile error. Even if a developer wraps it in a function that returns `bool`, that function would have to call `userDecrypt` synchronously (impossible on-chain).
- `if (ebool.unwrap(canTransfer) != bytes32(0)) revert(...)` - the UDVT-unwrap bypass. The handle is always non-zero, so this **always passes silently** and the revert never fires. Critical bug, not a feature.
- Returning the raw `ebool` from a public function for the frontend to decrypt - works for a single failure mode but loses the "why" code if multiple errors are possible. Use a `euint8` register.
- Forgetting `FHE.allow(errorCode, user)` - the user calls `getLastError`, gets a handle they cannot decrypt, the UI shows no progress.
- Storing the sentinels with `allowTransient` instead of `allowThis` in the constructor - on the next call site the contract loses access to its own sentinels and `FHE.select` reverts with `SenderNotAllowed`.

### Sentinel sizing

`euint8` (0..255) is enough for almost every error table. Use `euint16` only if you genuinely need >255 distinct codes. Do NOT use `euint32+` for an error register - 4x the HCU cost for no benefit.
