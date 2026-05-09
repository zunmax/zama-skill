/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.28;

/**
 * @file ConfidentialERC20.sol
 * @description Confidential ERC-7984 token template - owner-only mint, encrypted balances, encrypted transfers on FHEVM v0.11.
 */

import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { FHE, externalEuint64, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ConfidentialERC20
 * @notice ERC-7984 confidential token built on @openzeppelin/confidential-contracts and FHEVM v0.11. Owner-only mint, time-bounded operator approval, encrypted balances and transfers.
 * @dev Inherits ERC7984 for the encrypted-token primitives and ZamaEthereumConfig for the FHEVM coprocessor / KMS / ACL addresses across mainnet, Sepolia, and local hardhat.
 */
contract ConfidentialERC20 is ERC7984, ZamaEthereumConfig, Ownable {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory contractURI_,
        address initialOwner
    ) ERC7984(name_, symbol_, contractURI_) Ownable(initialOwner) {}

    /**
     * @notice Mint encrypted tokens to `to`. Owner-only.
     * @dev Proof is verified by `FHE.fromExternal` before `_mint`. `allowTransient` is used (not `allow`) so the grant lasts only for this tx.
     * @param to Recipient of the minted balance.
     * @param encAmount Externally encrypted euint64 amount.
     * @param inputProof ZK proof binding `encAmount` to this contract and the caller.
     * @return minted Encrypted amount actually credited (zero on overflow).
     */
    function mint(
        address to,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint64 minted) {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        minted = _mint(to, amount);
        FHE.allowTransient(minted, msg.sender);
    }

    /**
     * @notice Burn encrypted tokens from caller.
     * @param encAmount Externally encrypted euint64 amount.
     * @param inputProof ZK proof binding `encAmount` to this contract and the caller.
     * @return burned Encrypted amount actually debited (zero if balance insufficient).
     */
    function burn(externalEuint64 encAmount, bytes calldata inputProof) external returns (euint64 burned) {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        burned = _burn(msg.sender, amount);
        FHE.allowTransient(burned, msg.sender);
    }
}
