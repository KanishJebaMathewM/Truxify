const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
    console.log("⚡ Deploying zkEVM Rollup...");

    // Deploy Verifier (placeholder)
    const MockVerifier = await ethers.getContractFactory("Verifier");
    const verifier = await MockVerifier.deploy();
    await verifier.waitForDeployment();
    console.log(`✅ Verifier deployed: ${await verifier.getAddress()}`);

    // Deploy zkEVM
    const zkEVM = await ethers.getContractFactory("zkEVM");
    const rollup = await zkEVM.deploy(await verifier.getAddress());
    await rollup.waitForDeployment();
    console.log(`✅ zkEVM deployed: ${await rollup.getAddress()}`);

    // Deploy Bridge
    const zkEVMBridge = await ethers.getContractFactory("zkEVMBridge");
    const bridge = await zkEVMBridge.deploy(await rollup.getAddress());
    await bridge.waitForDeployment();
    console.log(`✅ Bridge deployed: ${await bridge.getAddress()}`);

    // Test rollup
    console.log("\n🧪 Testing zkEVM...");

    const [signer] = await ethers.getSigners();

    // Deposit
    const depositTx = await bridge.depositToL2({ value: ethers.parseEther("1.1") });
    await depositTx.wait();
    console.log("✅ Deposit successful");

    // Check balance
    const balance = await rollup.getBalance(signer.address);
    console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

    // Execute transaction
    const txData = ethers.solidityPacked(
        ["address", "address", "uint256", "bytes", "uint256", "uint256", "uint256", "bytes"],
        [signer.address, signer.address, 0, "0x", 0, 0, 21000, "0x"]
    );

    const tx = await rollup.executeTransaction(
        signer.address,
        signer.address,
        0,
        "0x",
        0,
        0,
        21000,
        "0x"
    );
    await tx.wait();
    console.log("✅ Transaction executed");

    // Get stats
    const totalTx = await rollup.getTotalTransactions();
    const totalBatches = await rollup.getTotalBatches();
    console.log(`📊 Total transactions: ${totalTx}, Total batches: ${totalBatches}`);

    // Save deployment
    const deployment = {
        verifier: await verifier.getAddress(),
        zkEVM: await rollup.getAddress(),
        bridge: await bridge.getAddress(),
        network: hre.network.name,
        timestamp: new Date().toISOString()
    };

    fs.writeFileSync(
        path.join(__dirname, "../deployment-zkevm.json"),
        JSON.stringify(deployment, null, 2)
    );
    console.log("✅ Deployment info saved");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });