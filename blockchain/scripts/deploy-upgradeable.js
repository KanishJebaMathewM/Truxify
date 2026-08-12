import hre from "hardhat";
import fs from "fs";

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

  const signers = await hre.ethers.getSigners();
  const defaultAddress = signers[0].address;

  // Grant DAO roles
  const daoAddress = process.env.DAO_ADDRESS || defaultAddress;
  await truxify.grantDAORole(daoAddress);
  console.log(`👥 DAO role granted to: ${daoAddress}`);

  // Grant upgrader role for emergency upgrades
  const upgraderAddress = process.env.UPGRADER_ADDRESS || defaultAddress;
  await truxify.grantUpgraderRole(upgraderAddress);
  console.log(`🔧 Upgrader role granted to: ${upgraderAddress}`);

  // Grant pauser role
  const pauserAddress = process.env.PAUSER_ADDRESS || defaultAddress;
  await truxify.grantPauserRole(pauserAddress);
  console.log(`⏸️ Pauser role granted to: ${pauserAddress}`);

  // Wire up the governance token used to weight DAO votes. vote() and
  // executeProposal() both revert until this is set — there is deliberately
  // no unweighted (one-address-one-vote) fallback.
  const governanceTokenAddress = process.env.GOVERNANCE_TOKEN_ADDRESS;
  if (governanceTokenAddress) {
    await truxify.setGovernanceToken(governanceTokenAddress);
    console.log(`🗳️  Governance token set to: ${governanceTokenAddress}`);
  } else {
    console.warn(
      "⚠️  GOVERNANCE_TOKEN_ADDRESS not set — DAO voting/execution will revert until setGovernanceToken() is called."
    );
  }

  // Pre-approve any known-good implementations for the upgrade allowlist.
  // Accepts a comma-separated list of addresses.
  const approvedImplementations = (process.env.APPROVED_IMPLEMENTATIONS || "")
    .split(",")
    .map((addr) => addr.trim())
    .filter(Boolean);
  for (const addr of approvedImplementations) {
    await truxify.setApprovedImplementation(addr, true);
    console.log(`✅ Implementation approved for DAO proposals: ${addr}`);
  }

  // Verify setup
  console.log("\n📊 Deployment Summary:");
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`Proxy: ${proxyAddress}`);
  console.log(`DAO Address: ${daoAddress}`);
  console.log(`Upgrader: ${upgraderAddress}`);
  console.log(`Pauser: ${pauserAddress}`);
  console.log(`Governance Token: ${governanceTokenAddress || "(not set)"}`);

  // Save deployment info
  const deploymentInfo = {
    implementation: implementationAddress,
    proxy: proxyAddress,
    daoAddress: daoAddress,
    upgraderAddress: upgraderAddress,
    pauserAddress: pauserAddress,
    governanceTokenAddress: governanceTokenAddress || null,
    approvedImplementations: approvedImplementations,
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