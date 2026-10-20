// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MilestoneEscrow
 * @notice Two-party USDC milestone escrow between a lead and a client.
 * @dev Uses push-with-fallback payouts: failed transfers are credited to pendingWithdrawals.
 *
 * State machine:
 *   Created ──cancel()──► Cancelled
 *   Created ──fund()────► InProgress ──submit()──► UnderReview ──approve()────────────────► Settled(Approved)
 *                                    │             │             └─dispute()──► Disputed ──concede(client)──► Settled(ClientConceded)
 *                                    │             │                         │             concede(lead)────► Settled(LeadConceded)
 *                                    │             │                         │             acceptSplit()───► Settled(SplitSettlement)
 *                                    │             │                         └─settle()───► Settled(DisputeTimeout)
 *                                    │             └─settle()────────────────────────────► Settled(AutoApproved)
 *                                    └─settle()────────────────────────────────────────► Settled(Refunded)
 */
contract MilestoneEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 private constant ARC_MAINNET_CHAIN_ID = 5042;
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    uint256 private constant MAX_DELIVERY_WINDOW = 365 days;
    uint256 private constant MAX_GRACE_PERIOD = 90 days;
    uint256 private constant MAX_REVIEW_WINDOW = 90 days;
    uint256 private constant MAX_DISPUTE_WINDOW = 90 days;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    enum State {
        Created,
        InProgress,
        UnderReview,
        Disputed,
        Settled,
        Cancelled
    }

    enum Outcome {
        None,
        Approved,
        AutoApproved,
        ClientConceded,
        LeadConceded,
        SplitSettlement,
        Refunded,
        DisputeTimeout
    }

    enum UIStatus {
        Created,
        InProgress,
        DeadlineMissed,
        RefundEligible,
        UnderReview,
        AutoApproveEligible,
        Disputed,
        DisputeTimeoutEligible,
        Settled,
        Cancelled
    }

    struct ExtensionRequest {
        uint256 newDeadline;
    }

    struct SplitProposal {
        address proposer;
        uint256 refundBps;
    }

    struct Milestone {
        address lead;
        address client;
        uint256 amount;
        uint256 deliveryWindow;
        uint256 gracePeriod;
        uint256 reviewWindow;
        uint256 disputeWindow;
        uint256 deadline;
        uint256 submittedAt;
        uint256 disputedAt;
        State state;
        Outcome outcome;
        address[] payees;
        uint256[] bps;
        ExtensionRequest pendingExtension;
        SplitProposal pendingSplit;
    }

    error WrongChain(uint256 actual);
    error USDCNotDeployed();
    error NotClient(uint256 id, address caller);
    error NotLead(uint256 id, address caller);
    error NotParty(uint256 id, address caller);
    error InvalidState(uint256 id, State current);
    error InvalidMilestone();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroWindow();
    error WindowTooLong(uint256 id, uint256 max);
    error EmptyPayees();
    error TooManyPayees();
    error LengthMismatch();
    error ZeroBPS();
    error InvalidBPS();
    error InvalidPayee();
    error DeadlineNotMissed();
    error ReviewNotExpired();
    error DisputeWindowNotExpired();
    error NotSettleable();
    error StaleSplitProposal();
    error StaleExtensionRequest();
    error SelfAccept();
    error NoPendingProposal();
    error NoPendingExtension();
    error DeadlinePassed();
    error ExtensionDeadlineTooLate();
    error ExtensionDeadlineTooEarly();
    error ReviewWindowExpired(uint256 id);
    error NothingToWithdraw();

    event MilestoneCreated(
        uint256 indexed id,
        address indexed lead,
        address indexed client,
        uint256 amount,
        uint256 deliveryWindow,
        uint256 gracePeriod,
        uint256 reviewWindow,
        uint256 disputeWindow,
        address[] payees,
        uint256[] bps
    );
    event Funded(uint256 indexed id, uint256 deadline);
    event Submitted(uint256 indexed id, uint256 submittedAt);
    event Approved(uint256 indexed id);
    event Disputed(uint256 indexed id, string reason);
    event ExtensionRequested(uint256 indexed id, address indexed requester, uint256 newDeadline);
    event ExtensionApproved(uint256 indexed id, uint256 newDeadline);
    event Conceded(uint256 indexed id, address indexed conceder);
    event SplitProposed(uint256 indexed id, address indexed proposer, uint256 refundBps);
    event SplitAccepted(uint256 indexed id, uint256 refundBps);
    event Settled(uint256 indexed id, Outcome outcome, uint256 clientPart, uint256 crewPart);
    event PayeePaid(uint256 indexed id, address indexed payee, uint256 amount);
    event PayoutDeferred(uint256 indexed id, address indexed recipient, uint256 amount);
    event Cancelled(uint256 indexed id);
    event Withdrawn(address indexed recipient, uint256 amount);

    mapping(uint256 => Milestone) private _milestones;
    uint256 private _milestoneCount;
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Validate allowed Arc chain IDs and ensure the hardcoded USDC address is a deployed contract.
    constructor() {
        uint256 cid = block.chainid;
        if (cid != ARC_TESTNET_CHAIN_ID && cid != ARC_MAINNET_CHAIN_ID) revert WrongChain(cid);
        if (USDC.code.length == 0) revert USDCNotDeployed();
    }

    /**
     * @notice Create a new milestone escrow.
     * @param client Client that funds, approves, disputes, and receives refunds.
     * @param amount Total USDC escrow amount.
     * @param deliveryWindow Time from fund() until delivery deadline.
     * @param gracePeriod Extra time after deadline where submit() is still allowed.
     * @param reviewWindow Time from submit() until auto-approval eligibility.
     * @param disputeWindow Time from dispute() until dispute-timeout eligibility.
     * @param payees Crew recipients for crew-side payouts.
     * @param bps Basis-point split for payees. Must sum to 10_000.
     */
    function create(
        address client,
        uint256 amount,
        uint256 deliveryWindow,
        uint256 gracePeriod,
        uint256 reviewWindow,
        uint256 disputeWindow,
        address[] calldata payees,
        uint256[] calldata bps
    ) external returns (uint256 id) {
        if (client == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        if (deliveryWindow == 0) revert ZeroWindow();
        if (deliveryWindow > MAX_DELIVERY_WINDOW) revert WindowTooLong(0, MAX_DELIVERY_WINDOW);

        if (gracePeriod > MAX_GRACE_PERIOD) revert WindowTooLong(0, MAX_GRACE_PERIOD);

        if (reviewWindow == 0) revert ZeroWindow();
        if (reviewWindow > MAX_REVIEW_WINDOW) revert WindowTooLong(0, MAX_REVIEW_WINDOW);

        if (disputeWindow == 0) revert ZeroWindow();
        if (disputeWindow > MAX_DISPUTE_WINDOW) revert WindowTooLong(0, MAX_DISPUTE_WINDOW);

        uint256 payeesLength = payees.length;
        if (payeesLength == 0) revert EmptyPayees();
        if (payeesLength > 20) revert TooManyPayees();
        if (payeesLength != bps.length) revert LengthMismatch();

        uint256 totalBps;
        for (uint256 i = 0; i < payeesLength; ++i) {
            address payee = payees[i];
            if (payee == address(0)) revert ZeroAddress();
            if (payee == address(this) || payee == USDC) revert InvalidPayee();
            uint256 share = bps[i];
            if (share == 0) revert ZeroBPS();
            totalBps += share;
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidBPS();

        id = _milestoneCount;
        _milestoneCount = id + 1;

        Milestone storage m = _milestones[id];
        m.lead = msg.sender;
        m.client = client;
        m.amount = amount;
        m.deliveryWindow = deliveryWindow;
        m.gracePeriod = gracePeriod;
        m.reviewWindow = reviewWindow;
        m.disputeWindow = disputeWindow;
        m.deadline = 0;
        m.submittedAt = 0;
        m.disputedAt = 0;
        m.state = State.Created;
        m.outcome = Outcome.None;
        m.payees = payees;
        m.bps = bps;

        emit MilestoneCreated(
            id,
            msg.sender,
            client,
            amount,
            deliveryWindow,
            gracePeriod,
            reviewWindow,
            disputeWindow,
            payees,
            bps
        );
    }

    /**
     * @notice Cancel an unfunded milestone.
     * @param id Milestone id.
     */
    function cancel(uint256 id) external {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.lead) revert NotLead(id, msg.sender);
        if (m.state != State.Created) revert InvalidState(id, m.state);

        m.state = State.Cancelled;
        emit Cancelled(id);
    }

    /**
     * @notice Fund a created milestone and start the delivery timer.
     * @param id Milestone id.
     */
    function fund(uint256 id) external nonReentrant {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.client) revert NotClient(id, msg.sender);
        if (m.state != State.Created) revert InvalidState(id, m.state);

        m.state = State.InProgress;
        m.deadline = block.timestamp + m.deliveryWindow;

        IERC20(USDC).safeTransferFrom(msg.sender, address(this), m.amount);

        emit Funded(id, m.deadline);
    }

    /**
     * @notice Lead requests a new delivery deadline while milestone is in progress.
     * @param id Milestone id.
     * @param newDeadline Proposed new absolute deadline timestamp.
     */
    function requestExtension(uint256 id, uint256 newDeadline) external {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.lead) revert NotLead(id, msg.sender);
        if (m.state != State.InProgress) revert InvalidState(id, m.state);
        if (newDeadline <= m.deadline) revert ExtensionDeadlineTooEarly();
        if (newDeadline > block.timestamp + MAX_DELIVERY_WINDOW) revert ExtensionDeadlineTooLate();

        m.pendingExtension.newDeadline = newDeadline;
        emit ExtensionRequested(id, msg.sender, newDeadline);
    }

    /**
     * @notice Client approves the exact pending extension request.
     * @param id Milestone id.
     * @param newDeadline The exact pending value to accept.
     */
    function approveExtension(uint256 id, uint256 newDeadline) external {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.client) revert NotClient(id, msg.sender);
        if (m.state != State.InProgress) revert InvalidState(id, m.state);
        if (m.pendingExtension.newDeadline == 0) revert NoPendingExtension();
        if (newDeadline != m.pendingExtension.newDeadline) revert StaleExtensionRequest();

        m.deadline = newDeadline;
        m.pendingExtension.newDeadline = 0;
        emit ExtensionApproved(id, newDeadline);
    }

    /**
     * @notice Lead submits delivery for client review.
     * @param id Milestone id.
     */
    function submit(uint256 id) external {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.lead) revert NotLead(id, msg.sender);
        if (m.state != State.InProgress) revert InvalidState(id, m.state);
        if (block.timestamp > m.deadline + m.gracePeriod) revert DeadlinePassed();

        m.submittedAt = block.timestamp;
        m.state = State.UnderReview;
        m.pendingExtension.newDeadline = 0;

        emit Submitted(id, m.submittedAt);
    }

    /**
     * @notice Client approves submitted work and settles to crew payees.
     * @param id Milestone id.
     */
    function approve(uint256 id) external nonReentrant {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.client) revert NotClient(id, msg.sender);
        if (m.state != State.UnderReview) revert InvalidState(id, m.state);

        emit Approved(id);
        _settle(id, Outcome.Approved, 0);
    }

    /**
     * @notice Client disputes submitted work during the review window.
     * @param id Milestone id.
     * @param reason Human-readable reason emitted in event logs only.
     */
    function dispute(uint256 id, string calldata reason) external {
        Milestone storage m = _getMilestone(id);
        if (msg.sender != m.client) revert NotClient(id, msg.sender);
        if (m.state != State.UnderReview) revert InvalidState(id, m.state);
        if (block.timestamp >= m.submittedAt + m.reviewWindow) revert ReviewWindowExpired(id);

        m.disputedAt = block.timestamp;
        m.state = State.Disputed;
        emit Disputed(id, reason);
    }

    /**
     * @notice Either party may concede an active dispute.
     * @param id Milestone id.
     */
    function concede(uint256 id) external nonReentrant {
        Milestone storage m = _getMilestone(id);
        if (m.state != State.Disputed) revert InvalidState(id, m.state);

        if (msg.sender == m.client) {
            emit Conceded(id, msg.sender);
            _settle(id, Outcome.ClientConceded, 0);
            return;
        }

        if (msg.sender == m.lead) {
            emit Conceded(id, msg.sender);
            _settle(id, Outcome.LeadConceded, BPS_DENOMINATOR);
            return;
        }

        revert NotParty(id, msg.sender);
    }

    /**
     * @notice Propose a refund split while disputed.
     * @param id Milestone id.
     * @param refundBps Basis points refunded to client (remainder to crew).
     */
    function proposeSplit(uint256 id, uint256 refundBps) external {
        Milestone storage m = _getMilestone(id);
        if (m.state != State.Disputed) revert InvalidState(id, m.state);
        if (msg.sender != m.client && msg.sender != m.lead) revert NotParty(id, msg.sender);
        if (refundBps > BPS_DENOMINATOR) revert InvalidBPS();

        m.pendingSplit = SplitProposal({proposer: msg.sender, refundBps: refundBps});
        emit SplitProposed(id, msg.sender, refundBps);
    }

    /**
     * @notice Accept the exact pending split proposal from the counterparty and settle.
     * @param id Milestone id.
     * @param refundBps Exact pending refund bps for stale-proposal protection.
     */
    function acceptSplit(uint256 id, uint256 refundBps) external nonReentrant {
        Milestone storage m = _getMilestone(id);
        if (m.state != State.Disputed) revert InvalidState(id, m.state);
        if (msg.sender != m.client && msg.sender != m.lead) revert NotParty(id, msg.sender);

        SplitProposal memory pending = m.pendingSplit;
        if (pending.proposer == address(0)) revert NoPendingProposal();
        if (msg.sender == pending.proposer) revert SelfAccept();
        if (refundBps != pending.refundBps) revert StaleSplitProposal();

        emit SplitAccepted(id, refundBps);
        _settle(id, Outcome.SplitSettlement, refundBps);
    }

    /**
     * @notice Permissionless time-based settlement for refundable, auto-approvable, or timeout-disputed milestones.
     * @param id Milestone id.
     */
    function settle(uint256 id) external nonReentrant {
        Milestone storage m = _getMilestone(id);

        if (m.state == State.InProgress && block.timestamp > m.deadline + m.gracePeriod) {
            _settle(id, Outcome.Refunded, BPS_DENOMINATOR);
            return;
        }

        if (m.state == State.UnderReview && block.timestamp >= m.submittedAt + m.reviewWindow) {
            _settle(id, Outcome.AutoApproved, 0);
            return;
        }

        if (m.state == State.Disputed && block.timestamp >= m.disputedAt + m.disputeWindow) {
            _settle(id, Outcome.DisputeTimeout, 5_000);
            return;
        }

        revert NotSettleable();
    }

    /**
     * @notice Withdraw previously deferred payouts.
     */
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        IERC20(USDC).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Return core milestone fields.
     * @dev Split from getMilestoneExtra to keep each tuple under the non-optimized stack limit.
     */
    function getMilestone(uint256 id)
        external
        view
        returns (
            address lead,
            address client,
            uint256 amount,
            uint256 deliveryWindow,
            uint256 gracePeriod,
            uint256 reviewWindow,
            uint256 disputeWindow,
            uint256 deadline,
            uint256 submittedAt,
            uint256 disputedAt,
            State state,
            Outcome outcome
        )
    {
        Milestone storage m = _getMilestone(id);
        return (
            m.lead,
            m.client,
            m.amount,
            m.deliveryWindow,
            m.gracePeriod,
            m.reviewWindow,
            m.disputeWindow,
            m.deadline,
            m.submittedAt,
            m.disputedAt,
            m.state,
            m.outcome
        );
    }

    /**
     * @notice Return payees, bps, and pending action state for a milestone.
     * @dev Companion to getMilestone(); call both to get the full picture.
     */
    function getMilestoneExtra(uint256 id)
        external
        view
        returns (
            address[] memory payees,
            uint256[] memory bps,
            uint256 pendingExtensionDeadline,
            address pendingSplitProposer,
            uint256 pendingSplitRefundBps
        )
    {
        Milestone storage m = _getMilestone(id);
        return (
            m.payees,
            m.bps,
            m.pendingExtension.newDeadline,
            m.pendingSplit.proposer,
            m.pendingSplit.refundBps
        );
    }

    /**
     * @notice Return a UI-oriented status and the most relevant deadline.
     * @param id Milestone id.
     */
    function status(uint256 id) external view returns (UIStatus uiStatus, uint256 relevantDeadline) {
        Milestone storage m = _getMilestone(id);

        if (m.state == State.Cancelled) return (UIStatus.Cancelled, 0);
        if (m.state == State.Settled) return (UIStatus.Settled, 0);
        if (m.state == State.Created) return (UIStatus.Created, 0);

        if (m.state == State.InProgress) {
            uint256 graceDeadline = m.deadline + m.gracePeriod;
            if (block.timestamp > graceDeadline) return (UIStatus.RefundEligible, graceDeadline);
            if (block.timestamp > m.deadline) return (UIStatus.DeadlineMissed, m.deadline);
            return (UIStatus.InProgress, m.deadline);
        }

        if (m.state == State.UnderReview) {
            uint256 reviewDeadline = m.submittedAt + m.reviewWindow;
            if (block.timestamp >= reviewDeadline) return (UIStatus.AutoApproveEligible, reviewDeadline);
            return (UIStatus.UnderReview, reviewDeadline);
        }

        uint256 disputeDeadline = m.disputedAt + m.disputeWindow;
        if (block.timestamp >= disputeDeadline) return (UIStatus.DisputeTimeoutEligible, disputeDeadline);
        return (UIStatus.Disputed, disputeDeadline);
    }

    /**
     * @notice Return the number of created milestones.
     */
    function milestoneCount() external view returns (uint256) {
        return _milestoneCount;
    }

    function _settle(uint256 id, Outcome outcome, uint256 refundBps) internal {
        Milestone storage m = _milestones[id];

        m.state = State.Settled;
        m.outcome = outcome;
        delete m.pendingSplit;

        uint256 clientPart = (m.amount * refundBps) / BPS_DENOMINATOR;
        uint256 crewPart = m.amount - clientPart;

        emit Settled(id, outcome, clientPart, crewPart);

        if (clientPart > 0) {
            _disperseOne(id, m.client, clientPart);
        }
        if (crewPart > 0) {
            _dispersePayees(id, m, crewPart);
        }
    }

    function _disperseOne(uint256 id, address recipient, uint256 amt) internal {
        bool ok = _tryTransfer(recipient, amt);
        if (!ok) {
            pendingWithdrawals[recipient] += amt;
            emit PayoutDeferred(id, recipient, amt);
        }
    }

    function _dispersePayees(uint256 id, Milestone storage m, uint256 total) internal {
        uint256 runningPaid;
        uint256 payeesLength = m.payees.length;

        for (uint256 i = 0; i < payeesLength; ++i) {
            uint256 payeeAmt;
            if (i == payeesLength - 1) {
                payeeAmt = total - runningPaid;
            } else {
                payeeAmt = (total * m.bps[i]) / BPS_DENOMINATOR;
                runningPaid += payeeAmt;
            }

            bool ok = _tryTransfer(m.payees[i], payeeAmt);
            if (ok) {
                emit PayeePaid(id, m.payees[i], payeeAmt);
            } else {
                pendingWithdrawals[m.payees[i]] += payeeAmt;
                emit PayoutDeferred(id, m.payees[i], payeeAmt);
            }
        }
    }

    function _tryTransfer(address to, uint256 amt) internal returns (bool) {
        (bool callSuccess, bytes memory ret) = USDC.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amt));
        if (!callSuccess) return false;
        if (ret.length == 0) return true;
        if (ret.length == 32) return abi.decode(ret, (bool));
        return false;
    }

    function _getMilestone(uint256 id) internal view returns (Milestone storage m) {
        if (id >= _milestoneCount) revert InvalidMilestone();
        m = _milestones[id];
    }
}
