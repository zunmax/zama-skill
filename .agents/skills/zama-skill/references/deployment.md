# Deployment

## Contents

- Required Version Pins
- Compiler Settings
- `hardhat.config.ts` (both paths)
- `.env` (project root)
- Path A: standalone script
- Path B: `hardhat-deploy` plugin
- Etherscan Verification
- Post-Deployment Compatibility Check
- Pre-Deployment Checklist
- Networks

Deploy FHEVM contracts with Hardhat. Two patterns:

- **Path A:** standalone script run via `npx hardhat run scripts/deploy.ts --network <net>`. Default choice. Matches the reference template at https://github.com/zunmax/fhevm-template.
- **Path B:** `hardhat-deploy` plugin. Use when you need named accounts, deploy tags, or artifact tracking.

Both paths share the same dependency graph and the same `hardhat.config.ts`; Path B adds one import and one config key.

## Required Version Pins

`@fhevm/hardhat-plugin@^0.4.2` targets Hardhat 2. Newer releases of `hardhat-deploy` and `@nomicfoundation/hardhat-ethers` require Hardhat 3 and fail peer-dep resolution.

| Package | Version | Required |
|---|---|---|
| `hardhat` | `^2.28.6` | always |
| `@fhevm/hardhat-plugin` | `^0.4.2` | always |
| `@fhevm/solidity` | `^0.11.1` | always |
| `@fhevm/mock-utils` | `^0.4.2` | always |
| `@zama-fhe/relayer-sdk` | `0.4.1` (exact, no caret) | always |
| `@nomicfoundation/hardhat-ethers` | `^3.1.3` | always (NOT `^4.x`) |
| `@nomicfoundation/hardhat-verify` | `^2.1.3` | always |
| `@nomicfoundation/hardhat-chai-matchers` | `^2.1.2` | always |
| `@nomicfoundation/hardhat-network-helpers` | `^1.1.2` | opt-in (only when your tests use `time.increase`, `mine`, snapshots, `loadFixture`). Pin v1 only - `^3.x` requires Hardhat 3. |
| `ethers` | `^6.16.0` | always |
| `dotenv` | `^17.4.2` | always |
| `hardhat-deploy` | `^0.11.45` | Path B only (NOT `^0.12` or `^2.0`) |

`@zama-fhe/relayer-sdk` MUST be pinned exact `0.4.1` (no caret). `@fhevm/mock-utils@0.4.2` declares it as an exact peer; `@fhevm/hardhat-plugin` aborts at runtime with `Invalid @zama-fhe/relayer-sdk version` on a mismatch.

## Compiler Settings

- Solidity `0.8.28`, `evmVersion: "cancun"`, optimizer enabled at `runs: 800`, `metadata: { bytecodeHash: "none" }`.
- Bump pragma to `^0.8.27` or higher if importing `@openzeppelin/confidential-contracts` (ERC-7984).

## `hardhat.config.ts` (both paths)

```typescript
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
/* Path B only: */
/* import "hardhat-deploy"; */

import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const RPC_URL = process.env.RPC_URL || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    /* Path B only: */
    /* namedAccounts: { deployer: 0 }, */
    networks: {
        hardhat: { chainId: 31337 },
        sepolia: {
            chainId: 11155111,
            url: RPC_URL,
            accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
        },
    },
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: { enabled: true, runs: 800 },
            evmVersion: "cancun",
            metadata: { bytecodeHash: "none" },
        },
    },
    /* Etherscan v2: single apiKey string, all networks.
     * The per-network object form was deprecated May 2025. */
    etherscan: { apiKey: ETHERSCAN_API_KEY },
};
export default config;
```

## `.env` (project root)

```bash
PRIVATE_KEY=0x...
RPC_URL=https://sepolia.infura.io/v3/<KEY>
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Add `.env` to `.gitignore`.

## Path A: standalone script

### `scripts/deploy.ts`

```typescript
/**
 * @file deploy.ts
 * @description Deploys MyContract and records address + ABI for downstream consumers.
 */

import { ethers, network, artifacts, run } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CONTRACT_NAME = "MyContract";
const OUT_ROOT = resolve(__dirname, "..", "deployments");

async function main() {
    console.log(`[deploy] network=${network.name} chainId=${network.config.chainId}`);
    const [deployer] = await ethers.getSigners();
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`[deploy] deployer=${deployer.address} balance=${ethers.formatEther(balance)} ETH`);
    if (balance === 0n && network.name !== "hardhat") {
        throw new Error("Deployer balance is 0; fund the account before deploying");
    }

    const factory = await ethers.getContractFactory(CONTRACT_NAME);
    const contract = await factory.deploy(/* constructor args */);
    const tx = contract.deploymentTransaction();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`[deploy] ${CONTRACT_NAME} -> ${address}`);

    const artifact = await artifacts.readArtifact(CONTRACT_NAME);
    const record = {
        contractName: CONTRACT_NAME,
        address,
        chainId: Number(network.config.chainId ?? 0),
        network: network.name,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        transactionHash: tx?.hash ?? null,
        abi: artifact.abi,
    };
    const outDir = join(OUT_ROOT, network.name);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `${CONTRACT_NAME}.json`), JSON.stringify(record, null, 2));
    console.log(`[deploy] wrote ${outDir}/${CONTRACT_NAME}.json`);

    const etherscanKey = process.env.ETHERSCAN_API_KEY?.trim();
    if (network.name === "sepolia" && etherscanKey && etherscanKey !== "your_etherscan_api_key") {
        console.log(`[deploy] waiting 30s for Etherscan indexing before verify`);
        await new Promise((r) => setTimeout(r, 30_000));
        try {
            await run("verify:verify", { address, constructorArguments: [] });
            console.log(`[deploy] verified on Etherscan`);
        } catch (err: unknown) {
            console.log(`[deploy] verify skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
```

### Run

```bash
npx hardhat clean
npx hardhat compile
npx hardhat run scripts/deploy.ts --network hardhat     /* local mock */
npx hardhat run scripts/deploy.ts --network sepolia     /* testnet */
```

## Path B: `hardhat-deploy` plugin

### Install

```bash
npm install -D hardhat-deploy@^0.11.45
```

### Config changes

Uncomment the two `hardhat-deploy` lines in `hardhat.config.ts`:

```typescript
import "hardhat-deploy";
/* and add: */
namedAccounts: { deployer: 0 },
```

### `deploy/01_deploy_mycontract.ts`

```typescript
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
    const { deployer } = await hre.getNamedAccounts();
    const deployed = await hre.deployments.deploy("MyContract", {
        from: deployer,
        args: [],
        log: true,
    });
    console.log(`MyContract -> ${deployed.address}`);
};
func.id = "deploy_mycontract";
func.tags = ["MyContract"];
export default func;
```

### Run

```bash
npx hardhat deploy --network sepolia
npx hardhat deploy --network sepolia --tags MyContract    /* selective */
```

Artifacts are written to `deployments/<network>/<Contract>.json`.

## Etherscan Verification

Both paths use the same command:

```bash
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS>
```

With constructor arguments:

```bash
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS> "arg1" "arg2"
```

Path A's script auto-verifies when `ETHERSCAN_API_KEY` is set. Path B requires a separate `verify` call.

## Post-Deployment Compatibility Check

```bash
npx hardhat fhevm check-fhevm-compatibility --network sepolia --address <DEPLOYED_ADDRESS>
```

A passing result confirms the contract inherits `ZamaEthereumConfig` and the ACL / coprocessor wiring resolved for the target chain.

## Pre-Deployment Checklist

- [ ] Pragma `^0.8.28` (or `^0.8.27` if importing `@openzeppelin/confidential-contracts`)
- [ ] `evmVersion: "cancun"`, optimizer enabled at `runs: 800`
- [ ] Contract inherits `ZamaEthereumConfig` (NOT `SepoliaConfig`)
- [ ] `FHE.allowThis(value)` after every stored encrypted computation
- [ ] `FHE.allow(value, user)` for every value the user must decrypt
- [ ] No `TFHE.*` calls (v0.8 library name)
- [ ] No `requestDecryption` or `GatewayCaller` (removed in v0.9)
- [ ] Custom errors, not `require(cond, "string")`
- [ ] Self-transfer guard: `from != to` in transfer functions
- [ ] Tests pass on local hardhat network
- [ ] **Mainnet only:** Zama Relayer API key obtained (apply at https://forms.gle/jq84zEek1oiv3kBz9)
- [ ] **Mainnet only (Hardhat side):** API key set as a Hardhat configuration variable so the plugin can read it: `npx hardhat vars set ZAMA_FHEVM_API_KEY <key>` (verify with `npx hardhat vars get ZAMA_FHEVM_API_KEY`). This is the canonical mechanism documented in `@fhevm/hardhat-plugin@0.4.2/README.md:85,91` - NOT a `.env` variable.
- [ ] **Mainnet only (frontend side):** API key is stored server-side; browser clients route through a backend proxy that injects the `x-api-key` header. Never ship the mainnet key in client-side bundles.
- [ ] **Mainnet only:** E2E tested on Sepolia first

## Networks

| Network | Chain ID | Notes |
|---|---|---|
| Sepolia | 11155111 | Public testnet. Relayer is open. |
| Local Hardhat | 31337 | Mock coprocessor via `@fhevm/hardhat-plugin`. |
| Ethereum Mainnet | 1 | Live. Relayer requires API key. |

Addresses are resolved by `ZamaEthereumConfig` from `block.chainid`. Do not hardcode.
