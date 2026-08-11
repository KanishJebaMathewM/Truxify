import { ethers } from 'ethers';
import axios from 'axios';

/**
 * Flashbots / Fastlane Relayer Integration for MEV-Protected Escrow Bundles
 *
 * The module is importable without a relayer key; the relayer is created lazily
 * by getMevRelayer() so services that only need a public-transaction fallback
 * never crash on import when RELAYER_WALLET_PRIVATE_KEY is unset.
 */
export class FlashbotsRelayerService {
  constructor(providerUrl, relayerPrivateKey) {
    this.provider = new ethers.JsonRpcProvider(providerUrl);
    this.wallet = new ethers.Wallet(relayerPrivateKey, this.provider);
    this.flashbotsRelayUrl = process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
  }

  async assemblePrivateBundle(targetContractAddress, abi, functionName, args, targetBlock) {
    const contract = new ethers.Contract(targetContractAddress, abi, this.wallet);
    const txData = contract.interface.encodeFunctionData(functionName, args);

    const transaction = {
      to: targetContractAddress,
      data: txData,
      gasLimit: 300000n,
      maxFeePerGas: ethers.parseUnits('50', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('3', 'gwei'),
      chainId: 137, // Polygon Mainnet
    };

    const signedTx = await this.wallet.signTransaction(transaction);
    return {
      signedBundle: [signedTx],
      targetBlock,
    };
  }

  async sendPrivateBundle(bundle) {
    const params = {
      txs: bundle.signedBundle,
      blockNumber: `0x${BigInt(bundle.targetBlock).toString(16)}`,
      version: process.env.FLASHBOTS_BUNDLE_VERSION || 'v3',
    };

    const response = await axios.post(
      this.flashbotsRelayUrl,
      {
        jsonrpc: '2.0',
        method: 'eth_sendBundle',
        params: [params],
        id: 1,
      },
      { timeout: 30000 }
    );

    if (response.data?.error) {
      const message =
        response.data.error.message ||
        JSON.stringify(response.data.error);
      throw new Error(`Flashbots bundle rejected: ${message}`);
    }

    return {
      success: true,
      bundleHash: response.data?.result || null,
      targetBlock: bundle.targetBlock,
      relayUrl: this.flashbotsRelayUrl,
    };
  }
}

function resolveRelayerPrivateKey() {
  return process.env.RELAYER_WALLET_PRIVATE_KEY || null;
}

let cachedMevRelayer = null;

export function getMevRelayer() {
  const relayerPrivateKey = resolveRelayerPrivateKey();
  if (!relayerPrivateKey) {
    throw new Error('RELAYER_WALLET_PRIVATE_KEY environment variable is required to use the Flashbots relayer');
  }
  if (!cachedMevRelayer) {
    cachedMevRelayer = new FlashbotsRelayerService(
      process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      relayerPrivateKey
    );
  }
  return cachedMevRelayer;
}
