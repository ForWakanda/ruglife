// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20, IERC20Permit, IERC6551Registry, ITokenboundProxy} from "./Interfaces.sol";

/// RUG LIFE escrow — pots and bounties in $CHOG, paid to a Chog's token-bound chest.
///
/// Trust model, stated plainly: `settle` pays whatever the RESULT SIGNER attests. The contract only limits
/// the destination (a chest derived from the winner's tokenId), the amount (the whole of one id, once) and
/// the timing (before the id's expiry). A compromised signer can misdirect a pot to another Chog's chest;
/// nothing can send funds to an arbitrary address. `reclaim` after expiry needs no server and cannot be paused.
contract RugLifeEscrow {
    // ---- chain facts (tech-design § 5), immutable ----
    IERC20 public immutable chog;
    IERC6551Registry public immutable registry;
    address public immutable accountProxy; // the "implementation" given to the registry
    address public immutable accountImpl; // Tokenbound AccountV3, the argument of initialize
    address public immutable collection; // Chog Genesis
    uint256 public immutable chainId;
    uint256 public immutable maxPerId; // ceiling per id, fixed at deploy

    // ---- roles ----
    address public owner; // sets the signer and the guardian; nothing else
    address public resultSigner; // holds gas and nothing else; attests results
    address public guardian; // may pause new funding and settlement only
    bool public fundingPaused;
    bool public settlementPaused;

    // ---- ids ----
    enum Kind { Pot, Bounty }
    enum Trigger { None, Hit, Rug }
    struct Pool {
        uint8 kind;
        uint8 trigger;
        uint256 targetTokenId; // bounty only
        uint64 expiry;
        uint256 total; // funded and still held
        bool settled;
        uint256 paidTo; // winner tokenId once settled
        bytes32 eventDigest;
    }
    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => mapping(address => uint256)) public funded; // id → funder → amount
    mapping(bytes32 => mapping(address => bool)) public toSeason; // id → funder → send to the season pot on expiry
    mapping(bytes32 => bytes32) public seasonOf; // id → season pot id to roll into (set by the first flagged funder)

    // ---- EIP-712 ----
    bytes32 private constant SETTLEMENT_TYPEHASH = keccak256("Settlement(bytes32 id,uint256 winnerTokenId,bytes32 eventDigest,string rulesVersion)");
    bytes32 private immutable DOMAIN_SEPARATOR;

    event Funded(bytes32 indexed id, address indexed funder, uint256 amount, uint8 kind, uint256 targetTokenId, uint8 trigger, uint64 expiry, bool toSeason);
    event Settled(bytes32 indexed id, uint256 indexed winnerTokenId, address chest, uint256 amount, bytes32 eventDigest);
    event Reclaimed(bytes32 indexed id, address indexed funder, uint256 amount);
    event RolledToSeason(bytes32 indexed id, bytes32 indexed seasonId, address indexed funder, uint256 amount);
    event SignerSet(address signer);
    event GuardianSet(address guardian);
    event Paused(bool funding, bool settlement);

    error NotOwner();
    error NotGuardian();
    error PausedErr();
    error ZeroAmount();
    error OverCeiling();
    error BadExpiry();
    error Mismatch();
    error AlreadySettled();
    error Expired();
    error NotExpired();
    error BadSignature();
    error NothingToReclaim();
    error NotFlaggedForSeason();
    error ChestInitFailed();

    constructor(address chog_, address registry_, address accountProxy_, address accountImpl_, address collection_, address resultSigner_, address guardian_, uint256 maxPerId_) {
        chog = IERC20(chog_);
        registry = IERC6551Registry(registry_);
        accountProxy = accountProxy_;
        accountImpl = accountImpl_;
        collection = collection_;
        chainId = block.chainid;
        owner = msg.sender;
        resultSigner = resultSigner_;
        guardian = guardian_;
        maxPerId = maxPerId_;
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("RUG LIFE Escrow"), keccak256("1"), block.chainid, address(this)
        ));
    }

    // ---- admin: roles and pauses only; no path moves funds ----
    function setResultSigner(address s) external { if (msg.sender != owner) revert NotOwner(); resultSigner = s; emit SignerSet(s); }
    function setGuardian(address g) external { if (msg.sender != owner) revert NotOwner(); guardian = g; emit GuardianSet(g); }
    function setPaused(bool funding_, bool settlement_) external {
        if (msg.sender != guardian && msg.sender != owner) revert NotGuardian();
        fundingPaused = funding_; settlementPaused = settlement_;
        emit Paused(funding_, settlement_);
    }

    // ---- funding ----
    function fund(bytes32 id, uint8 kind, uint256 targetTokenId, uint8 trigger, uint256 amount, uint64 expiry, bool toSeasonIfUnclaimed, bytes32 seasonId) public {
        if (fundingPaused) revert PausedErr();
        if (amount == 0) revert ZeroAmount();
        Pool storage p = pools[id];
        if (p.settled) revert AlreadySettled();
        if (p.total == 0 && p.expiry == 0) {
            // first deposit fixes the id's terms
            if (expiry <= block.timestamp) revert BadExpiry();
            if (kind > uint8(Kind.Bounty) || trigger > uint8(Trigger.Rug)) revert Mismatch();
            if (kind == uint8(Kind.Pot) && trigger != uint8(Trigger.None)) revert Mismatch();
            if (kind == uint8(Kind.Bounty) && trigger == uint8(Trigger.None)) revert Mismatch();
            p.kind = kind; p.trigger = trigger; p.targetTokenId = targetTokenId; p.expiry = expiry;
        } else {
            if (p.kind != kind || p.trigger != trigger || p.targetTokenId != targetTokenId || p.expiry != expiry) revert Mismatch();
            if (block.timestamp >= p.expiry) revert Expired();
        }
        if (p.total + amount > maxPerId) revert OverCeiling();
        if (toSeasonIfUnclaimed) {
            if (seasonId == bytes32(0) || seasonId == id) revert Mismatch();
            if (seasonOf[id] == bytes32(0)) seasonOf[id] = seasonId; else if (seasonOf[id] != seasonId) revert Mismatch();
            toSeason[id][msg.sender] = true;
        }
        p.total += amount;
        funded[id][msg.sender] += amount;
        if (!chog.transferFrom(msg.sender, address(this), amount)) revert ZeroAmount();
        emit Funded(id, msg.sender, amount, kind, targetTokenId, trigger, expiry, toSeasonIfUnclaimed);
    }

    function fundWithPermit(bytes32 id, uint8 kind, uint256 targetTokenId, uint8 trigger, uint256 amount, uint64 expiry, bool toSeasonIfUnclaimed, bytes32 seasonId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        IERC20Permit(address(chog)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        fund(id, kind, targetTokenId, trigger, amount, expiry, toSeasonIfUnclaimed, seasonId);
    }

    // ---- settlement: anyone may submit the signer's attestation ----
    function settle(bytes32 id, uint256 winnerTokenId, bytes32 eventDigest, string calldata rulesVersion, bytes calldata signature) external {
        if (settlementPaused) revert PausedErr();
        Pool storage p = pools[id];
        if (p.settled) revert AlreadySettled();
        if (p.total == 0) revert NothingToReclaim();
        if (block.timestamp >= p.expiry) revert Expired();
        if (recover(settlementDigest(id, winnerTokenId, eventDigest, rulesVersion), signature) != resultSigner) revert BadSignature();
        uint256 amount = p.total;
        p.settled = true; p.paidTo = winnerTokenId; p.eventDigest = eventDigest; p.total = 0;
        address chest = ensureChest(winnerTokenId);
        if (!chog.transfer(chest, amount)) revert ZeroAmount();
        emit Settled(id, winnerTokenId, chest, amount, eventDigest);
    }

    /// The EIP-712 digest the result signer signs; exposed so a coordinator can self-check before submitting.
    function settlementDigest(bytes32 id, uint256 winnerTokenId, bytes32 eventDigest, string calldata rulesVersion) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(SETTLEMENT_TYPEHASH, id, winnerTokenId, eventDigest, keccak256(bytes(rulesVersion))));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    // ---- reclaim after expiry: never pausable, needs no server ----
    function reclaim(bytes32 id) external {
        Pool storage p = pools[id];
        if (p.settled) revert AlreadySettled();
        if (p.expiry == 0 || block.timestamp < p.expiry) revert NotExpired();
        uint256 amount = funded[id][msg.sender];
        if (amount == 0) revert NothingToReclaim();
        funded[id][msg.sender] = 0;
        p.total -= amount;
        if (toSeason[id][msg.sender]) {
            // the funder chose the season pot at deposit: the money moves there instead of back
            bytes32 sid = seasonOf[id];
            Pool storage sp = pools[sid];
            if (sp.settled || sp.expiry == 0 || block.timestamp >= sp.expiry) {
                // no live season pot to roll into: refund instead, never strand
                if (!chog.transfer(msg.sender, amount)) revert ZeroAmount();
                emit Reclaimed(id, msg.sender, amount);
                return;
            }
            if (sp.total + amount > maxPerId) { if (!chog.transfer(msg.sender, amount)) revert ZeroAmount(); emit Reclaimed(id, msg.sender, amount); return; }
            sp.total += amount;
            funded[sid][msg.sender] += amount;
            emit RolledToSeason(id, sid, msg.sender, amount);
            return;
        }
        if (!chog.transfer(msg.sender, amount)) revert ZeroAmount();
        emit Reclaimed(id, msg.sender, amount);
    }

    /// Anyone may roll a flagged funder's share into the season pot after expiry (so the season pot fills without the funder).
    function rollToSeason(bytes32 id, address funder) external {
        Pool storage p = pools[id];
        if (p.settled) revert AlreadySettled();
        if (p.expiry == 0 || block.timestamp < p.expiry) revert NotExpired();
        if (!toSeason[id][funder]) revert NotFlaggedForSeason();
        uint256 amount = funded[id][funder];
        if (amount == 0) revert NothingToReclaim();
        bytes32 sid = seasonOf[id];
        Pool storage sp = pools[sid];
        if (sp.settled || sp.expiry == 0 || block.timestamp >= sp.expiry || sp.total + amount > maxPerId) revert Mismatch();
        funded[id][funder] = 0;
        p.total -= amount;
        sp.total += amount;
        funded[sid][funder] += amount;
        emit RolledToSeason(id, sid, funder, amount);
    }

    // ---- chests ----
    function chestOf(uint256 tokenId) public view returns (address) {
        return registry.account(accountProxy, bytes32(0), chainId, collection, tokenId);
    }
    /// Creates and initializes the winner's chest if it has no code, so a holder's first withdrawal is one transaction.
    function ensureChest(uint256 tokenId) internal returns (address chest) {
        chest = chestOf(tokenId);
        if (chest.code.length == 0) {
            address created = registry.createAccount(accountProxy, bytes32(0), chainId, collection, tokenId);
            if (created != chest) revert ChestInitFailed();
            ITokenboundProxy(chest).initialize(accountImpl);
        }
    }

    function recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
    function domainSeparator() external view returns (bytes32) { return DOMAIN_SEPARATOR; }
}
