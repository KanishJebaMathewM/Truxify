const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AssetToken ERC-1155", function () {
  it("Should mint bill of lading tokens and bind document hash metadata", async function () {
    const [owner, shipper] = await ethers.getSigners();
    const AssetToken = await ethers.getContractFactory("AssetToken");
    const assetToken = await AssetToken.deploy();

    const docHash = ethers.keccak256(ethers.toUtf8Bytes("BILL_OF_LADING_DOC_1001"));
    const tokenId = 1001;

    await assetToken.mintBillOfLadingToken(
      shipper.address,
      tokenId,
      100, // 100 fractional units
      docHash,
      "https://api.truxify.com/metadata/1001.json"
    );

    expect(await assetToken.balanceOf(shipper.address, tokenId)).to.equal(100);
    expect(await assetToken.documentHashes(tokenId)).to.equal(docHash);
  });
});
