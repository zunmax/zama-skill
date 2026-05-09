/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.28;

/**
 * @file PrivateVoting.sol
 * @description Confidential voting template - encrypted ballots, publicly decryptable tally via 3-step flow on FHEVM v0.11.
 */

import { FHE, euint64, ebool, externalEbool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title PrivateVoting
 * @notice Template confidential voting contract. Adapt before production use.
 * @dev Votes are encrypted end-to-end; tallies are revealed via 3-step public decryption after the deadline.
 */
contract PrivateVoting is ZamaEthereumConfig {
    address public owner;
    uint256 public votingEnd;

    euint64 private _yesVotes;
    euint64 private _noVotes;
    mapping(address => bool) private _hasVoted;

    bool public resultsRequested;
    uint64 public clearYesVotes;
    uint64 public clearNoVotes;
    bool public resultsFinalized;

    event VoteCast(address indexed voter);
    event DecryptionRequested(bytes32 yesHandle, bytes32 noHandle);
    event ResultsFinalized(uint64 yesVotes, uint64 noVotes);

    error VotingNotActive();
    error AlreadyVoted();
    error VotingNotEnded();
    error OnlyOwner();
    error ResultsAlreadyRequested();
    error ResultsAlreadyFinalized();
    error NotRequested();
    error ZeroDuration();

    constructor(uint256 _duration) {
        if (_duration == 0) revert ZeroDuration();
        owner = msg.sender;
        votingEnd = block.timestamp + _duration;

        _yesVotes = FHE.asEuint64(0);
        _noVotes = FHE.asEuint64(0);
        /* allowThis is required so vote() can read these handles in later txs. */
        FHE.allowThis(_yesVotes);
        FHE.allowThis(_noVotes);
    }

    /**
     * @notice Cast an encrypted vote
     * @param encVoteYes Encrypted boolean - true for yes, false for no
     * @param inputProof ZK proof validating the encryption
     * @dev Uses FHE.select to add to the correct counter without revealing the vote
     */
    function vote(externalEbool encVoteYes, bytes calldata inputProof) external {
        if (block.timestamp >= votingEnd) revert VotingNotActive();
        if (_hasVoted[msg.sender]) revert AlreadyVoted();

        _hasVoted[msg.sender] = true;
        ebool voteYes = FHE.fromExternal(encVoteYes, inputProof);

        /* Both branches must execute every call so the gas profile does not leak the vote. */
        euint64 one = FHE.asEuint64(1);
        euint64 zero = FHE.asEuint64(0);

        euint64 yesIncrement = FHE.select(voteYes, one, zero);
        euint64 noIncrement = FHE.select(voteYes, zero, one);

        _yesVotes = FHE.add(_yesVotes, yesIncrement);
        _noVotes = FHE.add(_noVotes, noIncrement);

        FHE.allowThis(_yesVotes);
        FHE.allowThis(_noVotes);

        emit VoteCast(msg.sender);
    }

    /*************** Public Decryption - 3-Step Self-Relaying ***************/

    /**
     * @notice Step 1: Request decryption of vote results (on-chain)
     * @dev Marks both counters as publicly decryptable
     */
    function requestResults() external {
        if (msg.sender != owner) revert OnlyOwner();
        if (block.timestamp < votingEnd) revert VotingNotEnded();
        if (resultsRequested) revert ResultsAlreadyRequested();

        resultsRequested = true;

        FHE.makePubliclyDecryptable(_yesVotes);
        FHE.makePubliclyDecryptable(_noVotes);

        emit DecryptionRequested(
            FHE.toBytes32(_yesVotes),
            FHE.toBytes32(_noVotes)
        );
    }

    /**
     * @notice Step 3: Finalize results with decryption proof (on-chain)
     * @dev Step 2 happens off-chain via relayer SDK publicDecrypt
     * @param yesCount Clear yes vote count
     * @param noCount Clear no vote count
     * @param decryptionProof KMS proof from publicDecrypt
     */
    function finalizeResults(
        uint64 yesCount,
        uint64 noCount,
        bytes calldata decryptionProof
    ) external {
        if (!resultsRequested) revert NotRequested();
        if (resultsFinalized) revert ResultsAlreadyFinalized();

        /* cts order MUST match the publicDecrypt call order; otherwise checkSignatures reverts with KMSInvalidSigner. */
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(_yesVotes);
        cts[1] = FHE.toBytes32(_noVotes);

        FHE.checkSignatures(cts, abi.encode(yesCount, noCount), decryptionProof);

        clearYesVotes = yesCount;
        clearNoVotes = noCount;
        resultsFinalized = true;

        emit ResultsFinalized(yesCount, noCount);
    }
}
