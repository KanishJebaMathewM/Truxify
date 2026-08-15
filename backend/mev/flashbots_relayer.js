import { ethers } from 'ethers';

/**
 * Flashbots / Fastlane Relayer Integration for MEV-Protected Escrow Bundles
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
    const blockHex = '0x' + BigInt(bundle.targetBlock).toString(16);
    console.log(`[MEV Relayer] Submitting private transaction bundle to ${this.flashbotsRelayUrl} for block ${bundle.targetBlock}...`);

    const response = await fetch(this.flashbotsRelayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_sendBundle',
        params: [{
          txs: bundle.signedBundle,
          blockNumber: blockHex,
        }],
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (payload.error) {
      throw new Error(`Flashbots relay rejected bundle: ${payload.error.message || JSON.stringify(payload.error)}`);
    }
    if (!payload.result) {
      throw new Error('Flashbots relay returned no bundle hash');
    }

    return {
      success: true,
      bundleHash: payload.result,
      targetBlock: bundle.targetBlock,
    };
  }
}

export function getMevRelayer() {
  return mevRelayer;
}

const relayerPrivateKey = process.env.RELAYER_WALLET_PRIVATE_KEY;
if (!relayerPrivateKey) {
  throw new Error('RELAYER_WALLET_PRIVATE_KEY environment variable is required');
}

export const mevRelayer = new FlashbotsRelayerService(
  process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
  relayerPrivateKey
);
