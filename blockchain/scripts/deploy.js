import { ethers } from "hardhat";

export async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await ethers.provider.getBalance(deployer.address)).toString());

  // ── TruxifyEscrow (active contract) ──────────────────────────────────
  // Deploys TruxifyEscrow.sol — the live escrow contract used by the
  // backend (escrow.js). The old Escrow.sol is deprecated and lives in
  // contracts/deprecated/Escrow.sol.
  //
  // TruxifyEscrow has no constructor arguments (Ownable uses msg.sender).
  // See DEPLOYMENT.md for per-network addresses.
  const Escrow = await ethers.getContractFactory("TruxifyEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  console.log("TruxifyEscrow deployed to:", await escrow.getAddress());

  // ── Reputation ───────────────────────────────────────────────────────
  const Reputation = await ethers.getContractFactory("Reputation");
  const reputation = await Reputation.deploy(deployer.address);
  await reputation.waitForDeployment();
  console.log("Reputation deployed to:", await reputation.getAddress());

  console.log("\nDeployment Summary:");
  console.log("------------------------");
  console.log("TruxifyEscrow:", await escrow.getAddress());
  console.log("Reputation:", await reputation.getAddress());
  console.log("Deployer:", deployer.address);
  console.log("------------------------");
  console.log("\nNOTE: The old Escrow.sol is DEPRECATED.");
  console.log("Only TruxifyEscrow is compatible with the backend ABI.");
  console.log("Set ESCROW_CONTRACT_ADDRESS in backend .env to the TruxifyEscrow address above.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
