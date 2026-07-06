import { network } from "hardhat";

const net1 = await network.create();
console.log("net1.ethers:", !!net1.ethers);

const net2 = await network.create();
console.log("net2.ethers:", !!net2.ethers);
