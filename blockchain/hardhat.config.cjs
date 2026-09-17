const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_READ_FILE } = require("hardhat/builtin-tasks/task-names");
const fs = require("fs");

require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-network-helpers");
require("@nomicfoundation/hardhat-verify");
require("@openzeppelin/hardhat-upgrades");

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

subtask(TASK_COMPILE_SOLIDITY_READ_FILE).setAction(async ({ absolutePath }) => {
  const content = fs.readFileSync(absolutePath, "utf8");
  return content.replace(/^\uFEFF/, "");
});

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
      {
        version: "0.8.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    ],
  },
  networks: {
    hardhat: {},
    amoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
      chainId: 80002,
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
};