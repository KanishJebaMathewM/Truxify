import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying smart contracts with account: ${deployer.address}`);

  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log(`Escrow contract deployed to Polygon Amoy at: ${escrowAddress}`);

  // Auto-export ABI to blockchain/abi
  const artifactPath = path.join(
    __dirname,
    "../artifacts/contracts/Escrow.sol/Escrow.json"
  );

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const abiDir = path.join(__dirname, "../abi");

    if (!fs.existsSync(abiDir)) {
      fs.mkdirSync(abiDir, { recursive: true });
    }

    fs.writeFileSync(
      path.join(abiDir, "Escrow.json"),
      JSON.stringify(artifact.abi, null, 2)
    );
    console.log("Exported Escrow ABI to blockchain/abi/Escrow.json");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
