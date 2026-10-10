// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20, IERC20Permit, IERC721} from "./Interfaces.sol";
import {RugLifeEscrow} from "./RugLifeEscrow.sol";

/// Season stamp on a Chog, paid in $CHOG; proceeds go to that season's pot in the escrow.
/// Deployed with `enabled = false`: "implemented" means this flow passes its tests while switched off.
contract SeasonStamp {
    IERC20 public immutable chog;
    IERC721 public immutable collection;
    RugLifeEscrow public immutable escrow;
    address public owner;
    bool public enabled;
    mapping(uint32 => uint256) public price; // per season, in $CHOG wei
    mapping(uint32 => uint64) public seasonExpiry; // when the season pot may be settled until
    mapping(uint32 => mapping(uint256 => bool)) public stamped;
    mapping(uint32 => uint256) public stampCount;

    event Stamped(uint32 indexed season, uint256 indexed tokenId, address indexed by, uint256 paid);
    event Enabled(bool on);
    event SeasonSet(uint32 season, uint256 price, uint64 expiry);

    error NotOwner();
    error Disabled();
    error NoSeason();
    error AlreadyStamped();
    error NotHolder();

    constructor(address chog_, address collection_, address escrow_) {
        chog = IERC20(chog_); collection = IERC721(collection_); escrow = RugLifeEscrow(escrow_); owner = msg.sender;
    }
    function setEnabled(bool on) external { if (msg.sender != owner) revert NotOwner(); enabled = on; emit Enabled(on); }
    function setSeason(uint32 season, uint256 price_, uint64 expiry) external { if (msg.sender != owner) revert NotOwner(); price[season] = price_; seasonExpiry[season] = expiry; emit SeasonSet(season, price_, expiry); }

    function seasonPotId(uint32 season) public pure returns (bytes32) { return keccak256(abi.encodePacked("RUG LIFE season pot", season)); }
    function isStamped(uint32 season, uint256 tokenId) external view returns (bool) { return stamped[season][tokenId]; }

    /// The Chog's current holder stamps it; the price moves from the holder to the season pot via the escrow.
    function stamp(uint32 season, uint256 tokenId) public {
        if (!enabled) revert Disabled();
        uint256 p = price[season];
        if (p == 0 || seasonExpiry[season] <= block.timestamp) revert NoSeason();
        if (stamped[season][tokenId]) revert AlreadyStamped();
        if (collection.ownerOf(tokenId) != msg.sender) revert NotHolder();
        stamped[season][tokenId] = true;
        stampCount[season] += 1;
        require(chog.transferFrom(msg.sender, address(this), p), "pull");
        require(chog.approve(address(escrow), p), "approve");
        escrow.fund(seasonPotId(season), uint8(RugLifeEscrow.Kind.Pot), 0, uint8(RugLifeEscrow.Trigger.None), p, seasonExpiry[season], false, bytes32(0));
        emit Stamped(season, tokenId, msg.sender, p);
    }
    function stampWithPermit(uint32 season, uint256 tokenId, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        IERC20Permit(address(chog)).permit(msg.sender, address(this), price[season], deadline, v, r, s);
        stamp(season, tokenId);
    }
    /// If a season pot expires unsettled, the stamp contract (its funder) reclaims and the owner can forward it to the next season.
    function reclaimSeason(uint32 season) external { if (msg.sender != owner) revert NotOwner(); escrow.reclaim(seasonPotId(season)); }
    function forward(address to, uint256 amount) external { if (msg.sender != owner) revert NotOwner(); require(chog.transfer(to, amount), "transfer"); }
}
