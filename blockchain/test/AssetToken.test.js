import assert from "node:assert/strict";
import hre from "hardhat";

const { ethers } = hre;

describe("AssetToken", function () {
  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  async function deployAssetToken() {
    const [owner, buyer1, buyer2, outsider] = await ethers.getSigners();

    const AssetToken = await ethers.getContractFactory("AssetToken");
    const assetToken = await AssetToken.deploy();

    await assetToken.waitForDeployment();

    return {
      assetToken,
      owner,
      buyer1,
      buyer2,
      outsider,
    };
  }

  async function createDefaultAsset(
    assetToken,
    owner,
    {
      name = "Truck 1",
      description = "Volvo FH16",
      assetType = "truck",
      totalValue = ethers.parseEther("100"),
      totalTokens = ethers.parseEther("100"),
      metadataURI = "ipfs://...",
    } = {}
  ) {
    await assetToken.connect(owner).createAsset(
      name,
      description,
      assetType,
      totalValue,
      totalTokens,
      metadataURI
    );
  }

  async function markCompliant(assetToken, owner, addresses) {
    for (const address of addresses) {
      await assetToken.connect(owner).verifyCompliance(address);

      assert.equal(
        await assetToken.isCompliant(address),
        true
      );
    }
  }

  async function assertSupplyInvariant(
    assetToken,
    assetId,
    totalTokens
  ) {
    const asset = await assetToken.getAsset(assetId);
    const issuedTokens = await assetToken.getIssuedTokens(assetId);
    const totalSupply = await assetToken.totalSupply();

    assert.equal(
      issuedTokens,
      totalSupply,
      "issued token ledger must match ERC20 total supply"
    );

    assert.equal(
      issuedTokens + asset.availableTokens,
      totalTokens,
      "available tokens + issued tokens must equal total tokens"
    );
  }

  // -------------------------------------------------------------------------
  // Asset creation
  // -------------------------------------------------------------------------

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

  it("should reject creating an asset with zero total tokens", async function () {
    const { assetToken, owner } = await deployAssetToken();

    await assert.rejects(
      assetToken.connect(owner).createAsset(
        "Truck 1",
        "Volvo FH16",
        "truck",
        ethers.parseEther("100"),
        0n,
        "ipfs://..."
      )
    );
  });

  // -------------------------------------------------------------------------
  // Primary purchase and userAssets
  // -------------------------------------------------------------------------

  it("should update userAssets on purchaseFraction and prevent duplicates", async function () {
    const { assetToken, owner, buyer1 } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    let assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(assets.length, 0);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(assets.length, 1);
    assert.equal(assets[0], 1n);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("5"),
      {
        value: ethers.parseEther("5"),
      }
    );

    assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(assets.length, 1);
    assert.equal(assets[0], 1n);

    await assertSupplyInvariant(
      assetToken,
      1,
      ethers.parseEther("100")
    );
  });

  it("should reject purchasing more tokens than available", async function () {
    const { assetToken, owner, buyer1 } =
      await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assert.rejects(
      assetToken.connect(buyer1).purchaseFraction(
        1,
        ethers.parseEther("101"),
        {
          value: ethers.parseEther("101"),
        }
      ),
      /Insufficient tokens/
    );
  });

  // -------------------------------------------------------------------------
  // Selling fractions
  // -------------------------------------------------------------------------

  it("should remove asset from userAssets when ownership reaches zero", async function () {
    const { assetToken, owner, buyer1 } =
      await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).sellFraction(
      1,
      ethers.parseEther("4")
    );

    let assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(assets.length, 1);

    await assetToken.connect(buyer1).sellFraction(
      1,
      ethers.parseEther("6")
    );

    assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(assets.length, 0);

    await assertSupplyInvariant(
      assetToken,
      1,
      ethers.parseEther("100")
    );
  });

  it("should reject selling more tokens than the holder owns", async function () {
    const { assetToken, owner, buyer1 } =
      await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assert.rejects(
      assetToken.connect(buyer1).sellFraction(
        1,
        ethers.parseEther("11")
      ),
      /Insufficient balance/
    );
  });

  // -------------------------------------------------------------------------
  // Trade order lifecycle
  // -------------------------------------------------------------------------

  it("should handle userAssets updates during trade order lifecycle", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("10"),
      1,
      "sell"
    );

    let buyer1Assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(buyer1Assets.length, 0);

    await assetToken.connect(buyer1).cancelTradeOrder(1, 0);

    buyer1Assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(buyer1Assets.length, 1);
    assert.equal(buyer1Assets[0], 1n);

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("10"),
      1,
      "sell"
    );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      1,
      {
        value: ethers.parseEther("10"),
      }
    );

    buyer1Assets = await assetToken.getUserAssets(
      buyer1.address
    );

    assert.equal(buyer1Assets.length, 0);

    const buyer2Assets = await assetToken.getUserAssets(
      buyer2.address
    );

    assert.equal(buyer2Assets.length, 1);
    assert.equal(buyer2Assets[0], 1n);
  });

  // -------------------------------------------------------------------------
  // Payouts
  // -------------------------------------------------------------------------

  it("should accrue a claimable payout on sellFraction and pay it via claimPayout", async function () {
    const { assetToken, owner, buyer1 } =
      await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).sellFraction(
      1,
      ethers.parseEther("4")
    );

    assert.equal(
      await assetToken.getClaimableBalance(buyer1.address),
      ethers.parseEther("4")
    );

    assert.equal(
      await assetToken.balanceOf(buyer1.address),
      ethers.parseEther("6")
    );

    const balanceBefore =
      await ethers.provider.getBalance(buyer1.address);

    const tx = await assetToken
      .connect(buyer1)
      .claimPayout();

    const receipt = await tx.wait();

    const gasPrice = receipt.gasPrice ?? 0n;
    const gasCost = receipt.gasUsed * gasPrice;

    assert.equal(
      await assetToken.getClaimableBalance(buyer1.address),
      0n
    );

    const balanceAfter =
      await ethers.provider.getBalance(buyer1.address);

    assert.equal(
      balanceAfter - balanceBefore + gasCost,
      ethers.parseEther("4")
    );
  });

  it("should revert claimPayout when there is nothing to claim", async function () {
    const { assetToken, buyer1 } =
      await deployAssetToken();

    await assert.rejects(
      assetToken.connect(buyer1).claimPayout(),
      /No claimable balance/
    );
  });

  // -------------------------------------------------------------------------
  // Pool accounting
  // -------------------------------------------------------------------------

  it("should return sold fractions to the available pool and not double count ownership", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).sellFraction(
      1,
      ethers.parseEther("6")
    );

    let asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      ethers.parseEther("96")
    );

    await assetToken.connect(buyer2).purchaseFraction(
      1,
      ethers.parseEther("6"),
      {
        value: ethers.parseEther("6"),
      }
    );

    assert.equal(
      await assetToken.balanceOf(buyer2.address),
      ethers.parseEther("6")
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      ethers.parseEther("100")
    );
  });

  // -------------------------------------------------------------------------
  // Buy-back backing
  // -------------------------------------------------------------------------

  it("should carry the buy-back backing through a P2P transfer so claims stay within contract ETH", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await markCompliant(
      assetToken,
      owner,
      [buyer1.address, buyer2.address]
    );

    await assetToken.connect(buyer1).transferWithCompliance(
      1,
      buyer2.address,
      ethers.parseEther("4")
    );

    const buyer1Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer1.address
      );

    const buyer2Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer2.address
      );

    assert.equal(
      buyer1Ownership.amount,
      ethers.parseEther("6")
    );

    assert.equal(
      buyer1Ownership.backedTokens,
      ethers.parseEther("6")
    );

    assert.equal(
      buyer2Ownership.amount,
      ethers.parseEther("4")
    );

    assert.equal(
      buyer2Ownership.backedTokens,
      ethers.parseEther("4")
    );

    await assetToken.connect(buyer2).sellFraction(
      1,
      ethers.parseEther("4")
    );

    await assetToken.connect(buyer1).sellFraction(
      1,
      ethers.parseEther("6")
    );

    const totalClaims =
      (await assetToken.getClaimableBalance(
        buyer1.address
      )) +
      (await assetToken.getClaimableBalance(
        buyer2.address
      ));

    const contractBalance =
      await ethers.provider.getBalance(
        assetToken.target
      );

    assert.equal(
      totalClaims,
      ethers.parseEther("10")
    );

    assert.equal(
      contractBalance,
      ethers.parseEther("10")
    );

    assert.ok(
      totalClaims <= contractBalance,
      "claims must never exceed contract ETH"
    );

    await assetToken.connect(buyer2).claimPayout();
    await assetToken.connect(buyer1).claimPayout();

    assert.equal(
      await ethers.provider.getBalance(
        assetToken.target
      ),
      0n
    );
  });

  // -------------------------------------------------------------------------
  // Compliance
  // -------------------------------------------------------------------------

  it("should reject transferWithCompliance for non-compliant parties", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assert.rejects(
      assetToken.connect(buyer1).transferWithCompliance(
        1,
        buyer2.address,
        ethers.parseEther("4")
      ),
      /Sender not compliant/
    );

    await assetToken
      .connect(owner)
      .verifyCompliance(buyer1.address);

    await assert.rejects(
      assetToken.connect(buyer1).transferWithCompliance(
        1,
        buyer2.address,
        ethers.parseEther("4")
      ),
      /Recipient not compliant/
    );

    await assetToken
      .connect(owner)
      .verifyCompliance(buyer2.address);

    await assetToken.connect(buyer1).transferWithCompliance(
      1,
      buyer2.address,
      ethers.parseEther("4")
    );

    assert.equal(
      (
        await assetToken.getFractionalOwnership(
          1,
          buyer2.address
        )
      ).amount,
      ethers.parseEther("4")
    );
  });

  // -------------------------------------------------------------------------
  // ERC20 transfer restrictions
  // -------------------------------------------------------------------------

  it("should block plain ERC20 transfer/transferFrom so the fractional-ownership ledger cannot desync", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assert.rejects(
      assetToken.connect(buyer1).transfer(
        buyer2.address,
        ethers.parseEther("4")
      ),
      /plain ERC20 transfers disabled/
    );

    await assert.rejects(
      assetToken.connect(buyer1).transferFrom(
        buyer1.address,
        buyer2.address,
        ethers.parseEther("4")
      ),
      /plain ERC20 transferFrom disabled/
    );

    const buyer1Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer1.address
      );

    const buyer2Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer2.address
      );

    assert.equal(
      buyer1Ownership.amount,
      ethers.parseEther("10")
    );

    assert.equal(
      buyer1Ownership.backedTokens,
      ethers.parseEther("10")
    );

    assert.equal(
      buyer2Ownership.amount,
      0n
    );

    assert.equal(
      await assetToken.balanceOf(buyer2.address),
      0n
    );

    await markCompliant(
      assetToken,
      owner,
      [buyer1.address, buyer2.address]
    );

    await assetToken.connect(buyer1).transferWithCompliance(
      1,
      buyer2.address,
      ethers.parseEther("4")
    );

    assert.equal(
      (
        await assetToken.getFractionalOwnership(
          1,
          buyer1.address
        )
      ).amount,
      ethers.parseEther("6")
    );

    assert.equal(
      (
        await assetToken.getFractionalOwnership(
          1,
          buyer2.address
        )
      ).amount,
      ethers.parseEther("4")
    );

    assert.equal(
      await assetToken.balanceOf(buyer2.address),
      ethers.parseEther("4")
    );
  });

  // -------------------------------------------------------------------------
  // Secondary-market backing
  // -------------------------------------------------------------------------

  it("should keep the buy-back backing for tokens acquired via a secondary-market trade", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("10"),
      1,
      "sell"
    );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      0,
      {
        value: ethers.parseEther("10"),
      }
    );

    const buyer2Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer2.address
      );

    assert.equal(
      buyer2Ownership.amount,
      ethers.parseEther("10")
    );

    assert.equal(
      buyer2Ownership.backedTokens,
      ethers.parseEther("10")
    );

    const contractBalance =
      await ethers.provider.getBalance(
        assetToken.target
      );

    assert.equal(
      contractBalance,
      ethers.parseEther("10")
    );

    await assetToken.connect(buyer2).sellFraction(
      1,
      ethers.parseEther("10")
    );

    const claims =
      await assetToken.getClaimableBalance(
        buyer2.address
      );

    assert.equal(
      claims,
      ethers.parseEther("10")
    );

    assert.ok(
      claims <= contractBalance,
      "claims must never exceed contract ETH"
    );

    await assetToken.connect(buyer2).claimPayout();

    assert.equal(
      await ethers.provider.getBalance(
        assetToken.target
      ),
      0n
    );
  });

  it("should reject sellFraction for tokens the contract was never funded for", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await markCompliant(
      assetToken,
      owner,
      [buyer1.address, buyer2.address]
    );

    await assetToken.connect(buyer1).transferWithCompliance(
      1,
      buyer2.address,
      ethers.parseEther("10")
    );

    await assert.rejects(
      assetToken.connect(buyer1).sellFraction(
        1,
        ethers.parseEther("1")
      ),
      /Insufficient balance/
    );
  });

  // -------------------------------------------------------------------------
  // Supply invariants
  // -------------------------------------------------------------------------

  it("should never let an asset's supply exceed totalTokens across purchase -> secondary sale -> sellFraction cycles", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
      outsider,
    } = await deployAssetToken();

    const totalTokens =
      ethers.parseEther("100");

    await createDefaultAsset(
      assetToken,
      owner,
      {
        totalTokens,
      }
    );

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    assert.equal(
      await assetToken.totalSupply(),
      ethers.parseEther("10")
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      ethers.parseEther("10")
    );

    let asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      ethers.parseEther("90")
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("10"),
      1,
      "sell"
    );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      0,
      {
        value: ethers.parseEther("10"),
      }
    );

    assert.equal(
      await assetToken.totalSupply(),
      ethers.parseEther("10")
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      ethers.parseEther("10")
    );

    asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      ethers.parseEther("90")
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );

    await assetToken.connect(buyer2).sellFraction(
      1,
      ethers.parseEther("10")
    );

    assert.equal(
      await assetToken.totalSupply(),
      0n
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      0n
    );

    asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      totalTokens
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      totalTokens,
      {
        value: ethers.parseEther("100"),
      }
    );

    assert.equal(
      await assetToken.totalSupply(),
      totalTokens
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      totalTokens
    );

    asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      0n
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );

    await assert.rejects(
      assetToken.connect(outsider).purchaseFraction(
        1,
        ethers.parseEther("1"),
        {
          value: ethers.parseEther("1"),
        }
      ),
      /Insufficient tokens/
    );

    assert.equal(
      (await assetToken.totalSupply()) +
        asset.availableTokens,
      totalTokens
    );
  });

  it("should keep availableTokens in sync with the issued ledger across repeated buy/sell cycles", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    const totalTokens =
      ethers.parseEther("100");

    await createDefaultAsset(
      assetToken,
      owner,
      {
        totalTokens,
      }
    );

    for (let i = 0; i < 5; i++) {
      await assetToken.connect(buyer1).purchaseFraction(
        1,
        ethers.parseEther("20"),
        {
          value: ethers.parseEther("20"),
        }
      );

      await assetToken.connect(buyer1).sellFraction(
        1,
        ethers.parseEther("20")
      );

      await assertSupplyInvariant(
        assetToken,
        1,
        totalTokens
      );
    }

    let asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      totalTokens
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      0n
    );

    assert.equal(
      await assetToken.totalSupply(),
      0n
    );

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("40"),
      {
        value: ethers.parseEther("40"),
      }
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("40"),
      1,
      "sell"
    );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      0,
      {
        value: ethers.parseEther("40"),
      }
    );

    await assetToken.connect(buyer2).sellFraction(
      1,
      ethers.parseEther("40")
    );

    asset = await assetToken.getAsset(1);

    assert.equal(
      asset.availableTokens,
      totalTokens
    );

    assert.equal(
      await assetToken.getIssuedTokens(1),
      0n
    );

    assert.equal(
      await assetToken.totalSupply(),
      0n
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );
  });

  // -------------------------------------------------------------------------
  // Secondary-market pricing
  // -------------------------------------------------------------------------

  it("should charge the 1e18-normalized cost on an exact secondary-market trade", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("10"),
      {
        value: ethers.parseEther("10"),
      }
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("10"),
      ethers.parseEther("1.5"),
      "sell"
    );

    const sellerBalanceBefore =
      await ethers.provider.getBalance(
        buyer1.address
      );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      0,
      {
        value: ethers.parseEther("15"),
      }
    );

    const sellerBalanceAfter =
      await ethers.provider.getBalance(
        buyer1.address
      );

    assert.equal(
      sellerBalanceAfter - sellerBalanceBefore,
      ethers.parseEther("15")
    );

    const order =
      (await assetToken.getTradeOrders(1))[0];

    assert.equal(
      order.isActive,
      false
    );

    assert.equal(
      order.buyer,
      buyer2.address
    );

    const buyer2Ownership =
      await assetToken.getFractionalOwnership(
        1,
        buyer2.address
      );

    assert.equal(
      buyer2Ownership.amount,
      ethers.parseEther("10")
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      ethers.parseEther("100")
    );
  });

  it("should floor the 1e18-normalized cost and refund excess on non-exact trade amounts", async function () {
    const {
      assetToken,
      owner,
      buyer1,
      buyer2,
    } = await deployAssetToken();

    await createDefaultAsset(assetToken, owner);

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      ethers.parseEther("1.5"),
      {
        value: ethers.parseEther("1.5"),
      }
    );

    await assetToken.connect(buyer1).createTradeOrder(
      1,
      ethers.parseEther("1.5"),
      3,
      "sell"
    );

    await assert.rejects(
      assetToken.connect(buyer2).executeTradeOrder(
        1,
        0,
        {
          value: 3n,
        }
      ),
      /Insufficient payment/
    );

    const sellerBalanceBefore =
      await ethers.provider.getBalance(
        buyer1.address
      );

    await assetToken.connect(buyer2).executeTradeOrder(
      1,
      0,
      {
        value: 10n,
      }
    );

    const sellerBalanceAfter =
      await ethers.provider.getBalance(
        buyer1.address
      );

    assert.equal(
      sellerBalanceAfter - sellerBalanceBefore,
      4n
    );

    const order =
      (await assetToken.getTradeOrders(1))[0];

    assert.equal(
      order.isActive,
      false
    );

    assert.equal(
      order.buyer,
      buyer2.address
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      ethers.parseEther("100")
    );
  });

  // -------------------------------------------------------------------------
  // Rounding
  // -------------------------------------------------------------------------

  it("should keep buy/sell rounding symmetric so a round-trip is value-neutral", async function () {
    const {
      assetToken,
      owner,
      buyer1,
    } = await deployAssetToken();

    const totalTokens =
      ethers.parseEther("3");

    await createDefaultAsset(
      assetToken,
      owner,
      {
        totalValue: ethers.parseEther("100"),
        totalTokens,
      }
    );

    const amount =
      ethers.parseEther("1");

    await assetToken.connect(buyer1).purchaseFraction(
      1,
      amount,
      {
        value: ethers.parseEther("34"),
      }
    );

    await assetToken.connect(buyer1).sellFraction(
      1,
      amount
    );

    await assetToken.connect(buyer1).claimPayout();

    assert.equal(
      await ethers.provider.getBalance(
        assetToken.target
      ),
      0n
    );

    await assertSupplyInvariant(
      assetToken,
      1,
      totalTokens
    );
  });
});
