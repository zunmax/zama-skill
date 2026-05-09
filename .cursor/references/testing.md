# FHEVM Testing (Hardhat Plugin)

## Contents

- Known mock-utils limitations
- Setup
- Test Modes
- Encrypting Values in Tests
- Decrypting Values in Tests
- FhevmType Enum Reference
- Custom Hardhat Tasks
- Complete Test Example
- Critical Gotchas
- Foundry: NOT natively supported

## Known mock-utils limitations (`@fhevm/mock-utils@0.4.2`)

The mock coprocessor that runs during `npx hardhat test` is faster than the real KMS / coprocessor but does NOT match real-network behavior in every dimension. Open upstream issues (verified at https://github.com/zama-ai/fhevm-mocks/issues) the skill knows about:

- **HCU limits not enforced in mocks** (issue [#62](https://github.com/zama-ai/fhevm-mocks/issues/62), open). Real networks revert with `HCUTransactionLimitExceeded()` (per-tx 20M HCU) or `HCUTransactionDepthLimitExceeded()` (per-tx 5M depth). Mocks let the tx pass. Tests that look at gas / HCU efficiency should also run against `--network sepolia` before shipping.
- **Anvil restart -> "unknown handle" error** (issue [#4](https://github.com/zama-ai/fhevm-mocks/issues/4), open). Killing and restarting the local node mid-suite leaves the mock relayer with stale handles. Workaround: full `npx hardhat clean && npx hardhat node` between runs, or use the in-process Hardhat network instead of standalone Anvil.
- **`fhevm.assertCoprocessorInitialized` broken on `--network sepolia`** (issue [#64](https://github.com/zama-ai/fhevm-mocks/issues/64), open). The assertion helper assumes a local mock and throws when pointed at Sepolia. Skip the assertion in network-conditional code: `if (network.name === "hardhat") await fhevm.assertCoprocessorInitialized(...)`.
- **Custom Hardhat tasks need explicit init** (issue [#80](https://github.com/zama-ai/fhevm-mocks/issues/80), open). Tasks (not tests) must `await fhevm.initializeCLIApi()` BEFORE the first FHEVM call. Without it, the next coprocessor op reverts with "The Hardhat Fhevm plugin is not initialized." This is documented behavior, not a bug, but the error message is misleading.
- **Mocked relayer edge cases** (issue [#67](https://github.com/zama-ai/fhevm-mocks/issues/67), open). Specific input-proof shapes accepted by the real relayer can fail in the mock. If a test passes against `--network sepolia` but fails locally, the mock is the suspect, not your contract.
- **Mock decrypt does NOT enforce user ACL** (verified locally 2026-05-08 against `@fhevm/mock-utils@0.4.2`). On production, `userDecrypt` of a handle without `FHE.allow(handle, user)` reverts with `SenderNotAllowed(address)`. Under the mock, the same call succeeds and returns the cleartext. Implication: tests that rely on the ACL revert as a security check will pass locally and break on Sepolia. Always run a smoke pass against `--network sepolia` for any flow whose security depends on a missing-ACL revert.

The skill recommendation: write the suite against the in-process Hardhat network (fastest), then run a smoke pass against `--network sepolia` before tagging a release. Do not assume mock parity for HCU, gas, or relayer edge cases.

## Setup

### Install Dependencies

`@fhevm/hardhat-plugin@^0.4.2` targets Hardhat 2. A bare `npm install hardhat` resolves Hardhat 3 and breaks peer-dep resolution. `@zama-fhe/relayer-sdk` MUST be exact `0.4.1` (the plugin runtime-checks the version). `@nomicfoundation/hardhat-network-helpers` is opt-in - install it only when your tests actually call `time.increase`, `mine`, `setBalance`, `loadFixture`, or snapshots. If you do, pin the v1 line; the v3 line requires Hardhat 3.

```bash
npm install --save-dev \
  hardhat@^2.28.6 \
  @fhevm/hardhat-plugin@^0.4.2 \
  @fhevm/mock-utils@^0.4.2 \
  @nomicfoundation/hardhat-ethers@^3.1.3 \
  @nomicfoundation/hardhat-chai-matchers@^2.1.2 \
  ethers@^6.16.0 \
  typescript@^5.9.3 ts-node@^10.9.2 @types/node@^24.12.2 @types/mocha@^10.0.10 @types/chai@^4.3.20 chai@^4.5.0
# Pin the relayer SDK EXACT. --save-exact stops npm from rewriting "0.4.1" to "^0.4.1".
npm install --save-dev --save-exact @zama-fhe/relayer-sdk@0.4.1
# Optional, only if the test suite imports from it:
# npm install --save-dev @nomicfoundation/hardhat-network-helpers@^1.1.2
```

### Configure Hardhat

```typescript
/* hardhat.config.ts */
import { HardhatUserConfig } from "hardhat/config";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: { enabled: true, runs: 800 },
            evmVersion: "cancun",
        },
    },
};
export default config;
```

### Import in Tests

```typescript
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { ethers } from "hardhat";
```

---

## Test Modes

| Mode | Encryption | Speed | Persistence | Use Case |
|------|-----------|-------|-------------|----------|
| `--network hardhat` | Mock | Very fast | None | Unit tests, CI |
| `--network localhost` | Mock | Fast | Yes (node) | Frontend integration |
| `--network sepolia` | Real | Slow | Yes (chain) | Full stack validation |

```bash
# Fast local testing
npx hardhat test --network hardhat

# Persistent local testing (start node first: npx hardhat node)
npx hardhat test --network localhost

# Real encryption on Sepolia
npx hardhat clean && npx hardhat compile --network sepolia
npx hardhat test --network sepolia
```

---

## Encrypting Values in Tests

```typescript
const signers = await ethers.getSigners();
const contractAddress = await contract.getAddress();

/* Create encrypted input */
const input = fhevm.createEncryptedInput(contractAddress, signers[0].address);

/* Add values to encrypt */
input.add64(1000n);       /* euint64 */
input.add8(42);           /* euint8 */
input.addBool(true);      /* ebool */
input.addAddress("0x..."); /* eaddress */

/* Encrypt */
const encrypted = await input.encrypt();

/* Use in contract call */
const tx = await contract.someFunction(
    encrypted.handles[0],    /* first handle */
    encrypted.handles[1],    /* second handle */
    encrypted.inputProof     /* shared proof for all handles */
);
await tx.wait();
```

---

## Decrypting Values in Tests

### User Decrypt (requires ACL permission)

```typescript
/* For euint types - FhevmType IS REQUIRED as first param */
const clearUint64: bigint = await fhevm.userDecryptEuint(
    FhevmType.euint64,        /* FhevmTypeEuint (NOT full FhevmType) */
    encryptedHandle,           /* string (bytes32 hex) */
    contractAddress,           /* ethers.AddressLike */
    signers[0]                 /* ethers.Signer */
);

/* For ebool - NO FhevmType param */
const clearBool: boolean = await fhevm.userDecryptEbool(
    encryptedHandle,           /* string */
    contractAddress,           /* ethers.AddressLike */
    signers[0]                 /* ethers.Signer */
);

/* For eaddress - NO FhevmType param */
const clearAddr: string = await fhevm.userDecryptEaddress(
    encryptedHandle,           /* string */
    contractAddress,           /* ethers.AddressLike */
    signers[0]                 /* ethers.Signer */
);
```

### Public Decrypt (value must be marked publicly decryptable)

```typescript
const clearUint = await fhevm.publicDecryptEuint(
    FhevmType.euint64,
    encryptedHandle
);
/* No signer or contractAddress needed - value is publicly decryptable */

const clearBool = await fhevm.publicDecryptEbool(encryptedHandle);
const clearAddr = await fhevm.publicDecryptEaddress(encryptedHandle);
```

---

## FhevmType Enum Reference

```typescript
enum FhevmType {
    ebool = 0,
    euint4 = 1,     /* deprecated - do not use */
    euint8 = 2,
    euint16 = 3,
    euint32 = 4,
    euint64 = 5,
    euint128 = 6,
    eaddress = 7,
    euint256 = 8,
}
```

---

## Custom Hardhat Tasks

Custom tasks require explicit FHEVM initialization (tests auto-initialize):

```typescript
import { FhevmType } from "@fhevm/hardhat-plugin";

task("my-task", "Description")
    .setAction(async function (taskArgs, hre) {
        const { ethers, deployments, fhevm } = hre;

        /* REQUIRED for custom tasks - tests don't need this */
        await fhevm.initializeCLIApi();

        /* Now use fhevm API normally */
        const input = fhevm.createEncryptedInput(addr, signer.address);
        /* ... */
    });
```

---

## Complete Test Example

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("ConfidentialERC20", function () {

    it("should mint and transfer encrypted tokens", async function () {
        const signers = await ethers.getSigners();
        const [alice, bob] = signers;

        /* Deploy - constructor takes (string name, string symbol) */
        const Factory = await ethers.getContractFactory("ConfidentialERC20");
        const token = await Factory.deploy("Confidential Token", "CTKN");
        await token.waitForDeployment();
        const tokenAddr = await token.getAddress();

        /* Mint 1000 tokens to Alice - mint(address to, externalEuint64, bytes proof) */
        const mintInput = fhevm.createEncryptedInput(tokenAddr, alice.address);
        mintInput.add64(1000n);
        const mintEnc = await mintInput.encrypt();
        const mintTx = await token.connect(alice).mint(
            alice.address, mintEnc.handles[0], mintEnc.inputProof
        );
        await mintTx.wait();

        /* Verify Alice's balance */
        const aliceBalHandle = await token.balanceOf(alice.address);
        const aliceBal = await fhevm.userDecryptEuint(
            FhevmType.euint64, aliceBalHandle, tokenAddr, alice
        );
        expect(aliceBal).to.equal(1000n);

        /* Transfer 300 to Bob */
        const xferInput = fhevm.createEncryptedInput(tokenAddr, alice.address);
        xferInput.add64(300n);
        const xferEnc = await xferInput.encrypt();
        const xferTx = await token.connect(alice).transfer(
            bob.address, xferEnc.handles[0], xferEnc.inputProof
        );
        await xferTx.wait();

        /* Verify Bob's balance */
        const bobBalHandle = await token.balanceOf(bob.address);
        const bobBal = await fhevm.userDecryptEuint(
            FhevmType.euint64, bobBalHandle, tokenAddr, bob
        );
        expect(bobBal).to.equal(300n);
    });
});
```

---

## Critical Gotchas

> Non-obvious plugin behaviors that agents consistently get wrong. Applies to `@fhevm/hardhat-plugin@^0.4.2`.

### 1. Plugin `fhevm` Object Replaces SDK `instance`

```typescript
/* Hardhat plugin - call on fhevm object directly */
const input = fhevm.createEncryptedInput(contractAddress, userAddress);

/* SDK (browser) - create instance first with config */
const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });
const input = instance.createEncryptedInput(contractAddress, userAddress);
```

Both have the same `createEncryptedInput(contractAddress: string, userAddress: string)` signature.
The plugin's `fhevm` object (from `hre.fhevm`) replaces the SDK's `instance`.

`fhevm.createInstance()` exists on the implementation class (`FhevmExternalAPI`) but is NOT
on the public typed interface (`HardhatFhevmRuntimeEnvironment`). TypeScript will flag the
call. Tests rarely need it; `createEncryptedInput`/`userDecrypt*`/`publicDecrypt*` already
manage the underlying instance.

### 2. `FhevmTypeEuint` Is a SUBSET of `FhevmType`

```typescript
/* FhevmTypeEuint only includes numeric euint types - NO ebool, NO eaddress */
type FhevmTypeEuint = FhevmType.euint4 | FhevmType.euint8 | FhevmType.euint16
                    | FhevmType.euint32 | FhevmType.euint64 | FhevmType.euint128
                    | FhevmType.euint256;

/* userDecryptEuint requires FhevmTypeEuint, NOT the full FhevmType */
fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);  /* CORRECT */
fhevm.userDecryptEuint(FhevmType.ebool, handle, contractAddr, signer);    /* TYPE ERROR - ebool not in FhevmTypeEuint */
```

Note: `euint4` is technically included in FhevmTypeEuint but is deprecated - do not use it.
This is why `userDecryptEbool` and `userDecryptEaddress` exist as separate functions without
`FhevmType` - they handle types excluded from `FhevmTypeEuint`.

### 3. `userDecryptEuint` ALWAYS Returns `bigint` - Even for `euint8`

```typescript
const val: bigint = await fhevm.userDecryptEuint(FhevmType.euint8, handle, addr, signer);
/* val is bigint, NOT number - even for 8-bit values */
/* Use Number(val) if you need a JS number, but beware of precision loss for large values */
```

### 4. `encryptUint` / `encryptBool` / `encryptAddress` - Implementation Only, NOT Public API

These methods exist on the implementation class but are **NOT on the typed public interface**
(`HardhatFhevmRuntimeEnvironment`). TypeScript may show compile errors when accessing them
via `hre.fhevm.encryptUint(...)`. Prefer the standard `createEncryptedInput` + `encrypt()` flow:

```typescript
/* RECOMMENDED - part of the public HardhatFhevmRuntimeEnvironment interface */
const input = fhevm.createEncryptedInput(contractAddr, userAddr);
input.add64(1000n);
const encrypted = await input.encrypt();

/* NOT RECOMMENDED - works at runtime but NOT typed on the public interface */
/* const encrypted = await fhevm.encryptUint(FhevmType.euint64, 1000n, contractAddr, userAddr); */
```

### 5. `typeof()` Returns a String Name, NOT the Enum

```typescript
/* Returns a FhevmTypeName string (e.g., "euint64"), NOT the FhevmType enum number */
const typeName: string = fhevm.typeof(handleBytes32);
/* typeName === "euint64" (string), NOT FhevmType.euint64 (5) */

/* NOTE: typeof() is on the implementation class but NOT on the typed public interface.
   TypeScript may show a compile error for hre.fhevm.typeof(). It works at runtime
   but is not part of the official API contract - use with caution. */
```

### 6. `computeTransactionHCU` Takes a Receipt, Returns an Object

```typescript
/* Estimate HCU for a completed transaction - pass the RECEIPT, not the hash */
const tx = await contract.doSomething(...);
const receipt = await tx.wait();
const hcuInfo = fhevm.computeTransactionHCU(receipt);
/* hcuInfo.transactionHash   - `0x${string}` (the originating tx hash)
   hcuInfo.globalHCU         - total HCU consumed (number)
   hcuInfo.maxHCUDepth       - max depth HCU (number)
   hcuInfo.HCUDepthByHandle  - per-handle breakdown (Record<`0x${string}`, number>)

   Verified against @fhevm/mock-utils@0.4.2 source
   (fhevm/coprocessor/hcu.ts, type FhevmTransactionHCUInfo - 4 fields).
   The receipt's own `receipt.hash` is the same value as `hcuInfo.transactionHash`. */
```

### 7. `tryParseFhevmError` Is Async and Returns `FhevmContractError | undefined`

```typescript
/* Parse FHEVM-specific errors from failed transactions - NOTE: async! */
const parsed = await fhevm.tryParseFhevmError(error, {
    encryptedInput: encryptedInputObj,  /* optional - for input-related errors */
    out: "console"                       /* optional - "stderr" | "stdout" | "console" */
});
if (parsed) {
    console.log(parsed.name, parsed.shortMessage);
    /* As of @fhevm/hardhat-plugin@0.4.2 the published `FhevmContractError`
       type is `FhevmInputVerifierError` - i.e. the only modeled `name` is
       `"InvalidSigner"` and `type` is always `"InputVerifier"`. ACL-related
       errors are surfaced via the underlying revert string ("ACL: sender not
       allowed", `SenderNotAllowedToUseHandle`); they are NOT a parsed variant
       of FhevmContractError. Fields: name, type, shortMessage, longMessage,
       txContractAddress, txUserAddress, inputContractAddress,
       inputUserAddress (no `args`). */
}
```

### 8. Mock Mode vs Real Chain - Key Differences

In mock mode (`--network hardhat`):
- Encryption is simulated - encrypted values are NOT actually encrypted
- FHE operations execute instantly (no coprocessor delay)
- `publicDecrypt` works immediately (no relayer needed)
- `userDecrypt` does NOT enforce user ACL grants (verified locally 2026-05-08 against `@fhevm/mock-utils@0.4.2`); production reverts with `SenderNotAllowed(address)` for missing `FHE.allow(handle, user)`. Always smoke-test ACL-dependent flows on `--network sepolia`.

In real mode (`--network sepolia`):
- Must run `npx hardhat clean && npx hardhat compile --network sepolia` first
- FHE operations are processed by the coprocessor (may take seconds)
- `publicDecrypt` requires the relayer to be running
- Tests run much slower (10-100x)

## Foundry: NOT natively supported

`forge test` does NOT support the FHEVM coprocessor. Per the official guide at `https://docs.zama.org/protocol/solidity-guides/v0.11/development-guide/foundry.md`: "Foundry does not natively support the FHEVM coprocessor." Zama explicitly recommends Hardhat: "We strongly recommend using the Hardhat template for now."

Why the unconditional NOT:

- The FHEVM coprocessor is a stateful off-chain service that the Hardhat plugin (`@fhevm/hardhat-plugin@^0.4.2`) injects into the in-process Hardhat network at test startup. Foundry's `forge` runs against a clean revm and has no equivalent injection point.
- A community mock (`fhevm/mocks/FHE.sol`) exists. Per the docs: "The mock-based approach described below does not replicate the full behavior of a real FHEVM node." and "Encrypted operations run as plaintext stubs, so tests may pass locally but fail on a live network." Treat that mock as a smoke harness, NOT a CI gate.

If a project already uses Foundry and refuses to switch:

- Imports must be `import "fhevm/mocks/FHE.sol"`, NOT `@fhevm/solidity/lib/FHE.sol` (the real library has external coprocessor calls Foundry cannot resolve).
- The mock answers FHE ops with plaintext values, so behavior diverges silently from Sepolia and mainnet.
- Run a smoke pass against `--network sepolia` from a parallel Hardhat workspace before merging.
- `forge` gas reports will not match real-coprocessor HCU.

Default recommendation in any new project: Hardhat. The toolchain (`hardhat@^2.28.6` + `@fhevm/hardhat-plugin@^0.4.2` + `@fhevm/mock-utils@^0.4.2`) is the only fully tested local environment for FHEVM v0.11.
