# Environment Setup

## Contents

- Templates
- Manual Project Layout
- Required Version Pins
- Manual Install
- `hardhat.config.ts`
- `.env`
- Compile and Test
- Supported Networks (resolved by `ZamaEthereumConfig`)
- `@fhevm/hardhat-plugin` Tasks

From-scratch project scaffolding for FHEVM. Framework: Hardhat.

## Templates

Clone one of the two templates to skip manual setup:

| Template | Deploy pattern | URL |
|---|---|---|
| Default | `npx hardhat run scripts/deploy.ts` (Path A) | https://github.com/zunmax/fhevm-template |
| Alternative | `npx hardhat deploy` (Path B, hardhat-deploy plugin) | https://github.com/zunmax/fhevm-template (same repo, see `contracts/deploy/`) |

One repo, two deploy patterns. Pick whichever fits your workflow - Path A is the default.

**Foundry: NOT natively supported.** Use Hardhat. `forge test` cannot run the FHEVM coprocessor; the community `fhevm/mocks/FHE.sol` shim is a smoke-only harness that "may pass locally but fail on a live network" per the official docs. See `testing.md` for the full rationale and the Foundry-only workaround.

## Manual Project Layout

```
my-fhevm-project/
├── contracts/           FHEVM Solidity contracts
├── scripts/             Deploy / interaction scripts (Path A)
├── deploy/              hardhat-deploy scripts (Path B only)
├── tasks/               Custom Hardhat tasks
├── test/                Hardhat tests
├── hardhat.config.ts
├── package.json
├── tsconfig.json
└── .env
```

## Required Version Pins

`@fhevm/hardhat-plugin@^0.4.2` targets Hardhat 2. Any package that requires Hardhat 3 (e.g. `hardhat-deploy@^0.12`, `@nomicfoundation/hardhat-ethers@^4.x`) breaks peer-dep resolution with `ERESOLVE unable to resolve dependency tree`.

| Package | Version | Required |
|---|---|---|
| `hardhat` | `^2.28.6` (template's choice; `@fhevm/hardhat-plugin@0.4.2` actually peers `hardhat ^2.0.0` per its `package.json`. Hardhat 3 breaks the install regardless.) | always |
| `@fhevm/hardhat-plugin` | `^0.4.2` | always |
| `@fhevm/solidity` | `^0.11.1` | always |
| `@fhevm/mock-utils` | `^0.4.2` | always |
| `@zama-fhe/relayer-sdk` | `0.4.1` (exact, no caret) | always |
| `@nomicfoundation/hardhat-ethers` | `^3.1.3` | always |
| `@nomicfoundation/hardhat-verify` | `^2.1.3` | always |
| `@nomicfoundation/hardhat-chai-matchers` | `^2.1.2` | always |
| `@nomicfoundation/hardhat-network-helpers` | `^1.1.2` | opt-in: only install when your tests actually call `time.increase`, `mine`, `setBalance`, `loadFixture`, or snapshots. Pin the v1 line only - `^3.x` requires Hardhat 3 and breaks `ERESOLVE`. |
| `@typechain/hardhat` | `^9.1.0` | always |
| `@typechain/ethers-v6` | `^0.5.1` | always |
| `ethers` | `^6.16.0` | always |
| `dotenv` | `^17.4.2` | always |
| `typescript` | `^5.9.3` (do NOT leave unpinned: `latest` resolves to 6.x, which trips `TS5011: rootDir must be set when outDir is used` on Hardhat 2's ts-node integration) | always |
| `ts-node` | `^10.9.2` (latest stable; `11.x` is a stale beta from 2023 and is not on `latest`) | always |
| `chai` | `^4.5.0` (do NOT bump to 5+ or 6+; both are ESM-only and break ts-node + Hardhat 2 CJS) | always |
| `@types/chai` | `^4.3.20` (must match `chai@^4`; `@types/chai@5+` ships ESM-only typings) | always |
| `@types/node` | `^24.12.2` (current Node LTS line; works for `engines.node >= 20`) | always |
| `@types/mocha` | `^10.0.10` | always |
| `@openzeppelin/confidential-contracts` | `^0.4.0` (peers `@fhevm/solidity = "0.11.1"` exact; do not unpin) | only when using ERC-7984 |
| `@zama-fhe/sdk` | `^3.0.0` (engines `node >= 22`; peer deps: `viem >= 2`, `ethers >= 6`, `@tanstack/query-core >= 5`) | optional - confidential ERC-7984 dApp frontend / Node backend (high-level `Token` API) |
| `@zama-fhe/react-sdk` | `^3.0.0` (peer deps: `viem ^2.47.0`, `react >= 18`, `wagmi >= 2`, `@zama-fhe/sdk ^3.0.0`, `@tanstack/react-query >= 5`) | optional - React frontends |
| `@rainbow-me/rainbowkit` | `^2.2.10` (peers `wagmi ^2 + @tanstack/react-query ^5 + react ^18`; ships the connect-button UI + 60+ wallet adapters) | optional - browser dApp wallet kit (default-recommended; see `frontend.md`) |
| `wagmi` | `^2.14.0` (declared as a peer by both `@rainbow-me/rainbowkit@^2.2.10` and `@zama-fhe/react-sdk@^3.0.0`; share one wagmi tree across both) | optional - browser dApp |
| `@tanstack/react-query` | `^5.99.0` (peer of wagmi and `@zama-fhe/react-sdk`; share one client) | optional - browser dApp |
| `viem` | latest `^2.47.0`-compatible (transitive of wagmi; declare directly only if you import from `viem` itself) | optional - browser dApp |
| `hardhat-deploy` | `^0.11.45` (must be `<0.12.0`) | Path B only |

`@zama-fhe/relayer-sdk` MUST be pinned exact `0.4.1` (no caret). `@fhevm/mock-utils@0.4.2` declares it as an exact peer dependency, and `@fhevm/hardhat-plugin` performs a runtime version check that aborts with `Invalid @zama-fhe/relayer-sdk version. Expecting 0.4.1. Got X.Y.Z instead.` if the resolved version drifts. `@nomicfoundation/hardhat-network-helpers` MUST be the v1 line (`^1.1.2`); the v3 line requires Hardhat 3 and breaks `ERESOLVE`.

## Manual Install

**Path A (default):**

```bash
npm install @fhevm/solidity@^0.11.1 dotenv@^17.4.2
npm install -D \
  hardhat@^2.28.6 \
  @fhevm/hardhat-plugin@^0.4.2 \
  @fhevm/mock-utils@^0.4.2 \
  @nomicfoundation/hardhat-ethers@^3.1.3 \
  @nomicfoundation/hardhat-verify@^2.1.3 \
  @nomicfoundation/hardhat-chai-matchers@^2.1.2 \
  @typechain/hardhat@^9.1.0 \
  @typechain/ethers-v6@^0.5.1 \
  ethers@^6.16.0 \
  typescript@^5.9.3 ts-node@^10.9.2 @types/node@^24.12.2 @types/mocha@^10.0.10 @types/chai@^4.3.20 chai@^4.5.0
# Pin the relayer SDK EXACT (no caret). --save-exact prevents npm from rewriting "0.4.1" to "^0.4.1".
npm install -D --save-exact @zama-fhe/relayer-sdk@0.4.1
```

**Path B adds:**

```bash
npm install -D hardhat-deploy@^0.11.45
```

## `hardhat.config.ts`

```typescript
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
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
    etherscan: { apiKey: ETHERSCAN_API_KEY },
};
export default config;
```

## `.env`

```bash
PRIVATE_KEY=0x...
RPC_URL=https://sepolia.infura.io/v3/<KEY>
ETHERSCAN_API_KEY=your_etherscan_api_key
```

Add `.env` to `.gitignore`.

## Compile and Test

```bash
npx hardhat compile
npx hardhat test
```

## Supported Networks (resolved by `ZamaEthereumConfig`)

| Network | Chain ID | RPC |
|---|---|---|
| Sepolia | 11155111 | `https://sepolia.infura.io/v3/<KEY>` |
| Local Hardhat | 31337 | `http://localhost:8545` |
| Ethereum Mainnet | 1 | any mainnet RPC |

Any other chain ID reverts with `ZamaProtocolUnsupported()`.

### Provisioned Addresses (`ZamaConfig.sol`)

**Sepolia (11155111):**
- ACL: `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D`
- Coprocessor: `0x92C920834Ec8941d2C77D188936E1f7A6f49c127`
- KMSVerifier: `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A`

**Mainnet (1):**
- ACL: `0xcA2E8f1F656CD25C01F05d0b243Ab1ecd4a8ffb6`
- Coprocessor: `0xD82385dADa1ae3E969447f20A3164F6213100e75`
- KMSVerifier: `0x77627828a55156b04Ac0DC0eb30467f1a552BB03`

**Local (31337):** deployed by `@fhevm/hardhat-plugin` on test startup.
- ACL: `0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D`
- Coprocessor: `0xe3a9105a3a932253A70F126eb1E3b589C643dD24`
- KMSVerifier: `0x901F8942346f7AB3a01F6D7613119Bca447Bb030`

Do not hardcode. `ZamaEthereumConfig` resolves them from `block.chainid`.

## `@fhevm/hardhat-plugin` Tasks

The plugin registers four user-facing tasks under the `fhevm` scope (verified in
`@fhevm/hardhat-plugin@0.4.2/src/tasks/fhevm.ts`). There is no `npx hardhat fhevm setup`
task; it appears as a constant in `task-names.ts` but is never registered.

```bash
# Smoke-test that a deployed contract is FHEVM-compatible on the given network
npx hardhat fhevm check-fhevm-compatibility --network sepolia --address <ADDR>

# User-decrypt a single handle (requires --type, --handle, --user, --contract)
npx hardhat fhevm user-decrypt --type euint64 --handle 0x... --user 0 --contract 0x...

# Public-decrypt a publicly-decryptable handle (requires --type, --handle)
npx hardhat fhevm public-decrypt --type euint64 --handle 0x...

# Resolve the FHEVM coprocessor config for the given ACL/KMS pair
npx hardhat fhevm resolve-fhevm-config --network sepolia --acl <ADDR> --kms <ADDR>
```
