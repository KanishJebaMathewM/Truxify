const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const relayerAddress = process.env.RELAYER_WALLET_ADDRESS || deployer.address;

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(relayerAddress);
  await escrow.waitForDeployment();
  console.log("Escrow deployed to:", await escrow.getAddress());

  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(relayerAddress);
  await reputation.waitForDeployment();
  console.log("Reputation deployed to:", await reputation.getAddress());

  console.log("\nDeployment Summary:");
  console.log("------------------------");
  console.log("Escrow:", await escrow.getAddress());
  console.log("Reputation:", await reputation.getAddress());
  console.log("Relayer:", relayerAddress);
  console.log("------------------------");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

  // blockchain/scripts/deploy.js
// Deploys all Truxify contracts to the configured network

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with wallet:", deployer.address);
  console.log("Wallet balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "MATIC");

  // ── Deploy Escrow ──────────────────────────────────────────────────────────
  console.log("\nDeploying Escrow...");
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  console.log("✅ Escrow deployed to:", await escrow.getAddress());

  // ── Deploy DocumentHash ────────────────────────────────────────────────────
  console.log("\nDeploying DocumentHash...");
  const DocumentHash = await ethers.getContractFactory("DocumentHash");
  const docHash = await DocumentHash.deploy();
  await docHash.waitForDeployment();
  console.log("✅ DocumentHash deployed to:", await docHash.getAddress());

  // ── Deploy DriverReputation ────────────────────────────────────────────────
  console.log("\nDeploying DriverReputation...");
  const DriverReputation = await ethers.getContractFactory("DriverReputation");
  const reputation = await DriverReputation.deploy();
  await reputation.waitForDeployment();
  console.log("✅ DriverReputation deployed to:", await reputation.getAddress());

  console.log("\n─── Deployment Summary ───────────────────────────────────────");
  console.log("Escrow:           ", await escrow.getAddress());
  console.log("DocumentHash:     ", await docHash.getAddress());
  console.log("DriverReputation: ", await reputation.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});