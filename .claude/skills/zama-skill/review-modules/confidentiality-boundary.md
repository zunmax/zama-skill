# Confidentiality Boundary - Hacking Module

You are an attacker that exploits information leaks from encrypted contracts. FHE protects values at rest and during computation, but confidentiality breaks through side channels: revert patterns reveal encrypted conditions, event emissions leak decrypted data, gas consumption differences expose which branch was taken, and plaintext allowances betray encrypted balances. Every path where private data escapes the encryption boundary is your target.

Other modules cover state flow, ACL, decryption, type safety, and invariants. You exploit **information leakage.**

## How to Attack

### Map the Confidentiality Boundary

Identify what should remain private vs what is intentionally public:

- **Private:** Balances, bids, votes, scores, individual transaction amounts, allowances
- **Public by design:** Participant addresses, timestamps, phase transitions, aggregate results after reveal
- **Handle metadata:** Encrypted handles (`bytes32`) are opaque but their existence and storage location are visible on-chain

This map defines what leaks matter. A "leak" of public information is not a finding.

### Exploit Revert-Based Information Leaks (P20)

For every `require()`, `revert`, and `if` statement:

- Does the condition depend (directly or indirectly) on an encrypted value?
- Attack: submit a transaction that triggers the condition. If it reverts, the encrypted condition was false. If it succeeds, it was true. Binary search with repeated transactions can extract the exact encrypted value.
- Check for `FHE.select()` branches where one path reverts and the other succeeds - the revert/success pattern reveals which branch was taken.
- Watch for indirect leaks: a contract function whose control flow branches on `FHE.isInitialized()` exposes whether the storage slot is non-zero - which an off-chain observer can already read directly. The function call itself does not leak; the surfacing of that bit through revert vs success is what matters when an attacker cannot read the slot themselves (e.g. the value lives only in transient storage or in a return path).
- **Safe exceptions:** `FHE.isAllowed()`, `FHE.isInitialized()`, `FHE.isSenderAllowed()`, `FHE.isPubliclyDecryptable()`, and `FHE.isPublicDecryptionResultValid()` return plaintext `bool` and are safe in conditions (the latter is documented at `FHE.sol:9512-9520` for require-wrapping).

### Exploit Event-Based Information Leaks (P21)

For every `emit` statement:

- Are any event parameters derived from decrypted confidential data?
- Emitting opaque handles is safe (reveals nothing). Emitting decrypted amounts, results, or derived values permanently breaks confidentiality.
- Attack: even if the event is only emitted in specific conditions, the PATTERN of emission (present vs absent in tx receipt) leaks whether that condition was met.
- Check if events are emitted inside code paths gated by encrypted conditions.

### Exploit Gas-Based Side Channels (P22)

For every `FHE.select()` in the contract:

- Do the two branches perform different numbers or types of FHE operations?
- If one branch does `FHE.add + FHE.sub` and the other does nothing, gas consumption differs measurably. A block producer or observer can determine which branch was taken.
- Attack in auctions: estimate gas for a bid transaction. If the gas corresponds to the "bid accepted" branch vs "bid too low" branch, the bid threshold is leaked.
- Attack in transfers: if the "sufficient balance" branch uses more gas than the "insufficient" branch, balance ranges can be estimated.
- **Proper defense:** both branches should perform the same FHE operations (compute both outcomes, select the correct one).

### Exploit Timing and Ordering Leaks (P23)

For sequential submission patterns:

- Can an observer correlate submission order with storage position?
- Attack on sealed auction: if bids are stored as `bids[0]`, `bids[1]`, etc., and revealed in order, the observer knows who bid what based on submission timestamp.
- Attack on voting: if votes are stored per-voter in a predictable mapping, an observer who sees storage slot changes can identify which accounts voted.
- **Defense check:** randomized storage positions, batched reveals, or blinded ordering.

### Exploit Plaintext Allowance Leaks (P25)

For approval/allowance patterns:

- Are allowances stored as plaintext `uint256` while balances are encrypted?
- Attack: a plaintext allowance of 1000 tokens reveals the user has at least 1000 tokens, partially breaking balance confidentiality.
- Check `mapping(address => mapping(address => uint256))` allowance patterns in contracts with encrypted balances. (Note: ERC-7984's operator pattern `mapping(address holder => mapping(address spender => uint48)) _operators` at `@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol:29` carries only an expiry timestamp, not an amount - flag P25 only when the plaintext map carries an amount/cap, not for ERC-7984 operator slots.)
- This is especially damaging when combined with `approve(type(uint256).max)` patterns - the user is revealing they accept unlimited transfers.

### Exploit Premature Decryption (P12, P14)

For every `FHE.makePubliclyDecryptable()` call:

- Is it gated behind a phase/time check?
- Attack on voting: trigger decryption before voting ends. Partial tallies influence remaining voters.
- Attack on auctions: trigger decryption before bidding closes. Remaining bidders can see the current highest bid.
- Can the phase transition guard be bypassed (see guard-breaking in audit-protocol)?

### Exploit Cross-Transaction Correlation

Even without seeing encrypted values, an observer can correlate:

- **Balance changes:** If Alice's handle changes and Bob's changes in the same tx, a transfer likely occurred between them.
- **Access patterns:** Which storage slots are read/written reveals which accounts are involved.
- **Transaction frequency:** Number of transactions reveals activity level.
- Flag these ONLY when the application claims to hide participation (not just amounts).

## Output Fields

Set `module: confidentiality-boundary` on every block. Append these fields inside the FINDING block (after `fix:`). Do NOT repeat `proof:` - that field lives in the shared block and must contain the concrete scenario showing the information leak with specific observable differences.

```
leak_channel:       <revert_pattern | event_emission | gas_side_channel | timing_correlation | plaintext_allowance | premature_decryption>
leaked_information: <what specific private data is revealed>
observer:           <anyone_on_chain | block_producer | specific_participant>
```
