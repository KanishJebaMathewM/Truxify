require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-viem");
require("@nomicfoundation/hardhat-verify");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-ignition");

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "";
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || "";

function validatePrivateKey(key) {
  if (!key || key.length === 0) return false;
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) return false;
  return true;
}

function sanitizeRpcUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : '';
  } catch {
    return '';
  }
}

function getNetworkConfig(name, url, chainId, privateKey) {
  return {
    url: sanitizeRpcUrl(url) || `https://${name}.polygon.technology/`,
    accounts: validatePrivateKey(privateKey) ? [privateKey] : [],
    chainId,
  };
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    amoy: {
      url: POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology/",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 80002,
    },
    polygon: {
      url: POLYGON_RPC_URL || "https://polygon-rpc.com",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 137,
    },
  },
  etherscan: {
    apiKey: {
      amoy: POLYGONSCAN_API_KEY || "",
      polygon: POLYGONSCAN_API_KEY || "",
    },
  },
};