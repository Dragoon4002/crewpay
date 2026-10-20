# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

CrewPay — Two-party (lead + client) USDC milestone escrow. No arbiter. Full dispute resolution via concede, negotiated split, or timeout. Push-first payouts with per-recipient fallback to pendingWithdrawals.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Hash router (Home / Create / Milestone pages)
- `src/lib/contract.ts` - Contract address per chain, ABI import, explorer helpers
- `src/lib/types.ts` - TypeScript mirrors of Solidity enums + display metadata
- `src/lib/format.ts` - USDC formatting, address shortening, countdown, bps helpers
- `src/hooks/useMilestone.ts` - Single milestone reader (getMilestone + getMilestoneExtra + status)
- `src/hooks/useMilestoneList.ts` - Scans MilestoneCreated logs + batch state reads for connected wallet
- `src/pages/HomePage.tsx` - Milestone list with role badges + countdowns
- `src/pages/CreatePage.tsx` - Create form with payees table, presets, approve+create flow
- `src/pages/MilestonePage.tsx` - Terms card, role-aware action panel, all contract actions
- `src/components/Header.tsx` - Sticky header with network badge + contract explorer link
- `src/components/TxButton.tsx` - Shared CTA with pending/confirming states
- `src/config.ts` - wagmi config (chains, connectors, transports)

## Contract address config

Contract addresses live in `src/lib/contract.ts` — `MILESTONE_ESCROW_ADDRESS[chainId]`.
To add Arc Mainnet: set `MILESTONE_ESCROW_ADDRESS[5042]` in that file after mainnet deploy.

## Deployed Contracts

| Contract | Network | Address | Explorer | Status |
|---|---|---|---|---|
| MilestoneEscrow v1 | Arc Testnet | 0xd63ecc878dba10540ce6427eaef18aa29b0e11c0 | https://explorer.testnet.arc.io/address/0xd63ecc878dba10540ce6427eaef18aa29b0e11c0 | superseded — do not use |
| MilestoneEscrow v3 | Arc Testnet | 0x6cd751bbc2d157ce0d8126636aa31cd937371049 | https://explorer.testnet.arc.io/address/0x6cd751bbc2d157ce0d8126636aa31cd937371049 | **current** |

v1 deploy tx: `0x7b0d8374a68a7c219d146cfbddd865529ab28ad6b94f10398380154c268a2d0f`
v3 deploy tx: `0x38602f8dd31b712d9ecc1ad955caa0a18a23d106a1930775215a44c990e55e43`

**Current source: v3 — deployed to Arc Testnet at `0x6cd751bbc2d157ce0d8126636aa31cd937371049`**

v3 is a full two-party redesign. Key changes vs v2:
- No arbiter. Two parties only: lead (creator/crew) and client (funder/approver).
- New state machine: Created → InProgress → UnderReview → Disputed → Settled | Cancelled
- Outcomes stored on settle: Approved, AutoApproved, ClientConceded, LeadConceded, SplitSettlement, Refunded, DisputeTimeout
- Four time windows: deliveryWindow, gracePeriod, reviewWindow, disputeWindow (all capped with WindowTooLong)
- Extension request/approve flow with front-run guard
- proposeSplit / acceptSplit negotiation with front-run guard (refundBps echo)
- Permissionless settle() for time-based outcomes
- All settlement via _settle(id, outcome, refundBps) — single internal path
- Push-with-fallback payouts preserved; getMilestone split into getMilestone + getMilestoneExtra to fit stack
- via_ir = true added to foundry.toml (enables Slither + avoids stack-too-deep in large functions)
- 57 Foundry tests passing (incl. invariant handler); balanced security review clean

## To Run

```bash
bun install
bun run dev
```
