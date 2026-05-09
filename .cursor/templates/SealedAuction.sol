/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.28;

/**
 * @file SealedAuction.sol
 * @description Sealed-bid auction template - encrypted bids, encrypted winner selection, reveal via 3-step public decryption on FHEVM v0.11.
 */

import { FHE, euint64, externalEuint64, ebool, eaddress } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title SealedAuction
 * @notice Template sealed-bid auction. Adapt before production use.
 * @dev Bids remain encrypted until reveal; the winner is computed with encrypted comparisons.
 */
contract SealedAuction is ZamaEthereumConfig {
    address public owner;
    uint256 public biddingEnd;
    uint256 public revealEnd;

    euint64 private _highestBid;
    eaddress private _highestBidder;
    mapping(address => euint64) private _bids;

    bool public resultRequested;
    address public clearWinner;
    uint64 public clearWinningBid;
    bool public resultFinalized;

    event BidPlaced(address indexed bidder);
    event RevealRequested(bytes32 bidHandle, bytes32 bidderHandle);
    event AuctionFinalized(address winner, uint64 winningBid);

    error BiddingNotActive();
    error AlreadyBid();
    error BiddingNotEnded();
    error OnlyOwner();
    error AlreadyRequested();
    error AlreadyFinalized();
    error NotRequested();
    error ZeroDuration();

    constructor(uint256 _biddingDuration, uint256 _revealDuration) {
        if (_biddingDuration == 0 || _revealDuration == 0) revert ZeroDuration();
        owner = msg.sender;
        biddingEnd = block.timestamp + _biddingDuration;
        revealEnd = biddingEnd + _revealDuration;

        _highestBid = FHE.asEuint64(0);
        _highestBidder = FHE.asEaddress(address(0));
        /* allowThis is required so bid() can read these handles in later txs. */
        FHE.allowThis(_highestBid);
        FHE.allowThis(_highestBidder);
    }

    /**
     * @notice Place an encrypted bid
     * @param encBid Encrypted bid amount
     * @param inputProof ZK proof validating the encryption
     */
    function bid(externalEuint64 encBid, bytes calldata inputProof) external {
        if (block.timestamp >= biddingEnd) revert BiddingNotActive();
        if (FHE.isInitialized(_bids[msg.sender])) revert AlreadyBid();

        euint64 bidAmount = FHE.fromExternal(encBid, inputProof);

        _bids[msg.sender] = bidAmount;
        FHE.allowThis(bidAmount);
        FHE.allow(bidAmount, msg.sender);

        /* Both branches of the select must run on every bid so the gas profile does not leak which path was taken. */
        ebool isHigher = FHE.gt(bidAmount, _highestBid);

        _highestBid = FHE.select(isHigher, bidAmount, _highestBid);
        _highestBidder = FHE.select(
            isHigher,
            FHE.asEaddress(msg.sender),
            _highestBidder
        );

        FHE.allowThis(_highestBid);
        FHE.allowThis(_highestBidder);

        emit BidPlaced(msg.sender);
    }

    /*************** Public Decryption - 3-Step Self-Relaying ***************/

    /**
     * @notice Step 1: Request decryption of auction results
     */
    function requestResult() external {
        if (msg.sender != owner) revert OnlyOwner();
        if (block.timestamp < biddingEnd) revert BiddingNotEnded();
        if (resultRequested) revert AlreadyRequested();

        resultRequested = true;

        FHE.makePubliclyDecryptable(_highestBid);
        FHE.makePubliclyDecryptable(_highestBidder);

        emit RevealRequested(
            FHE.toBytes32(_highestBid),
            FHE.toBytes32(_highestBidder)
        );
    }

    /**
     * @notice Step 3: Finalize auction with decryption proof
     * @param winningBid Clear winning bid amount
     * @param winner Clear winner address
     * @param decryptionProof KMS proof from publicDecrypt
     */
    function finalizeResult(
        uint64 winningBid,
        address winner,
        bytes calldata decryptionProof
    ) external {
        if (!resultRequested) revert NotRequested();
        if (resultFinalized) revert AlreadyFinalized();

        /* cts order MUST match the publicDecrypt call order; otherwise checkSignatures reverts with KMSInvalidSigner. */
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(_highestBid);
        cts[1] = FHE.toBytes32(_highestBidder);

        FHE.checkSignatures(
            cts,
            abi.encode(winningBid, winner),
            decryptionProof
        );

        clearWinner = winner;
        clearWinningBid = winningBid;
        resultFinalized = true;

        emit AuctionFinalized(winner, winningBid);
    }

    /**
     * @notice Return the caller's own encrypted bid handle.
     * @dev The off-chain user-decrypt of the returned handle requires the ACL grant set in `bid()`; without it the relayer reverts with `SenderNotAllowed`.
     */
    function bidOf() external view returns (euint64) {
        return _bids[msg.sender];
    }
}
