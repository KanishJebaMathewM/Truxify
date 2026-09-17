import { ethers } from 'ethers';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { eventBus } from '../../core/events.js';
import { BaseEvent } from '../../core/events/BaseEvent.js';
import logger from '../../middleware/logger.js';

export class BundleExecutedEvent extends BaseEvent {
  constructor(payload = {}, options = {}) {
    super({
      eventType: 'BundleExecuted',
      payload,
      source: 'FlashbotsRelay',
      ...options,
    });
  }
}

export class FlashbotsRelay {
  constructor(providerUrl, relayerPrivateKey, options = {}) {
    this.providerUrl = providerUrl || process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    this.relayerPrivateKey = relayerPrivateKey || process.env.RELAYER_WALLET_PRIVATE_KEY;
    this.flashbotsRelayUrl = options.flashbotsRelayUrl || process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net';
    this.bundleResults = options.bundleResults || [];
    this._provider = null;
    this._wallet = null;
  }

  get provider() {
    if (!this._provider && this.providerUrl) {
      this._provider = new ethers.JsonRpcProvider(this.providerUrl);
    }
    return this._provider;
  }

  get wallet() {
    if (!this._wallet && this.relayerPrivateKey) {
      this._wallet = new ethers.Wallet(this.relayerPrivateKey, this.provider);
    }
    return this._wallet;
  }

  async persistBundleResults(bundleResult) {
    const client = supabaseAdmin || supabase;
    if (!client) {
      logger.warn('[FlashbotsRelay] Database client unavailable, skipping bundle result persistence');
      return null;
    }

    try {
      const record = {
        bundle_hash: bundleResult.bundleHash,
        target_block: bundleResult.targetBlock,
        txs: bundleResult.txs || [],
        status: bundleResult.status || 'submitted',
        result: bundleResult.rawPayload || bundleResult,
        submitted_at: bundleResult.submittedAt || new Date().toISOString(),
      };

      const { data, error } = await client
        .from('flashbots_submissions')
        .insert([record])
        .select()
        .maybeSingle();

      if (error) {
        logger.warn(
          { error: error.message },
          '[FlashbotsRelay] Failed to insert into flashbots_submissions, attempting fallback to flashbots_bundles'
        );
        const fallbackRecord = {
          bundle_id: bundleResult.bundleHash,
          block_number: bundleResult.targetBlock,
          submitted_at: bundleResult.submittedAt || new Date().toISOString(),
        };
        const { error: fallbackError } = await client
          .from('flashbots_bundles')
          .insert([fallbackRecord]);

        if (fallbackError) {
          logger.error(
            { error: fallbackError.message },
            '[FlashbotsRelay] Failed to persist bundle results to database'
          );
        }
      }

      return data;
    } catch (err) {
      logger.error(
        { err: err.message },
        '[FlashbotsRelay] Error persisting bundleResults to database'
      );
      return null;
    }
  }

  emitBundleExecuted(bundleResult) {
    try {
      const event = new BundleExecutedEvent(bundleResult);
      if (eventBus && typeof eventBus.emitSafe === 'function') {
        eventBus.emitSafe('BundleExecuted', event);
        eventBus.emitSafe('bundle.executed', event);
      } else if (eventBus && typeof eventBus.publish === 'function') {
        eventBus.publish('BundleExecuted', event);
      }
      return event;
    } catch (err) {
      logger.error(
        { err: err.message },
        '[FlashbotsRelay] Error emitting BundleExecuted event'
      );
      return null;
    }
  }

  async sendPrivateBundle(bundle) {
    if (!bundle || !bundle.signedBundle || !bundle.targetBlock) {
      throw new Error('Invalid bundle parameter: signedBundle and targetBlock are required');
    }

    const blockHex = '0x' + BigInt(bundle.targetBlock).toString(16);
    logger.info(
      `[FlashbotsRelay] Submitting private transaction bundle to ${this.flashbotsRelayUrl} for block ${bundle.targetBlock}...`
    );

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

    const bundleResult = {
      success: true,
      bundleHash: payload.result,
      targetBlock: bundle.targetBlock,
      txs: bundle.signedBundle,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      rawPayload: payload,
    };

    this.bundleResults.push(bundleResult);
    await this.persistBundleResults(bundleResult);
    this.emitBundleExecuted(bundleResult);

    return bundleResult;
  }
}

export const flashbotsRelay = new FlashbotsRelay();
export default flashbotsRelay;
