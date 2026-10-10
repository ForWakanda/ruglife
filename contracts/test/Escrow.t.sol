// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RugLifeEscrow} from "../src/RugLifeEscrow.sol";
import {SeasonStamp} from "../src/SeasonStamp.sol";
import {MockChog, MockNFT, MockRegistry, MockChest} from "./Mocks.sol";

contract EscrowTest is Test {
    MockChog chog; MockNFT nft; MockRegistry registry; RugLifeEscrow escrow; SeasonStamp stampc;
    address proxy = address(0xABCD); address impl = address(0xBEEF);
    uint256 signerKey = 0xA11CE; address signer;
    uint256 funderKey = 0xF00D; address funder;
    address guardian = address(0x6A);
    address holder = address(0x401D);
    uint256 constant TOKEN = 287;
    uint256 constant MAX = 1_000_000 ether;
    bytes32 constant ID = keccak256("table-1 pot");

    function setUp() public {
        signer = vm.addr(signerKey); funder = vm.addr(funderKey);
        chog = new MockChog(); nft = new MockNFT(); registry = new MockRegistry();
        escrow = new RugLifeEscrow(address(chog), address(registry), proxy, impl, address(nft), signer, guardian, MAX);
        stampc = new SeasonStamp(address(chog), address(nft), address(escrow));
        nft.setOwner(TOKEN, holder);
        chog.mint(funder, 10_000 ether);
        chog.mint(holder, 1_000 ether);
        vm.prank(funder); chog.approve(address(escrow), type(uint256).max);
    }

    function fundPot(bytes32 id, uint256 amount, uint64 expiry) internal {
        vm.prank(funder);
        escrow.fund(id, uint8(RugLifeEscrow.Kind.Pot), 0, uint8(RugLifeEscrow.Trigger.None), amount, expiry, false, bytes32(0));
    }
    function sig(bytes32 id, uint256 winner, bytes32 digest, string memory rules, uint256 key) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(keccak256("Settlement(bytes32 id,uint256 winnerTokenId,bytes32 eventDigest,string rulesVersion)"), id, winner, digest, keccak256(bytes(rules))));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, d);
        return abi.encodePacked(r, s, v);
    }

    function test_fund_fixesTermsAndAggregates() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        fundPot(ID, 100 ether, exp);
        (uint8 kind, uint8 trig, uint256 target, uint64 expiry, uint256 total, bool settled,,) = escrow.pools(ID);
        assertEq(kind, 0); assertEq(trig, 0); assertEq(target, 0); assertEq(expiry, exp); assertEq(total, 100 ether); assertFalse(settled);
        fundPot(ID, 50 ether, exp);
        (,,,, total,,,) = escrow.pools(ID);
        assertEq(total, 150 ether);
        assertEq(escrow.funded(ID, funder), 150 ether);
        // different terms for the same id are refused
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.Mismatch.selector);
        escrow.fund(ID, uint8(RugLifeEscrow.Kind.Pot), 0, uint8(RugLifeEscrow.Trigger.None), 1 ether, exp + 1, false, bytes32(0));
        // a bounty needs a trigger; a pot must not have one
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.Mismatch.selector);
        escrow.fund(keccak256("b"), uint8(RugLifeEscrow.Kind.Bounty), TOKEN, uint8(RugLifeEscrow.Trigger.None), 1 ether, exp, false, bytes32(0));
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.Mismatch.selector);
        escrow.fund(keccak256("p"), uint8(RugLifeEscrow.Kind.Pot), 0, uint8(RugLifeEscrow.Trigger.Hit), 1 ether, exp, false, bytes32(0));
        // ceiling
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.OverCeiling.selector);
        escrow.fund(keccak256("big"), uint8(RugLifeEscrow.Kind.Pot), 0, 0, MAX + 1, exp, false, bytes32(0));
        // zero and past expiry
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.ZeroAmount.selector);
        escrow.fund(keccak256("z"), 0, 0, 0, 0, exp, false, bytes32(0));
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.BadExpiry.selector);
        escrow.fund(keccak256("old"), 0, 0, 0, 1 ether, uint64(block.timestamp), false, bytes32(0));
    }

    function test_fundWithPermit() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(chog.PERMIT_TYPEHASH(), funder, address(escrow), 7 ether, chog.nonces(funder), deadline));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", chog.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(funderKey, d);
        vm.prank(funder); chog.approve(address(escrow), 0); // no prior allowance: the permit must do it
        vm.prank(funder);
        escrow.fundWithPermit(ID, 0, 0, 0, 7 ether, exp, false, bytes32(0), deadline, v, r, s);
        assertEq(chog.balanceOf(address(escrow)), 7 ether);
        // the same permit again is refused (nonce consumed)
        vm.prank(funder); vm.expectRevert("ERC20Permit: invalid signature");
        escrow.fundWithPermit(ID, 0, 0, 0, 7 ether, exp, false, bytes32(0), deadline, v, r, s);
    }

    function test_settle_paysTheChestOnceAndCreatesIt() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        fundPot(ID, 100 ether, exp);
        address chest = escrow.chestOf(TOKEN);
        assertEq(chest.code.length, 0);
        bytes32 ev = keccak256("events");
        bytes memory s = sig(ID, TOKEN, ev, "0.2.0", signerKey);
        // anyone may submit
        vm.prank(address(0x1234));
        escrow.settle(ID, TOKEN, ev, "0.2.0", s);
        assertEq(chog.balanceOf(chest), 100 ether);
        assertGt(chest.code.length, 0);
        assertTrue(MockChest(chest).inited());
        assertEq(MockChest(chest).owner(), holder);
        // replay refused
        vm.expectRevert(RugLifeEscrow.AlreadySettled.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", s);
        // nothing more can be funded into a settled id
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.AlreadySettled.selector);
        escrow.fund(ID, 0, 0, 0, 1 ether, exp, false, bytes32(0));
        // the holder empties the chest; a stranger cannot
        bytes memory call = abi.encodeWithSelector(MockChog.transfer.selector, holder, 100 ether);
        vm.prank(address(0x999)); vm.expectRevert("NotAuthorized");
        MockChest(chest).execute(address(chog), 0, call, 0);
        vm.prank(holder);
        MockChest(chest).execute(address(chog), 0, call, 0);
        assertEq(chog.balanceOf(holder), 1_100 ether);
        assertEq(chog.balanceOf(chest), 0);
        // a second settlement to the same Chog reuses the chest
        bytes32 id2 = keccak256("table-2");
        fundPot(id2, 5 ether, exp);
        escrow.settle(id2, TOKEN, ev, "0.2.0", sig(id2, TOKEN, ev, "0.2.0", signerKey));
        assertEq(chog.balanceOf(chest), 5 ether);
    }

    function test_settle_refusals() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        fundPot(ID, 100 ether, exp);
        bytes32 ev = keccak256("events");
        // signatures are computed first: vm.expectRevert targets the NEXT external call
        bytes memory good = sig(ID, TOKEN, ev, "0.2.0", signerKey);
        bytes memory byFunder = sig(ID, TOKEN, ev, "0.2.0", funderKey);
        bytes memory forNope = sig(keccak256("nope"), TOKEN, ev, "0.2.0", signerKey);
        bytes memory byBob = sig(ID, TOKEN, ev, "0.2.0", 0xB0B);
        // wrong signer
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", byFunder);
        // the signature binds winner and rules version
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, 288, ev, "0.2.0", good);
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, TOKEN, ev, "0.3.0", good);
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, TOKEN, keccak256("other events"), "0.2.0", good);
        // malformed signature
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", hex"deadbeef");
        // unknown id
        vm.expectRevert(RugLifeEscrow.NothingToReclaim.selector);
        escrow.settle(keccak256("nope"), TOKEN, ev, "0.2.0", forNope);
        // paused by the guardian
        vm.prank(guardian); escrow.setPaused(false, true);
        vm.expectRevert(RugLifeEscrow.PausedErr.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", good);
        vm.prank(guardian); escrow.setPaused(false, false);
        // after expiry: settlement closed, reclaim open
        vm.warp(exp);
        vm.expectRevert(RugLifeEscrow.Expired.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", good);
        // a rotated signer is honoured, the old one not
        vm.warp(exp - 10);
        vm.prank(address(0x77)); vm.expectRevert(RugLifeEscrow.NotOwner.selector);
        escrow.setResultSigner(vm.addr(0xB0B));
        escrow.setResultSigner(vm.addr(0xB0B));
        vm.expectRevert(RugLifeEscrow.BadSignature.selector);
        escrow.settle(ID, TOKEN, ev, "0.2.0", good);
        escrow.settle(ID, TOKEN, ev, "0.2.0", byBob);
        assertEq(chog.balanceOf(escrow.chestOf(TOKEN)), 100 ether);
    }

    function test_reclaim_afterExpiryOnly_andNeverPausable() public {
        uint64 exp = uint64(block.timestamp + 1 days);
        fundPot(ID, 100 ether, exp);
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.NotExpired.selector);
        escrow.reclaim(ID);
        vm.warp(exp);
        vm.prank(guardian); escrow.setPaused(true, true); // pauses do not touch reclaim
        uint256 before = chog.balanceOf(funder);
        vm.prank(funder); escrow.reclaim(ID);
        assertEq(chog.balanceOf(funder), before + 100 ether);
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.NothingToReclaim.selector);
        escrow.reclaim(ID);
        // a stranger has nothing to reclaim
        vm.prank(address(0x77)); vm.expectRevert(RugLifeEscrow.NothingToReclaim.selector);
        escrow.reclaim(ID);
        // funding is paused
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.PausedErr.selector);
        escrow.fund(keccak256("x"), 0, 0, 0, 1 ether, uint64(block.timestamp + 1), false, bytes32(0));
        // only guardian/owner may pause
        vm.prank(address(0x77)); vm.expectRevert(RugLifeEscrow.NotGuardian.selector);
        escrow.setPaused(false, false);
    }

    function test_seasonRollover_whenFlagged_elseRefund() public {
        bytes32 season = stampc.seasonPotId(1);
        uint64 exp = uint64(block.timestamp + 1 days);
        uint64 seasonExp = uint64(block.timestamp + 30 days);
        // the season pot exists (one deposit) and outlives the bounty
        fundPot(season, 1 ether, seasonExp);
        bytes32 bounty = keccak256("bounty on 287");
        vm.prank(funder);
        escrow.fund(bounty, uint8(RugLifeEscrow.Kind.Bounty), TOKEN, uint8(RugLifeEscrow.Trigger.Hit), 40 ether, exp, true, season);
        // the flag cannot be re-pointed at another season
        vm.prank(funder); vm.expectRevert(RugLifeEscrow.Mismatch.selector);
        escrow.fund(bounty, uint8(RugLifeEscrow.Kind.Bounty), TOKEN, uint8(RugLifeEscrow.Trigger.Hit), 1 ether, exp, true, keccak256("other"));
        vm.warp(exp);
        // anyone may roll the flagged share into the season pot
        vm.prank(address(0x55)); escrow.rollToSeason(bounty, funder);
        (,,,, uint256 total,,,) = escrow.pools(season);
        assertEq(total, 41 ether);
        assertEq(escrow.funded(season, funder), 41 ether);
        assertEq(escrow.funded(bounty, funder), 0);
        // an unflagged funder's reclaim is a refund
        bytes32 b2 = keccak256("bounty 2");
        vm.warp(exp - 1 hours);
        vm.prank(funder);
        escrow.fund(b2, uint8(RugLifeEscrow.Kind.Bounty), TOKEN, uint8(RugLifeEscrow.Trigger.Rug), 3 ether, exp, false, bytes32(0));
        vm.warp(exp);
        vm.prank(address(0x55)); vm.expectRevert(RugLifeEscrow.NotFlaggedForSeason.selector);
        escrow.rollToSeason(b2, funder);
        uint256 before = chog.balanceOf(funder);
        vm.prank(funder); escrow.reclaim(b2);
        assertEq(chog.balanceOf(funder), before + 3 ether);
        // a flagged share with no live season pot falls back to a refund, never strands
        bytes32 b3 = keccak256("bounty 3");
        bytes32 deadSeason = keccak256("dead season");
        vm.warp(exp - 1 hours);
        vm.prank(funder);
        escrow.fund(b3, uint8(RugLifeEscrow.Kind.Bounty), TOKEN, uint8(RugLifeEscrow.Trigger.Hit), 2 ether, exp, true, deadSeason);
        vm.warp(exp);
        before = chog.balanceOf(funder);
        vm.prank(funder); escrow.reclaim(b3);
        assertEq(chog.balanceOf(funder), before + 2 ether);
    }

    function test_seasonStamp_disabledByDefault_thenWorks() public {
        vm.prank(holder); chog.approve(address(stampc), type(uint256).max);
        stampc.setSeason(1, 10 ether, uint64(block.timestamp + 30 days));
        vm.prank(holder); vm.expectRevert(SeasonStamp.Disabled.selector);
        stampc.stamp(1, TOKEN);
        stampc.setEnabled(true);
        // only the holder
        vm.prank(funder); vm.expectRevert(SeasonStamp.NotHolder.selector);
        stampc.stamp(1, TOKEN);
        vm.prank(holder); stampc.stamp(1, TOKEN);
        assertTrue(stampc.isStamped(1, TOKEN));
        assertEq(stampc.stampCount(1), 1);
        (,,,, uint256 total,,,) = escrow.pools(stampc.seasonPotId(1));
        assertEq(total, 10 ether);
        assertEq(chog.balanceOf(holder), 990 ether);
        vm.prank(holder); vm.expectRevert(SeasonStamp.AlreadyStamped.selector);
        stampc.stamp(1, TOKEN);
        // no season set
        vm.prank(holder); vm.expectRevert(SeasonStamp.NoSeason.selector);
        stampc.stamp(2, TOKEN);
        // the season pot settles to the finale winner's chest like any pot
        bytes32 ev = keccak256("finale");
        escrow.settle(stampc.seasonPotId(1), TOKEN, ev, "0.2.0", sig(stampc.seasonPotId(1), TOKEN, ev, "0.2.0", signerKey));
        assertEq(chog.balanceOf(escrow.chestOf(TOKEN)), 10 ether);
        // switched off again, the flow refuses
        stampc.setEnabled(false);
        vm.prank(holder); vm.expectRevert(SeasonStamp.Disabled.selector);
        stampc.stamp(1, 288);
    }

    function test_seasonStamp_withPermit() public {
        stampc.setSeason(1, 10 ether, uint64(block.timestamp + 30 days));
        stampc.setEnabled(true);
        uint256 holderKey = 0xC0FFEE; address h2 = vm.addr(holderKey);
        nft.setOwner(5, h2); chog.mint(h2, 10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(chog.PERMIT_TYPEHASH(), h2, address(stampc), 10 ether, chog.nonces(h2), deadline));
        bytes32 d = keccak256(abi.encodePacked("\x19\x01", chog.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(holderKey, d);
        vm.prank(h2); stampc.stampWithPermit(1, 5, deadline, v, r, s);
        assertTrue(stampc.isStamped(1, 5));
        assertEq(chog.balanceOf(h2), 0);
    }
}
