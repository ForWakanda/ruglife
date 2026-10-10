// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RugLifeEscrow} from "../src/RugLifeEscrow.sol";
import {IERC20, IERC721} from "../src/Interfaces.sol";

interface IAccountV3 {
    function execute(address to, uint256 value, bytes calldata data, uint8 operation) external payable returns (bytes memory);
    function owner() external view returns (address);
    function token() external view returns (uint256, address, uint256);
}

/// Against a Monad mainnet fork: the real $CHOG, the real ERC-6551 registry and Tokenbound proxy/implementation,
/// the real Chog Genesis. Run: forge test --match-contract ForkTest --fork-url https://rpc.monad.xyz
contract ForkTest is Test {
    address constant CHOG = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    address constant REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address constant PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address constant IMPL = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    address constant GENESIS = 0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763;
    uint256 constant TOKEN = 287; // CHOG #1748; its chest was not deployed on mainnet as of 2026-10-06
    bytes32 constant ID = keccak256("fork pot");
    uint256 constant SIGNER_KEY = 0xA11CE;
    RugLifeEscrow escrow;

    function _fund() internal {
        address funder = address(0xF00D);
        deal(CHOG, funder, 100 ether);
        vm.startPrank(funder);
        IERC20(CHOG).approve(address(escrow), 100 ether);
        escrow.fund(ID, 0, 0, 0, 100 ether, uint64(block.timestamp + 1 days), false, bytes32(0));
        vm.stopPrank();
    }
    function _signature() internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(keccak256("Settlement(bytes32 id,uint256 winnerTokenId,bytes32 eventDigest,string rulesVersion)"), ID, TOKEN, keccak256("ev"), keccak256("0.2.0")));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, d);
        return abi.encodePacked(r, s, v);
    }
    function _checkChest(address chest, address holder) internal view {
        (uint256 cid, address coll, uint256 tid) = IAccountV3(chest).token();
        assertEq(cid, 143); assertEq(coll, GENESIS); assertEq(tid, TOKEN);
        assertEq(IAccountV3(chest).owner(), holder);
    }
    function _withdraw(address chest, address holder) internal {
        bytes memory call = abi.encodeWithSelector(IERC20.transfer.selector, holder, 100 ether);
        vm.prank(address(0x999));
        vm.expectRevert();
        IAccountV3(chest).execute(CHOG, 0, call, 0);
        uint256 before = IERC20(CHOG).balanceOf(holder);
        vm.prank(holder);
        IAccountV3(chest).execute(CHOG, 0, call, 0);
        assertEq(IERC20(CHOG).balanceOf(holder), before + 100 ether);
        assertEq(IERC20(CHOG).balanceOf(chest), 0);
    }

    function test_fork_settleCreatesChest_holderWithdraws() public {
        if (block.chainid != 143) { emit log("not a Monad fork; skipped"); return; }
        escrow = new RugLifeEscrow(CHOG, REGISTRY, PROXY, IMPL, GENESIS, vm.addr(SIGNER_KEY), address(this), 1_000_000 ether);
        address chest = escrow.chestOf(TOKEN);
        assertEq(chest, 0x29D6948a55c3e9442DD32A047104dfaE7c0946eD, "chest address pinned 2026-10-06");
        emit log_named_uint("chest code bytes before", chest.code.length);
        address holder = IERC721(GENESIS).ownerOf(TOKEN);
        _fund();
        bytes memory s = _signature();
        escrow.settle(ID, TOKEN, keccak256("ev"), "0.2.0", s);
        assertEq(IERC20(CHOG).balanceOf(chest), 100 ether);
        assertGt(chest.code.length, 0);
        _checkChest(chest, holder);
        _withdraw(chest, holder);
    }
}
