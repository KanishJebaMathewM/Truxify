const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying UUPS Proxy with DAO Governance...");

  // Deploy implementation
  const TruxifyUpgradeable = await hre.ethers.getContractFactory("TruxifyUpgradeable");
  const implementation = await TruxifyUpgradeable.deploy();
  await implementation.waitForDeployment();
  
  const implementationAddress = await implementation.getAddress();
  console.log(`📦 Implementation deployed to: ${implementationAddress}`);

  // Prepare initialization data
  const initializeData = implementation.interface.encodeFunctionData("initialize");

  // Deploy proxy
  const UUPSProxy = await hre.ethers.getContractFactory("UUPSProxy");
  const proxy = await UUPSProxy.deploy(implementationAddress, initializeData);
  await proxy.waitForDeployment();
  
  const proxyAddress = await proxy.getAddress();
  console.log(`🔄 Proxy deployed to: ${proxyAddress}`);

  // Get proxy contract instance
  const truxify = await hre.ethers.getContractAt("TruxifyUpgradeable", proxyAddress);

  // Grant DAO roles
  const daoAddress = process.env.DAO_ADDRESS || await hre.ethers.getSigners()[0].getAddress();
  await truxify.grantDAORole(daoAddress);
  console.log(`👥 DAO role granted to: ${daoAddress}`);

  // Grant upgrader role for emergency upgrades
  const upgraderAddress = process.env.UPGRADER_ADDRESS || await hre.ethers.getSigners()[0].getAddress();
  await truxify.grantUpgraderRole(upgraderAddress);
  console.log(`🔧 Upgrader role granted to: ${upgraderAddress}`);

  // Grant pauser role
  const pauserAddress = process.env.PAUSER_ADDRESS || await hre.ethers.getSigners()[0].getAddress();
  await truxify.grantPauserRole(pauserAddress);
  console.log(`⏸️ Pauser role granted to: ${pauserAddress}`);

  // Verify setup
  console.log("\n📊 Deployment Summary:");
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`Proxy: ${proxyAddress}`);
  console.log(`DAO Address: ${daoAddress}`);
  console.log(`Upgrader: ${upgraderAddress}`);
  console.log(`Pauser: ${pauserAddress}`);

  // Save deployment info
  const fs = require("fs");
  const deploymentInfo = {
    implementation: implementationAddress,
    proxy: proxyAddress,
    daoAddress: daoAddress,
    upgraderAddress: upgraderAddress,
    pauserAddress: pauserAddress,
    timestamp: new Date().toISOString(),
    network: hre.network.name
  };

  fs.writeFileSync(
    "deployment-info.json",
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log("\n💾 Deployment info saved to deployment-info.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });