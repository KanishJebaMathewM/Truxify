import { ethers } from 'ethers';

class DaoService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.dao = null;
    this._initialized = false;
  }

  /**
   * Lazy-initializes ethers provider, wallet, and contract instance.
   * Prevents module import failure when env vars are missing.
   */
  _init() {
    if (this._initialized) return;

    const privateKey = process.env.PRIVATE_KEY || process.env.RELAYER_WALLET_PRIVATE_KEY;
    const contractAddress = process.env.DAO_CONTRACT_ADDRESS;
    const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_PROVIDER;

    if (!privateKey || !contractAddress) {
      console.warn(
        '[DaoService] Warning: PRIVATE_KEY (or RELAYER_WALLET_PRIVATE_KEY) or DAO_CONTRACT_ADDRESS is missing. ' +
        'DAO operations will be unavailable.'
      );
      this._initialized = true;
      return;
    }

    try {
      this.provider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : ethers.getDefaultProvider();
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      this.dao = new ethers.Contract(contractAddress, DAO_ABI, this.wallet);
    } catch (error) {
      console.error('[DaoService] Failed to initialize DAO contract/wallet client:', error.message);
    }

    this._initialized = true;
  }

  /**
   * Helper to ensure service is initialized and configured before handling requests.
   */
  _ensureConfigured() {
    this._init();
    if (!this.dao || !this.wallet) {
      throw new Error('DAO service is unconfigured. Please check environment variables (PRIVATE_KEY, DAO_CONTRACT_ADDRESS).');
    }
  }

  async submitProposal(...args) {
    this._ensureConfigured();
    return await this.dao.submitProposal(...args);
  }
}

export default new DaoService();
