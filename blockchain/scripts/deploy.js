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
