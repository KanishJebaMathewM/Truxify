const { ethers, upgrades } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  const TruxifyEscrow = await ethers.getContractFactory("TruxifyEscrow");
  console.log("Deploying TruxifyEscrow proxy...");
  
  // Deploy proxy using the UUPS pattern
  const escrowProxy = await upgrades.deployProxy(TruxifyEscrow, [], {
    initializer: "initialize",
    kind: "uups",
  });
  
  await escrowProxy.waitForDeployment();
  console.log("TruxifyEscrow Proxy deployed to:", await escrowProxy.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
