// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MilestoneEscrow} from "../MilestoneEscrow.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/**
 * @title MilestoneEscrowTest
 * @notice Full test suite for MilestoneEscrow (two-party, no arbiter).
 *
 * Setup invariants:
 *   - block.chainid == 5042002  (vm.chainId)
 *   - MockERC20 etched at USDC constant address 0x3600...0000
 *   - client has infinite approval to escrow
 */
contract MilestoneEscrowTest is Test {
    // ── constants ──────────────────────────────────────────────────────────────
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    uint256 internal constant CHAIN_ID   = 5042002;

    uint256 internal constant DELIVERY   = 7 days;
    uint256 internal constant GRACE      = 1 days;
    uint256 internal constant REVIEW     = 3 days;
    uint256 internal constant DISPUTE_W  = 5 days;
    uint256 internal constant AMOUNT     = 1_000e6; // 1,000 USDC (6 dec)

    // ── actors ────────────────────────────────────────────────────────────────
    address internal lead   = makeAddr("lead");
    address internal client = makeAddr("client");
    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");
    address internal dave   = makeAddr("dave");
    address internal nobody = makeAddr("nobody");

    // ── state ─────────────────────────────────────────────────────────────────
    MockERC20        internal usdc;
    MilestoneEscrow  internal escrow;

    // Standard 3-payee split  5000/4000/1000
    address[] internal payees3;
    uint256[] internal bps3;

    // ── setUp ─────────────────────────────────────────────────────────────────
    function setUp() public {
        // 1. Set chain id to Arc Testnet
        vm.chainId(CHAIN_ID);

        // 2. Deploy a mock ERC-20 and etch it at the hardcoded USDC address
        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mock).code);
        usdc = MockERC20(USDC_ADDR);

        // 3. Deploy escrow
        escrow = new MilestoneEscrow();

        // 4. Build standard payee arrays
        payees3 = new address[](3);
        payees3[0] = alice;
        payees3[1] = bob;
        payees3[2] = carol;

        bps3 = new uint256[](3);
        bps3[0] = 5000;
        bps3[1] = 4000;
        bps3[2] = 1000;

        // 5. Mint USDC to client and give infinite approval to escrow
        usdc.mint(client, 100_000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// Create a standard milestone (lead = this.lead, client = this.client).
    function _create() internal returns (uint256 id) {
        vm.prank(lead);
        id = escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, payees3, bps3);
    }

    /// Create + fund.
    function _fund() internal returns (uint256 id) {
        id = _create();
        vm.prank(client);
        escrow.fund(id);
    }

    /// Create + fund + submit.
    function _submit() internal returns (uint256 id, uint256 submittedAt) {
        id = _fund();
        vm.prank(lead);
        escrow.submit(id);
        (,,,,,,,, submittedAt,,,) = escrow.getMilestone(id);
    }

    /// Create + fund + submit + dispute.
    function _dispute(string memory reason) internal returns (uint256 id) {
        uint256 sat;
        (id, sat) = _submit();
        vm.prank(client);
        escrow.dispute(id, reason);
        (uint256 da) = _disputedAt(id);
        assertEq(da, block.timestamp, "disputedAt set");
    }

    function _disputedAt(uint256 id) internal view returns (uint256 da) {
        (,,,,,,,,, da,,) = escrow.getMilestone(id);
    }

    function _state(uint256 id) internal view returns (uint256 s) {
        MilestoneEscrow.State st;
        (,,,,,,,,,,st,) = escrow.getMilestone(id);
        s = uint256(st);
    }

    function _outcome(uint256 id) internal view returns (uint256 o) {
        MilestoneEscrow.Outcome oc;
        (,,,,,,,,,, , oc) = escrow.getMilestone(id);
        o = uint256(oc);
    }

    function _deadline(uint256 id) internal view returns (uint256 dl) {
        (,,,,,,, dl,,,,) = escrow.getMilestone(id);
    }

    function _submittedAt(uint256 id) internal view returns (uint256 sa) {
        (,,,,,,,, sa,,,) = escrow.getMilestone(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Approve path: create → fund → submit → approve
    // ─────────────────────────────────────────────────────────────────────────
    function test_ApprovePath_SettledApproved() public {
        uint256 id = _fund();
        vm.prank(lead);
        escrow.submit(id);

        // Expect Settled event
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Settled(id, MilestoneEscrow.Outcome.Approved, 0, AMOUNT);

        vm.prank(client);
        escrow.approve(id);

        assertEq(_state(id), uint256(MilestoneEscrow.State.Settled));
        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.Approved));

        // 5000/4000/1000 of AMOUNT
        assertEq(usdc.balanceOf(alice), (AMOUNT * 5000) / 10_000, "alice share");
        assertEq(usdc.balanceOf(bob),   (AMOUNT * 4000) / 10_000, "bob share");
        // Carol is last payee — gets remainder
        uint256 carolExpected = AMOUNT - (AMOUNT * 5000) / 10_000 - (AMOUNT * 4000) / 10_000;
        assertEq(usdc.balanceOf(carol), carolExpected, "carol share");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Auto-approve via settle at exactly submittedAt + reviewWindow
    // ─────────────────────────────────────────────────────────────────────────
    function test_AutoApprove_AtReviewWindowBoundary() public {
        (uint256 id, uint256 submittedAt) = _submit();

        vm.warp(submittedAt + REVIEW);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Settled(id, MilestoneEscrow.Outcome.AutoApproved, 0, AMOUNT);

        escrow.settle(id);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.AutoApproved));
        assertEq(usdc.balanceOf(alice), (AMOUNT * 5000) / 10_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Auto-approve settle reverts 1 second before window
    // ─────────────────────────────────────────────────────────────────────────
    function test_AutoApprove_RevertsOneSecondBefore() public {
        (uint256 id, uint256 submittedAt) = _submit();

        vm.warp(submittedAt + REVIEW - 1);

        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Dispute within review window at last valid second
    // ─────────────────────────────────────────────────────────────────────────
    function test_Dispute_AtLastValidSecond() public {
        (uint256 id, uint256 submittedAt) = _submit();

        vm.warp(submittedAt + REVIEW - 1);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Disputed(id, "bad work");

        vm.prank(client);
        escrow.dispute(id, "bad work");

        assertEq(_state(id), uint256(MilestoneEscrow.State.Disputed));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Dispute reverts at exactly submittedAt + reviewWindow
    // ─────────────────────────────────────────────────────────────────────────
    function test_Dispute_RevertsAtReviewWindowExpiry() public {
        (uint256 id, uint256 submittedAt) = _submit();

        vm.warp(submittedAt + REVIEW);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.ReviewWindowExpired.selector, id));
        escrow.dispute(id, "too late");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Client concede → ClientConceded, 100% to crew payees
    // ─────────────────────────────────────────────────────────────────────────
    function test_ClientConcede_ClientConcededOutcome() public {
        uint256 id = _dispute("no good");

        vm.expectEmit(true, true, false, false, address(escrow));
        emit MilestoneEscrow.Conceded(id, client);

        vm.prank(client);
        escrow.concede(id);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.ClientConceded));
        // client gets nothing back
        // crew gets 100%
        uint256 aliceAmt = (AMOUNT * 5000) / 10_000;
        assertEq(usdc.balanceOf(alice), aliceAmt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Lead concede → LeadConceded, 100% refund to client
    // ─────────────────────────────────────────────────────────────────────────
    function test_LeadConcede_LeadConcededOutcome_FullRefund() public {
        uint256 id = _dispute("dispute");

        uint256 clientBefore = usdc.balanceOf(client);

        vm.expectEmit(true, true, false, false, address(escrow));
        emit MilestoneEscrow.Conceded(id, lead);

        vm.prank(lead);
        escrow.concede(id);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.LeadConceded));
        assertEq(usdc.balanceOf(client), clientBefore + AMOUNT, "client receives full refund");
        // crew gets nothing
        assertEq(usdc.balanceOf(alice), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Split propose by lead, accept by client
    // ─────────────────────────────────────────────────────────────────────────
    function test_Split_LeadProposes_ClientAccepts() public {
        uint256 id = _dispute("split test");
        uint256 refundBps = 4000;
        uint256 expectedClient = (AMOUNT * refundBps) / 10_000;
        uint256 expectedCrew   = AMOUNT - expectedClient;

        vm.prank(lead);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneEscrow.SplitProposed(id, lead, refundBps);
        escrow.proposeSplit(id, refundBps);

        uint256 clientBefore = usdc.balanceOf(client);

        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.SplitAccepted(id, refundBps);
        escrow.acceptSplit(id, refundBps);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.SplitSettlement));
        assertEq(usdc.balanceOf(client), clientBefore + expectedClient, "client part");
        // crew total correct
        uint256 crewTotal = usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        assertEq(crewTotal, expectedCrew, "crew part");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. Split propose by client, accept by lead
    // ─────────────────────────────────────────────────────────────────────────
    function test_Split_ClientProposes_LeadAccepts() public {
        uint256 id = _dispute("client proposes");
        uint256 refundBps = 6000;

        vm.prank(client);
        escrow.proposeSplit(id, refundBps);

        vm.prank(lead);
        escrow.acceptSplit(id, refundBps);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.SplitSettlement));
        uint256 expectedClient = (AMOUNT * refundBps) / 10_000;
        assertEq(usdc.balanceOf(client), expectedClient + (100_000e6 - AMOUNT), "client balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Split re-proposal overwrites previous
    // ─────────────────────────────────────────────────────────────────────────
    function test_Split_ReproposalOverwritesPrevious() public {
        uint256 id = _dispute("overwrite");

        vm.prank(lead);
        escrow.proposeSplit(id, 3000);

        vm.prank(lead);
        escrow.proposeSplit(id, 4000);

        (,, , address proposer, uint256 storedBps) = escrow.getMilestoneExtra(id);
        assertEq(storedBps, 4000, "only latest proposal stored");
        assertEq(proposer, lead);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. acceptSplit with stale refundBps reverts (StaleSplitProposal)
    // ─────────────────────────────────────────────────────────────────────────
    function test_AcceptSplit_StaleReverts() public {
        uint256 id = _dispute("stale");

        vm.prank(lead);
        escrow.proposeSplit(id, 3000);

        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.StaleSplitProposal.selector);
        escrow.acceptSplit(id, 9999); // wrong bps
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. Proposer cannot self-accept (SelfAccept)
    // ─────────────────────────────────────────────────────────────────────────
    function test_AcceptSplit_SelfAcceptReverts() public {
        uint256 id = _dispute("self-accept");

        vm.prank(lead);
        escrow.proposeSplit(id, 5000);

        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.SelfAccept.selector);
        escrow.acceptSplit(id, 5000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 13. Dispute timeout at exactly disputedAt + disputeWindow → 50/50 each
    // ─────────────────────────────────────────────────────────────────────────
    function test_DisputeTimeout_AtExactBoundary() public {
        uint256 id = _dispute("timeout test");
        uint256 da = _disputedAt(id);

        vm.warp(da + DISPUTE_W);

        uint256 expectedClient = (AMOUNT * 5000) / 10_000;
        uint256 expectedCrew   = AMOUNT - expectedClient;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Settled(id, MilestoneEscrow.Outcome.DisputeTimeout, expectedClient, expectedCrew);

        escrow.settle(id);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.DisputeTimeout));
        uint256 clientBefore = 100_000e6 - AMOUNT; // client funded AMOUNT
        assertEq(usdc.balanceOf(client), clientBefore + expectedClient);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 14. Dispute timeout settle reverts 1s before window
    // ─────────────────────────────────────────────────────────────────────────
    function test_DisputeTimeout_RevertsOneSecondBefore() public {
        uint256 id = _dispute("too early");
        uint256 da = _disputedAt(id);

        vm.warp(da + DISPUTE_W - 1);

        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 15. Extension request + approve: deadline updated, both events emitted
    // ─────────────────────────────────────────────────────────────────────────
    function test_Extension_RequestAndApprove() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        uint256 newDl = dl + 2 days;

        vm.prank(lead);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneEscrow.ExtensionRequested(id, lead, newDl);
        escrow.requestExtension(id, newDl);

        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.ExtensionApproved(id, newDl);
        escrow.approveExtension(id, newDl);

        assertEq(_deadline(id), newDl, "deadline updated");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 16. Stale extension reverts: request X, request Y, client approves X
    // ─────────────────────────────────────────────────────────────────────────
    function test_Extension_StaleReverts() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);

        vm.prank(lead);
        escrow.requestExtension(id, dl + 1 days);

        vm.prank(lead);
        escrow.requestExtension(id, dl + 2 days); // overwrites

        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.StaleExtensionRequest.selector);
        escrow.approveExtension(id, dl + 1 days); // stale value
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 17. Extension after deadline revives InProgress
    // ─────────────────────────────────────────────────────────────────────────
    function test_Extension_AfterDeadlineRevivesInProgress() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);

        // Warp past deadline (but not past grace)
        vm.warp(dl + GRACE - 1);

        // Lead requests extension to future
        uint256 newDl = block.timestamp + 10 days;
        vm.prank(lead);
        escrow.requestExtension(id, newDl);

        vm.prank(client);
        escrow.approveExtension(id, newDl);

        assertEq(_deadline(id), newDl);

        // Now submit should succeed within the new deadline
        vm.warp(newDl - 1);
        vm.prank(lead);
        escrow.submit(id); // should not revert
        assertEq(_state(id), uint256(MilestoneEscrow.State.UnderReview));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 18. Late submit inside grace: deadline + gracePeriod - 1
    // ─────────────────────────────────────────────────────────────────────────
    function test_Submit_LateInsideGrace() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);

        vm.warp(dl + GRACE - 1);
        vm.prank(lead);
        escrow.submit(id);
        assertEq(_state(id), uint256(MilestoneEscrow.State.UnderReview));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 19. Submit at exactly deadline + gracePeriod succeeds
    // ─────────────────────────────────────────────────────────────────────────
    function test_Submit_AtExactGraceBoundarySucceeds() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);

        vm.warp(dl + GRACE);
        vm.prank(lead);
        escrow.submit(id);
        assertEq(_state(id), uint256(MilestoneEscrow.State.UnderReview));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 20. Submit 1s after deadline + gracePeriod reverts (DeadlinePassed)
    // ─────────────────────────────────────────────────────────────────────────
    function test_Submit_AfterGraceReverts() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);

        vm.warp(dl + GRACE + 1);
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.DeadlinePassed.selector);
        escrow.submit(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 21. Refunded via settle: fund → warp past grace → settle → Refunded
    // ─────────────────────────────────────────────────────────────────────────
    function test_Settle_Refunded() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        uint256 clientBefore = usdc.balanceOf(client);

        vm.warp(dl + GRACE + 1);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Settled(id, MilestoneEscrow.Outcome.Refunded, AMOUNT, 0);

        escrow.settle(id);

        assertEq(_outcome(id), uint256(MilestoneEscrow.Outcome.Refunded));
        assertEq(usdc.balanceOf(client), clientBefore + AMOUNT, "full refund");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 22. settle reverts in non-eligible states
    // ─────────────────────────────────────────────────────────────────────────
    function test_Settle_RevertsInProgress_BeforeGrace() public {
        uint256 id = _fund();
        // InProgress, before grace expired
        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    function test_Settle_RevertsSettled() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.warp(dl + GRACE + 1);
        escrow.settle(id); // Refunded
        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    function test_Settle_RevertsCancelled() public {
        uint256 id = _create();
        vm.prank(lead);
        escrow.cancel(id);
        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 23. Cancel only works in Created; reverts after fund
    // ─────────────────────────────────────────────────────────────────────────
    function test_Cancel_RevertsAfterFund() public {
        uint256 id = _fund();
        vm.prank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(MilestoneEscrow.InvalidState.selector, id, MilestoneEscrow.State.InProgress)
        );
        escrow.cancel(id);
    }

    function test_Cancel_SucceedsInCreated() public {
        uint256 id = _create();
        vm.prank(lead);
        vm.expectEmit(true, false, false, false, address(escrow));
        emit MilestoneEscrow.Cancelled(id);
        escrow.cancel(id);
        assertEq(_state(id), uint256(MilestoneEscrow.State.Cancelled));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 24. refundBps = 0 in acceptSplit → all to crew
    // ─────────────────────────────────────────────────────────────────────────
    function test_AcceptSplit_ZeroRefundBps_AllToCrew() public {
        uint256 id = _dispute("all crew");

        vm.prank(lead);
        escrow.proposeSplit(id, 0);

        uint256 clientBefore = usdc.balanceOf(client);

        vm.prank(client);
        escrow.acceptSplit(id, 0);

        assertEq(usdc.balanceOf(client), clientBefore, "client gets nothing");
        uint256 crewTotal = usdc.balanceOf(alice) + usdc.balanceOf(bob) + usdc.balanceOf(carol);
        assertEq(crewTotal, AMOUNT, "crew gets all");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 25. refundBps = 10000 in acceptSplit → all to client
    // ─────────────────────────────────────────────────────────────────────────
    function test_AcceptSplit_FullRefundBps_AllToClient() public {
        uint256 id = _dispute("all client");

        uint256 clientBefore = usdc.balanceOf(client);

        vm.prank(lead);
        escrow.proposeSplit(id, 10_000);

        vm.prank(client);
        escrow.acceptSplit(id, 10_000);

        assertEq(usdc.balanceOf(client), clientBefore + AMOUNT, "client gets all");
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(bob),   0);
        assertEq(usdc.balanceOf(carol), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 26. Dust: amount = 1_000_001, bps = [3333, 3333, 3334], split refundBps = 3333
    // ─────────────────────────────────────────────────────────────────────────
    function test_Dust_SplitExactBalance() public {
        uint256 dustAmount = 1_000_001;
        uint256[] memory dustBps = new uint256[](3);
        dustBps[0] = 3333;
        dustBps[1] = 3333;
        dustBps[2] = 3334;

        // Seed extra USDC to client for this milestone
        usdc.mint(client, dustAmount);

        vm.prank(lead);
        uint256 id = escrow.create(client, dustAmount, DELIVERY, GRACE, REVIEW, DISPUTE_W, payees3, dustBps);

        vm.prank(client);
        escrow.fund(id);

        vm.prank(lead);
        escrow.submit(id);

        // Dispute it
        (,,,,,,,, uint256 sa,,,) = escrow.getMilestone(id);
        vm.warp(sa + REVIEW - 1);
        vm.prank(client);
        escrow.dispute(id, "split test");

        // Lead proposes 3333 bps refund to client
        uint256 refundBps = 3333;
        vm.prank(lead);
        escrow.proposeSplit(id, refundBps);

        uint256 clientBefore = usdc.balanceOf(client);
        uint256 aliceBefore  = usdc.balanceOf(alice);
        uint256 bobBefore    = usdc.balanceOf(bob);
        uint256 carolBefore  = usdc.balanceOf(carol);

        vm.prank(client);
        escrow.acceptSplit(id, refundBps);

        uint256 clientGot = usdc.balanceOf(client) - clientBefore;
        uint256 aliceGot  = usdc.balanceOf(alice)  - aliceBefore;
        uint256 bobGot    = usdc.balanceOf(bob)    - bobBefore;
        uint256 carolGot  = usdc.balanceOf(carol)  - carolBefore;

        assertEq(clientGot + aliceGot + bobGot + carolGot, dustAmount, "no dust lost");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 27. Window caps
    // ─────────────────────────────────────────────────────────────────────────
    function test_WindowCap_DeliveryTooLong() public {
        vm.prank(lead);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.WindowTooLong.selector, 0, 365 days));
        escrow.create(client, AMOUNT, 365 days + 1, GRACE, REVIEW, DISPUTE_W, payees3, bps3);
    }

    function test_WindowCap_GraceTooLong() public {
        vm.prank(lead);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.WindowTooLong.selector, 0, 90 days));
        escrow.create(client, AMOUNT, DELIVERY, 90 days + 1, REVIEW, DISPUTE_W, payees3, bps3);
    }

    function test_WindowCap_ReviewTooLong() public {
        vm.prank(lead);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.WindowTooLong.selector, 0, 90 days));
        escrow.create(client, AMOUNT, DELIVERY, GRACE, 90 days + 1, DISPUTE_W, payees3, bps3);
    }

    function test_WindowCap_DisputeTooLong() public {
        vm.prank(lead);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.WindowTooLong.selector, 0, 90 days));
        escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, 90 days + 1, payees3, bps3);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 28. InvalidPayee: escrow address or USDC address
    // ─────────────────────────────────────────────────────────────────────────
    function test_InvalidPayee_EscrowAddress() public {
        payees3[0] = address(escrow);
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.InvalidPayee.selector);
        escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, payees3, bps3);
    }

    function test_InvalidPayee_USDCAddress() public {
        payees3[0] = USDC_ADDR;
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.InvalidPayee.selector);
        escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, payees3, bps3);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 29. TooManyPayees: 21 payees
    // ─────────────────────────────────────────────────────────────────────────
    function test_TooManyPayees() public {
        address[] memory bigPayees = new address[](21);
        uint256[] memory bigBps    = new uint256[](21);
        for (uint256 i = 0; i < 21; i++) {
            bigPayees[i] = makeAddr(string(abi.encode("payee", i)));
            bigBps[i]    = 476; // will not sum to 10000, but TooManyPayees fires first
        }
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.TooManyPayees.selector);
        escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, bigPayees, bigBps);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 30. ZeroBPS
    // ─────────────────────────────────────────────────────────────────────────
    function test_ZeroBPS() public {
        bps3[1] = 0; // zero in middle
        bps3[2] = 5000; // still sums to 10000 if check happened after but zero fires first
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.ZeroBPS.selector);
        escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, payees3, bps3);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 31. 20-payee settle gas < 1.5M
    // ─────────────────────────────────────────────────────────────────────────
    function test_TwentyPayees_ApproveGasUnder1_5M() public {
        address[] memory bigPayees = new address[](20);
        uint256[] memory bigBps    = new uint256[](20);
        for (uint256 i = 0; i < 20; i++) {
            bigPayees[i] = makeAddr(string(abi.encode("bigpayee", i)));
            bigBps[i]    = 500; // 20 * 500 = 10000
        }

        usdc.mint(client, AMOUNT);

        vm.prank(lead);
        uint256 id = escrow.create(client, AMOUNT, DELIVERY, GRACE, REVIEW, DISPUTE_W, bigPayees, bigBps);

        vm.prank(client);
        escrow.fund(id);

        vm.prank(lead);
        escrow.submit(id);

        uint256 gasBefore = gasleft();
        vm.prank(client);
        escrow.approve(id);
        uint256 gasUsed = gasBefore - gasleft();

        assertLt(gasUsed, 1_500_000, "approve with 20 payees should use < 1.5M gas");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 32. Unauthorized caller reverts
    // ─────────────────────────────────────────────────────────────────────────
    function test_Auth_Cancel_NonLead() public {
        uint256 id = _create();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotLead.selector, id, nobody));
        escrow.cancel(id);
    }

    function test_Auth_Fund_NonClient() public {
        uint256 id = _create();
        usdc.mint(nobody, AMOUNT);
        vm.prank(nobody);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotClient.selector, id, nobody));
        escrow.fund(id);
    }

    function test_Auth_Submit_NonLead() public {
        uint256 id = _fund();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotLead.selector, id, nobody));
        escrow.submit(id);
    }

    function test_Auth_Approve_NonClient() public {
        (uint256 id,) = _submit();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotClient.selector, id, nobody));
        escrow.approve(id);
    }

    function test_Auth_Dispute_NonClient() public {
        (uint256 id,) = _submit();
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotClient.selector, id, nobody));
        escrow.dispute(id, "hack");
    }

    function test_Auth_Concede_NonParty() public {
        uint256 id = _dispute("auth");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotParty.selector, id, nobody));
        escrow.concede(id);
    }

    function test_Auth_ProposeSplit_NonParty() public {
        uint256 id = _dispute("auth");
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotParty.selector, id, nobody));
        escrow.proposeSplit(id, 5000);
    }

    function test_Auth_RequestExtension_NonLead() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotLead.selector, id, nobody));
        escrow.requestExtension(id, dl + 1 days);
    }

    function test_Auth_ApproveExtension_NonClient() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.prank(lead);
        escrow.requestExtension(id, dl + 1 days);
        vm.prank(nobody);
        vm.expectRevert(abi.encodeWithSelector(MilestoneEscrow.NotClient.selector, id, nobody));
        escrow.approveExtension(id, dl + 1 days);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 33. Double settle reverts
    // ─────────────────────────────────────────────────────────────────────────
    function test_DoubleSettle_Reverts() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.warp(dl + GRACE + 1);
        escrow.settle(id);
        vm.expectRevert(MilestoneEscrow.NotSettleable.selector);
        escrow.settle(id);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 34. NoPendingExtension: approveExtension with no pending request
    // ─────────────────────────────────────────────────────────────────────────
    function test_ApproveExtension_NoPending() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.prank(client);
        vm.expectRevert(MilestoneEscrow.NoPendingExtension.selector);
        escrow.approveExtension(id, dl + 1 days);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 35. ExtensionDeadlineTooEarly
    // ─────────────────────────────────────────────────────────────────────────
    function test_RequestExtension_TooEarly() public {
        uint256 id = _fund();
        uint256 dl = _deadline(id);
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.ExtensionDeadlineTooEarly.selector);
        escrow.requestExtension(id, dl); // not strictly greater
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 36. ExtensionDeadlineTooLate
    // ─────────────────────────────────────────────────────────────────────────
    function test_RequestExtension_TooLate() public {
        uint256 id = _fund();
        vm.prank(lead);
        vm.expectRevert(MilestoneEscrow.ExtensionDeadlineTooLate.selector);
        escrow.requestExtension(id, block.timestamp + 365 days + 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 37. Blocked payee defers (revert path) + withdraw after unblock
    // ─────────────────────────────────────────────────────────────────────────
    function test_BlockedPayee_Revert_DefersThenWithdraws() public {
        // Block alice (payee 0 — 5000 bps)
        usdc.block(alice);

        uint256 id = _fund();
        vm.prank(lead);
        escrow.submit(id);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneEscrow.PayoutDeferred(id, alice, (AMOUNT * 5000) / 10_000);

        vm.prank(client);
        escrow.approve(id);

        // Alice's balance unchanged; pending credited
        assertEq(usdc.balanceOf(alice), 0, "alice not paid yet");
        assertEq(escrow.pendingWithdrawals(alice), (AMOUNT * 5000) / 10_000, "alice pending");

        // Bob and Carol paid directly
        assertEq(usdc.balanceOf(bob),   (AMOUNT * 4000) / 10_000, "bob paid");
        uint256 carolAmt = AMOUNT - (AMOUNT * 5000) / 10_000 - (AMOUNT * 4000) / 10_000;
        assertEq(usdc.balanceOf(carol), carolAmt, "carol paid");

        // Unblock alice and withdraw
        usdc.unblock(alice);
        vm.prank(alice);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Withdrawn(alice, (AMOUNT * 5000) / 10_000);
        escrow.withdraw();

        assertEq(usdc.balanceOf(alice), (AMOUNT * 5000) / 10_000, "alice received");
        assertEq(escrow.pendingWithdrawals(alice), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 38. Blocked payee defers (returns-false path)
    // ─────────────────────────────────────────────────────────────────────────
    function test_BlockedPayee_ReturnFalse_DefersThenWithdraws() public {
        usdc.setReturnFalseMode(true);
        usdc.block(alice);

        uint256 id = _fund();
        vm.prank(lead);
        escrow.submit(id);

        vm.prank(client);
        escrow.approve(id);

        assertEq(escrow.pendingWithdrawals(alice), (AMOUNT * 5000) / 10_000, "alice deferred (false mode)");

        usdc.unblock(alice);
        usdc.setReturnFalseMode(false);
        vm.prank(alice);
        escrow.withdraw();
        assertEq(usdc.balanceOf(alice), (AMOUNT * 5000) / 10_000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 39. Blocked client defers on lead concede → withdraw after unblock
    // ─────────────────────────────────────────────────────────────────────────
    function test_BlockedClient_LeadConcede_DefersThenWithdraws() public {
        uint256 id = _dispute("block client");

        // Block client so their refund transfer fails
        usdc.block(client);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit MilestoneEscrow.PayoutDeferred(id, client, AMOUNT);

        vm.prank(lead);
        escrow.concede(id);

        assertEq(escrow.pendingWithdrawals(client), AMOUNT, "client deferred");
        assertEq(usdc.balanceOf(client), 100_000e6 - AMOUNT, "client balance unchanged (blocked)");

        // Unblock client and withdraw
        usdc.unblock(client);
        vm.prank(client);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit MilestoneEscrow.Withdrawn(client, AMOUNT);
        escrow.withdraw();

        assertEq(usdc.balanceOf(client), 100_000e6, "client gets full refund via withdraw");
        assertEq(escrow.pendingWithdrawals(client), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 40. withdraw with nothing → NothingToWithdraw
    // ─────────────────────────────────────────────────────────────────────────
    function test_Withdraw_NothingReverts() public {
        vm.prank(nobody);
        vm.expectRevert(MilestoneEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 41. withdraw twice → second call reverts NothingToWithdraw
    // ─────────────────────────────────────────────────────────────────────────
    function test_Withdraw_TwiceReverts() public {
        usdc.block(alice);
        uint256 id = _fund();
        vm.prank(lead);
        escrow.submit(id);
        vm.prank(client);
        escrow.approve(id);

        usdc.unblock(alice);
        vm.prank(alice);
        escrow.withdraw();

        vm.prank(alice);
        vm.expectRevert(MilestoneEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 42. Invariant: escrow USDC balance == active amounts + pending withdrawals
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Handler contract for the balance invariant.
 *         Creates multiple milestones, funds and settles them, tracking
 *         which IDs are in active states and which addresses have pending.
 */
contract EscrowHandler is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    MilestoneEscrow internal escrow;
    MockERC20       internal usdc;

    address internal lead;
    address internal client;
    address[] internal crew;

    uint256[] internal activeMilestones;
    address[] internal knownAddresses;

    uint256 internal constant FIXED_AMOUNT = 1_000e6;

    constructor(MilestoneEscrow _escrow, MockERC20 _usdc) {
        escrow = _escrow;
        usdc   = _usdc;

        lead   = makeAddr("h_lead");
        client = makeAddr("h_client");
        crew   = new address[](2);
        crew[0] = makeAddr("h_crew0");
        crew[1] = makeAddr("h_crew1");

        knownAddresses.push(lead);
        knownAddresses.push(client);
        knownAddresses.push(crew[0]);
        knownAddresses.push(crew[1]);

        // Seed client with enough USDC
        usdc.mint(client, 1_000_000e6);
        vm.prank(client);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function createAndFund(uint256 deliverySeed) external {
        uint256 deliveryWindow = bound(deliverySeed, 1 days, 30 days);
        address[] memory payees = new address[](2);
        payees[0] = crew[0];
        payees[1] = crew[1];
        uint256[] memory bps = new uint256[](2);
        bps[0] = 5000;
        bps[1] = 5000;

        vm.prank(lead);
        uint256 id = escrow.create(client, FIXED_AMOUNT, deliveryWindow, 1 days, 1 days, 2 days, payees, bps);

        vm.prank(client);
        escrow.fund(id);

        activeMilestones.push(id);
    }

    function submitMilestone(uint256 idxSeed) external {
        if (activeMilestones.length == 0) return;
        uint256 idx = idxSeed % activeMilestones.length;
        uint256 id  = activeMilestones[idx];

        (,,,,,,,uint256 dl,,, MilestoneEscrow.State st,) = escrow.getMilestone(id);
        if (st != MilestoneEscrow.State.InProgress) return;

        // Ensure within deadline + grace
        if (block.timestamp > dl + 1 days) return;

        vm.prank(lead);
        try escrow.submit(id) {} catch {}
    }

    function approveMilestone(uint256 idxSeed) external {
        if (activeMilestones.length == 0) return;
        uint256 idx = idxSeed % activeMilestones.length;
        uint256 id  = activeMilestones[idx];

        (,,,,,,,,,,MilestoneEscrow.State st,) = escrow.getMilestone(id);
        if (st != MilestoneEscrow.State.UnderReview) return;

        vm.prank(client);
        try escrow.approve(id) {} catch {}
    }

    function timeoutSettle(uint256 idxSeed, uint256 warpSeed) external {
        if (activeMilestones.length == 0) return;
        uint256 idx = idxSeed % activeMilestones.length;
        uint256 id  = activeMilestones[idx];

        (,,,,,,,uint256 dl,,, MilestoneEscrow.State st,) = escrow.getMilestone(id);
        if (st == MilestoneEscrow.State.InProgress) {
            uint256 target = dl + 1 days + 1; // past grace
            if (block.timestamp < target) {
                vm.warp(bound(warpSeed, target, target + 7 days));
            }
            try escrow.settle(id) {} catch {}
        }
    }
}

contract MilestoneEscrowInvariantTest is Test {
    address internal constant USDC_ADDR = 0x3600000000000000000000000000000000000000;

    MilestoneEscrow internal escrow;
    MockERC20       internal usdc;
    EscrowHandler   internal handler;

    // Store handler actor addresses at setup so the invariant view fn doesn't need makeAddr
    address internal h_lead;
    address internal h_client;
    address internal h_crew0;
    address internal h_crew1;

    function setUp() public {
        vm.chainId(5042002);

        MockERC20 mock = new MockERC20("Mock USDC", "mUSDC", 6);
        vm.etch(USDC_ADDR, address(mock).code);
        usdc = MockERC20(USDC_ADDR);

        escrow  = new MilestoneEscrow();
        handler = new EscrowHandler(escrow, usdc);

        // Cache handler addresses for use in the view invariant
        h_lead   = makeAddr("h_lead");
        h_client = makeAddr("h_client");
        h_crew0  = makeAddr("h_crew0");
        h_crew1  = makeAddr("h_crew1");

        targetContract(address(handler));
    }

    /**
     * @notice Invariant: escrow's USDC balance == sum of active milestone amounts + sum of pendingWithdrawals.
     */
    function invariant_balanceMatchesPending() external view {
        uint256 escrowBalance = usdc.balanceOf(address(escrow));

        // Sum active milestone amounts
        uint256 activeSum;
        uint256 count = escrow.milestoneCount();
        for (uint256 id = 0; id < count; id++) {
            (,, uint256 amount,,,,,,,, MilestoneEscrow.State st,) = escrow.getMilestone(id);
            if (
                st == MilestoneEscrow.State.InProgress ||
                st == MilestoneEscrow.State.UnderReview ||
                st == MilestoneEscrow.State.Disputed
            ) {
                activeSum += amount;
            }
        }

        // Sum pending withdrawals for all known handler addresses
        uint256 pendingSum;
        pendingSum += escrow.pendingWithdrawals(h_lead);
        pendingSum += escrow.pendingWithdrawals(h_client);
        pendingSum += escrow.pendingWithdrawals(h_crew0);
        pendingSum += escrow.pendingWithdrawals(h_crew1);

        assertEq(escrowBalance, activeSum + pendingSum, "invariant: balance == active + pending");
    }
}
