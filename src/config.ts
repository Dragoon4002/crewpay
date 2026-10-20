/**
 * wagmi configuration — Arc Testnet + Arc Mainnet + Ethereum mainnet (ENS)
 * Built with Arc Studio — https://studio.arc.io
 */
import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { arcMainnet, ARC_TESTNET_CHAIN_ID, ARC_MAINNET_CHAIN_ID } from './lib/contract'

// Pre-register chain RPC URLs so trace events show correct chain names
registerChain(ARC_TESTNET_CHAIN_ID, 'https://rpc.testnet.arc.io')
registerChain(ARC_MAINNET_CHAIN_ID, 'https://rpc.mainnet.arc.io')

export const config = createConfig({
  chains: [arcTestnet, arcMainnet, mainnet],
  connectors: [injected()],
  transports: {
    [ARC_TESTNET_CHAIN_ID]: http('https://rpc.testnet.arc.io'),
    [ARC_MAINNET_CHAIN_ID]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(),
  },
})
