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
    if (process.env.FLASHBOTS_DRY_RUN === 'true') {
      console.log(`[MEV Relayer] DRY RUN: Simulated private transaction bundle submission to ${this.flashbotsRelayUrl} for block ${bundle.targetBlock}...`);
      return {
        success: true,
        bundleHash: ethers.keccak256(bundle.signedBundle[0]),
        targetBlock: bundle.targetBlock,
      };
    }

    console.log(`[MEV Relayer] Submitting private transaction bundle to ${this.flashbotsRelayUrl} for block ${bundle.targetBlock}...`);

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendBundle',
      params: [
        {
          txs: bundle.signedBundle,
          blockNumber: `0x${bundle.targetBlock.toString(16)}`,
          version: process.env.FLASHBOTS_BUNDLE_VERSION || 'v3',
        }
      ]
    };

    const payloadString = JSON.stringify(payload);
    const signature = await this.wallet.signMessage(ethers.id(payloadString));
    const authHeader = `${this.wallet.address}:${signature}`;

    try {
      const response = await axios.post(
        this.flashbotsRelayUrl,
        payloadString,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Flashbots-Signature': authHeader,
          }
        }
      );

      if (response.data.error) {
        throw new Error(response.data.error.message || 'Flashbots relay error');
      }

      return {
        success: true,
        bundleHash: response.data.result?.bundleHash || ethers.keccak256(bundle.signedBundle[0]),
        targetBlock: bundle.targetBlock,
      };
    } catch (error) {
      console.error('[MEV Relayer] Failed to send private bundle:', error.message);
      throw error;
    }
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
