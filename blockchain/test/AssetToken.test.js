import assert from "node:assert/strict";
import hre from "hardhat";
const { ethers } = hre;

describe("AssetToken", function () {
  async function deployAssetToken() {
    const [owner, buyer1, buyer2, outsider] = await ethers.getSigners();
    const AssetToken = await ethers.getContractFactory("AssetToken");
    const assetToken = await AssetToken.deploy();
    await assetToken.waitForDeployment();
    return { assetToken, owner, buyer1, buyer2, outsider };
  }

  it("should create an asset and update assetCounter", async function () {
    const { assetToken, owner } = await deployAssetToken();
    const name = "Truck 1";
    const description = "Volvo FH16";
    const assetType = "truck";
    const totalValue = ethers.parseEther("100");
    const totalTokens = ethers.parseEther("100");
    const metadataURI = "ipfs://Qm...";

    await assetToken.connect(owner).createAsset(
      name,
      description,
      assetType,
      totalValue,
      totalTokens,
      metadataURI
    );

    const asset = await assetToken.getAsset(1);
    assert.equal(asset.name, name);
    assert.equal(asset.owner, owner.address);
    assert.equal(await assetToken.getTotalAssets(), 1n);
  });

  it("should update userAssets on purchaseFraction and prevent duplicates", async function () {
    const { assetToken, owner, buyer1 } = await deployAssetToken();
    await assetToken.connect(owner).createAsset(
      "Truck 1",
      "Volvo FH16",
      "truck",
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      "ipfs://..."
    );

    // Initial userAssets should be empty
    let assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(assets.length, 0);

    // Purchase fraction first time
    await assetToken.connect(buyer1).purchaseFraction(1, ethers.parseEther("10"), {
      value: ethers.parseEther("10")
    });

    assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(assets.length, 1);
    assert.equal(assets[0], 1n);

    // Purchase fraction second time (should not duplicate asset ID in userAssets)
    await assetToken.connect(buyer1).purchaseFraction(1, ethers.parseEther("5"), {
      value: ethers.parseEther("5")
    });

    assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(assets.length, 1);
    assert.equal(assets[0], 1n);
  });

  it("should remove asset from userAssets on sellFraction when ownership reaches zero", async function () {
    const { assetToken, owner, buyer1 } = await deployAssetToken();
    await assetToken.connect(owner).createAsset(
      "Truck 1",
      "Volvo FH16",
      "truck",
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      "ipfs://..."
    );

    await assetToken.connect(buyer1).purchaseFraction(1, ethers.parseEther("10"), {
      value: ethers.parseEther("10")
    });

    // Sell partial fraction
    await assetToken.connect(buyer1).sellFraction(1, ethers.parseEther("4"));
    let assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(assets.length, 1);

    // Sell remaining fraction
    await assetToken.connect(buyer1).sellFraction(1, ethers.parseEther("6"));
    assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(assets.length, 0);
  });

  it("should handle userAssets updates during trade order lifecycle", async function () {
    const { assetToken, owner, buyer1, buyer2 } = await deployAssetToken();
    await assetToken.connect(owner).createAsset(
      "Truck 1",
      "Volvo FH16",
      "truck",
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      "ipfs://..."
    );

    // buyer1 purchases fraction
    await assetToken.connect(buyer1).purchaseFraction(1, ethers.parseEther("10"), {
      value: ethers.parseEther("10")
    });

    // buyer1 creates a trade order for the entire amount (escrowed)
    await assetToken.connect(buyer1).createTradeOrder(1, ethers.parseEther("10"), 1, "sell");

    // buyer1's userAssets should now be empty since all tokens are in escrow
    let buyer1Assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(buyer1Assets.length, 0);

    // buyer1 cancels the trade order
    await assetToken.connect(buyer1).cancelTradeOrder(1, 0);

    // buyer1's userAssets should be restored
    buyer1Assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(buyer1Assets.length, 1);
    assert.equal(buyer1Assets[0], 1n);

    // buyer1 creates the trade order again
    await assetToken.connect(buyer1).createTradeOrder(1, ethers.parseEther("10"), 1, "sell");

    // buyer2 executes the trade order
    await assetToken.connect(buyer2).executeTradeOrder(1, 1, {
      value: ethers.parseEther("10")
    });

    // buyer1 should have no assets, buyer2 should have asset 1
    buyer1Assets = await assetToken.getUserAssets(buyer1.address);
    assert.equal(buyer1Assets.length, 0);

    let buyer2Assets = await assetToken.getUserAssets(buyer2.address);
    assert.equal(buyer2Assets.length, 1);
    assert.equal(buyer2Assets[0], 1n);
  });
});
