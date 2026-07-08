const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const networkName = network.name;
  console.log("Network:", networkName);

  const relayerAddress = process.env.RELAYER_WALLET_ADDRESS || deployer.address;

  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  const platformFeeBps = parseInt(process.env.PLATFORM_FEE_BPS || "250", 10);

  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(relayerAddress);
  await escrow.waitForDeployment();
  console.log("Escrow deployed to:", await escrow.getAddress());

  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(relayerAddress);
  await reputation.waitForDeployment();
  console.log("Reputation deployed to:", await reputation.getAddress());

  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nVerification commands:");
    console.log(`npx hardhat verify --network ${networkName} ${await escrow.getAddress()} ${relayerAddress}`);
    console.log(`npx hardhat verify --network ${networkName} ${await reputation.getAddress()} ${relayerAddress}`);
  }

  const deployment = {
    network: networkName,
    escrow: await escrow.getAddress(),
    reputation: await reputation.getAddress(),
    relayer: relayerAddress,
    feeRecipient,
    platformFeeBps,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const fs = require("fs");
  const deploymentPath = `./deployments/${networkName}.json`;
  fs.mkdirSync("./deployments", { recursive: true });
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`Deployment saved to ${deploymentPath}`);

  console.log("\nDeployment Summary:");
  console.log("------------------------");
  console.log("Escrow:", await escrow.getAddress());
  console.log("Reputation:", await reputation.getAddress());
  console.log("Relayer:", relayerAddress);
  console.log("Fee Recipient:", feeRecipient);
  console.log("Platform Fee (bps):", platformFeeBps);
  console.log("------------------------");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
