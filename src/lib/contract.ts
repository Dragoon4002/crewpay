/**
 * MilestoneEscrow contract config.
 * One place to update addresses, RPCs, and explorer URLs per chain.
 */
import type { Chain } from 'viem'
import { arcTestnet } from 'viem/chains'
import { defineChain } from 'viem'
import artifact from '../../contracts/out/MilestoneEscrow.sol/MilestoneEscrow.json'

export const ARC_TESTNET_CHAIN_ID = arcTestnet.id  // 5042002
export const ARC_MAINNET_CHAIN_ID = 5042 as const

/** Arc Mainnet — defineChain since viem/chains may not export it yet */
export const arcMainnet: Chain = defineChain({
  id: ARC_MAINNET_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
  testnet: false,
})

/** Contract addresses per chain */
export const MILESTONE_ESCROW_ADDRESS: Partial<Record<number, `0x${string}`>> = {
  [ARC_TESTNET_CHAIN_ID]: '0x6cd751bbc2d157ce0d8126636aa31cd937371049',
  [ARC_MAINNET_CHAIN_ID]: '0x39b8dc168654F3E58b9B8C06a667b9D351995a6C',
}

/**
 * Block numbers to scan from per chain.
 * Testnet: MilestoneEscrow v3 deploy block.
 * Mainnet: MilestoneEscrow deploy block.
 */
export const DEPLOY_BLOCK: Partial<Record<number, bigint>> = {
  [ARC_TESTNET_CHAIN_ID]: 67893722n,
  [ARC_MAINNET_CHAIN_ID]: 26964941n,
}

export const MILESTONE_ESCROW_ABI = artifact.abi

/** USDC on Arc (6 decimals, same address on testnet and mainnet). */
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6

/** Chain IDs that have a deployed contract address */
export const SUPPORTED_CHAIN_IDS = (
  Object.entries(MILESTONE_ESCROW_ADDRESS)
    .filter(([, v]) => !!v)
    .map(([k]) => Number(k))
)

export function getContractAddress(chainId: number | undefined): `0x${string}` | undefined {
  if (!chainId) return undefined
  return MILESTONE_ESCROW_ADDRESS[chainId]
}

export function isSupported(chainId: number | undefined): boolean {
  if (!chainId) return false
  return !!MILESTONE_ESCROW_ADDRESS[chainId]
}

export function getExplorerBase(chainId: number | undefined): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'https://explorer.arc.io'
  return 'https://explorer.testnet.arc.io'
}

export function getRpcUrl(chainId: number | undefined): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'https://rpc.mainnet.arc.io'
  return 'https://rpc.testnet.arc.io'
}

export function getTxUrl(chainId: number | undefined, hash: string): string {
  return `${getExplorerBase(chainId)}/tx/${hash}`
}

export function getAddressUrl(chainId: number | undefined, address: string): string {
  return `${getExplorerBase(chainId)}/address/${address}`
}

export function getChainName(chainId: number | undefined): string {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'Arc Mainnet'
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'Arc Testnet'
  return chainId ? `Chain ${chainId}` : 'Unknown'
}

/** Build a share link: /#/m/<chainId>/<id> */
export function buildShareLink(chainId: number, id: bigint): string {
  return `${window.location.origin}${window.location.pathname}#/m/${chainId}/${id}`
}

/** Explorer URL of the deployed contract per chain */
export const CONTRACT_EXPLORER_URL: Partial<Record<number, string>> = {
  [ARC_TESTNET_CHAIN_ID]: getAddressUrl(ARC_TESTNET_CHAIN_ID, MILESTONE_ESCROW_ADDRESS[ARC_TESTNET_CHAIN_ID] ?? ''),
  [ARC_MAINNET_CHAIN_ID]: getAddressUrl(ARC_MAINNET_CHAIN_ID, MILESTONE_ESCROW_ADDRESS[ARC_MAINNET_CHAIN_ID] ?? ''),
}

/** Default chain for new milestones and legacy share links */
export const DEFAULT_CHAIN_ID = ARC_MAINNET_CHAIN_ID
