// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AssetToken is ERC20, ERC20Burnable, Ownable, Pausable, ReentrancyGuard {


    // ============ Structs ============

    struct Asset {
        uint256 id;
        string name;
        string description;
        string assetType; // truck, warehouse, fleet, equipment
        uint256 totalValue;
        uint256 tokenPrice;
        uint256 totalTokens;
        uint256 availableTokens;
        address owner;
        bool isActive;
        string metadataURI;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct FractionalOwnership {
        address owner;
        uint256 tokenId;
        uint256 amount;
        // Number of held tokens whose tokenPrice proceeds the contract has
        // actually collected (via purchaseFraction). Only backed tokens carry
        // a buy-back right, so sellFraction can never over-accrue claims
        // beyond the ETH held by the contract.
        uint256 backedTokens;
        uint256 purchasedAt;
    }

    struct TradeOrder {
        uint256 orderId;
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 amount;
        uint256 backedAmount;
        uint256 price;
        string orderType; // buy, sell
        bool isActive;
        uint256 createdAt;
        uint256 expiresAt;
    }

    // ============ State Variables ============

    mapping(uint256 => Asset) public assets;
    mapping(uint256 => mapping(address => FractionalOwnership)) public fractionalOwnership;
    mapping(address => uint256[]) public userAssets;
    mapping(uint256 => TradeOrder[]) public tradeOrders;
    mapping(uint256 => bool) public assetExists;
    // ETH accrued to each user from treasury buy-backs (sellFraction); the
    // funds are held by the contract and released via claimPayout().
    mapping(address => uint256) public claimableBalances;
    // Hard supply invariant: per-asset count of fractions that were minted
    // and remain outstanding (minted via purchaseFraction, burned back via
    // sellFraction). Enforced to never exceed totalTokens so the ERC20 supply
    // backing an asset can never exceed its collateralized pool, regardless of
    // how many times fractions change hands on the secondary market.
    mapping(uint256 => uint256) public issuedTokens;

    uint256 private _assetCounter;
    uint256 private _tradeOrderCounter;

    uint256 public constant MIN_TRADE_AMOUNT = 1e18; // 1 token
    uint256 public constant MAX_TRADE_AMOUNT = 10000e18; // 10000 tokens
    uint256 public constant TRADE_EXPIRY = 7 days;

    // Events
    event AssetCreated(uint256 indexed assetId, string name, address indexed owner);
    event AssetUpdated(uint256 indexed assetId, string name);
    event FractionalPurchase(uint256 indexed assetId, address indexed buyer, uint256 amount);
    event FractionalSale(uint256 indexed assetId, address indexed seller, uint256 amount);
    event TradeOrderCreated(uint256 indexed orderId, uint256 tokenId, address indexed seller);
    event TradeOrderExecuted(uint256 indexed orderId, uint256 tokenId, address indexed buyer);
    event AssetTraded(uint256 indexed assetId, address indexed from, address indexed to, uint256 amount);
    event ComplianceCheck(address indexed user, bool verified);
    event PayoutAccrued(uint256 indexed assetId, address indexed user, uint256 amount);
    event PayoutClaimed(address indexed user, uint256 amount);

    // ============ Constructor ============

    constructor() ERC20("Truxify Asset Token", "TXAT") Ownable(msg.sender) {}

    // ============ Asset Management ============

    function createAsset(
        string memory name,
        string memory description,
        string memory assetType,
        uint256 totalValue,
        uint256 totalTokens,
        string memory metadataURI
    ) external onlyOwner whenNotPaused returns (uint256) {
        require(bytes(name).length > 0, "Name required");
        require(totalValue > 0, "Value must be > 0");
        require(totalTokens > 0, "Tokens must be > 0");

        _assetCounter++;
        uint256 assetId = _assetCounter;

        uint256 tokenPrice = (totalValue * 1e18) / totalTokens;
        require(tokenPrice > 0, "Price too small");

        assets[assetId] = Asset({
            id: assetId,
            name: name,
            description: description,
            assetType: assetType,
            totalValue: totalValue,
            tokenPrice: tokenPrice,
            totalTokens: totalTokens,
            availableTokens: totalTokens,
            owner: msg.sender,
            isActive: true,
            metadataURI: metadataURI,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        assetExists[assetId] = true;

        emit AssetCreated(assetId, name, msg.sender);
        return assetId;
    }

    function updateAsset(
        uint256 assetId,
        string memory name,
        string memory description,
        string memory metadataURI
    ) external onlyOwner {
        require(assetExists[assetId], "Asset not found");
        Asset storage asset = assets[assetId];
        require(asset.owner == msg.sender, "Not owner");

        asset.name = name;
        asset.description = description;
        asset.metadataURI = metadataURI;
        asset.updatedAt = block.timestamp;

        emit AssetUpdated(assetId, name);
    }

    function deactivateAsset(uint256 assetId) external onlyOwner {
        require(assetExists[assetId], "Asset not found");
        assets[assetId].isActive = false;
    }

    // ============ Fractional Ownership ============

    function purchaseFraction(
        uint256 assetId,
        uint256 amount
    ) external payable nonReentrant whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        Asset storage asset = assets[assetId];
        require(asset.isActive, "Asset not active");
        require(amount > 0, "Amount must be > 0");
        require(asset.availableTokens >= amount, "Insufficient tokens");
        require(issuedTokens[assetId] + amount <= asset.totalTokens, "Supply cap exceeded");

        uint256 totalCost = (amount * asset.tokenPrice + 1e18 - 1) / 1e18;
        require(msg.value >= totalCost, "Insufficient payment");

        // Update asset
        asset.availableTokens -= amount;
        issuedTokens[assetId] += amount;

        // Update fractional ownership
        FractionalOwnership storage ownership = fractionalOwnership[assetId][msg.sender];
        if (ownership.amount == 0) {
            userAssets[msg.sender].push(assetId);
        }
        ownership.owner = msg.sender;
        ownership.tokenId = assetId;
        ownership.amount += amount;
        ownership.backedTokens += amount;
        ownership.purchasedAt = block.timestamp;

        // Mint tokens
        _mint(msg.sender, amount);

        // Refund excess payment
        if (msg.value > totalCost) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - totalCost}("");
            require(refunded, "Refund failed");
        }

        emit FractionalPurchase(assetId, msg.sender, amount);
    }

    function sellFraction(
        uint256 assetId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        require(amount > 0, "Amount must be > 0");

        FractionalOwnership storage ownership = fractionalOwnership[assetId][msg.sender];
        require(ownership.amount >= amount, "Insufficient balance");
        // Only tokens the contract was funded for carry a buy-back right.
        // Tokens that entered circulation via a free P2P transfer or an
        // unbacked trade cannot be sold back to the treasury.
        require(ownership.backedTokens >= amount, "Tokens not backed");

        Asset storage asset = assets[assetId];
        uint256 payout = (amount * asset.tokenPrice) / 1e18;

        // Burn tokens
        _burn(msg.sender, amount);

        // Update ownership
        ownership.amount -= amount;
        ownership.backedTokens -= amount;

        // Update asset — returned fractions re-enter the available pool. Only
        // real, currently-outstanding fractions can be sold back: they are
        // burned first, and the issuedTokens ledger is decremented to keep the
        // outstanding count in sync with availableTokens (so re-adding here can
        // never exceed what was originally minted from the primary pool).
        assets[assetId].availableTokens += amount;
        issuedTokens[assetId] -= amount;

        if (ownership.amount == 0) {
            _removeUserAsset(msg.sender, assetId);
        }

        // Accrue the buy-back payout; the seller claims it with claimPayout().
        // The contract's ETH balance is backed by purchase proceeds, so a
        // failing claim is guarded in claimPayout() with a fail-closed require.
        claimableBalances[msg.sender] += payout;

        emit PayoutAccrued(assetId, msg.sender, payout);
        emit FractionalSale(assetId, msg.sender, amount);
    }

    /// @notice Releases the caller's accrued buy-back payouts. The contract
    ///         holds the ETH from fraction purchases until sellers claim it.
    function claimPayout() external nonReentrant whenNotPaused {
        uint256 amount = claimableBalances[msg.sender];
        require(amount > 0, "No claimable balance");

        claimableBalances[msg.sender] = 0;

        (bool paid, ) = payable(msg.sender).call{value: amount}("");
        require(paid, "Payout transfer failed");

        emit PayoutClaimed(msg.sender, amount);
    }

    /// @notice View the accrued buy-back balance claimable by *user*.
    function getClaimableBalance(address user) external view returns (uint256) {
        return claimableBalances[user];
    }

    // ============ Trading ============

    function createTradeOrder(
        uint256 assetId,
        uint256 amount,
        uint256 price,
        string memory orderType
    ) external whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        require(amount >= MIN_TRADE_AMOUNT, "Amount too small");
        require(amount <= MAX_TRADE_AMOUNT, "Amount too large");
        require(price > 0, "Price must be > 0");

        FractionalOwnership storage ownership = fractionalOwnership[assetId][msg.sender];
        require(ownership.amount >= amount, "Insufficient fractional ownership");

        // Backed tokens are escrowed alongside the tokens so the buy-back
        // right follows the trade and cannot be double-claimed by the seller.
        uint256 escrowedBacking = ownership.backedTokens >= amount ? amount : ownership.backedTokens;

        _tradeOrderCounter++;
        uint256 orderId = _tradeOrderCounter;

        // Decrement seller's fractional ownership
        ownership.amount -= amount;
        ownership.backedTokens -= escrowedBacking;
        if (ownership.amount == 0) {
            _removeUserAsset(msg.sender, assetId);
        }

        // Escrow seller's tokens into the contract
        _transfer(msg.sender, address(this), amount);

        TradeOrder memory order = TradeOrder({
            orderId: orderId,
            tokenId: assetId,
            seller: msg.sender,
            buyer: address(0),
            amount: amount,
            backedAmount: escrowedBacking,
            price: price,
            orderType: orderType,
            isActive: true,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + TRADE_EXPIRY
        });

        tradeOrders[assetId].push(order);

        emit TradeOrderCreated(orderId, assetId, msg.sender);
    }

    function executeTradeOrder(
        uint256 assetId,
        uint256 orderIndex
    ) external payable nonReentrant whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        require(orderIndex < tradeOrders[assetId].length, "Order not found");

        TradeOrder storage order = tradeOrders[assetId][orderIndex];
        require(order.isActive, "Order not active");
        require(order.expiresAt > block.timestamp, "Order expired");
        require(order.seller != msg.sender, "Cannot buy own order");

        uint256 totalCost = (order.amount * order.price) / 1e18;
        require(msg.value >= totalCost, "Insufficient payment");

        // Increment buyer's fractional ownership. The escrowed tokens keep
        // their buy-back backing: the buyer's payment is routed through the
        // contract to the seller (balance-neutral), and the contract already
        // holds the tokenPrice proceeds from the original issuance.
        FractionalOwnership storage buyerOwnership = fractionalOwnership[assetId][msg.sender];
        if (buyerOwnership.amount == 0) {
            userAssets[msg.sender].push(assetId);
        }
        buyerOwnership.owner = msg.sender;
        buyerOwnership.tokenId = assetId;
        buyerOwnership.amount += order.amount;
        buyerOwnership.backedTokens += order.backedAmount;
        buyerOwnership.purchasedAt = block.timestamp;

        // Transfer escrowed tokens from contract to buyer
        _transfer(address(this), msg.sender, order.amount);

        // Update order
        order.buyer = msg.sender;
        order.isActive = false;

        // Transfer payment
        {
            (bool paid, ) = payable(order.seller).call{value: totalCost}("");
            require(paid, "Payment to seller failed");
        }

        // Refund excess payment
        if (msg.value > totalCost) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - totalCost}("");
            require(refunded, "Excess refund failed");
        }

        emit TradeOrderExecuted(order.orderId, assetId, msg.sender);
        emit AssetTraded(assetId, order.seller, msg.sender, order.amount);
    }

    function cancelTradeOrder(
        uint256 assetId,
        uint256 orderIndex
    ) external {
        require(assetExists[assetId], "Asset not found");
        require(orderIndex < tradeOrders[assetId].length, "Order not found");

        TradeOrder storage order = tradeOrders[assetId][orderIndex];
        require(order.seller == msg.sender, "Not seller");
        require(order.isActive, "Order not active");

        // Restore fractional ownership to seller, including the escrowed
        // buy-back backing for the returned tokens.
        FractionalOwnership storage ownership = fractionalOwnership[assetId][order.seller];
        if (ownership.amount == 0) {
            userAssets[order.seller].push(assetId);
        }
        ownership.owner = order.seller;
        ownership.tokenId = assetId;
        ownership.amount += order.amount;
        ownership.backedTokens += order.backedAmount;

        // Return escrowed tokens to seller
        _transfer(address(this), order.seller, order.amount);

        order.isActive = false;
    }

    // ============ Compliance ============

    function verifyCompliance(address user) external onlyOwner {
        // KYC/AML check
        emit ComplianceCheck(user, true);
    }

    /// @notice P2P transfer of fractional tokens. The funded/backed flag rides
    ///         along with the tokens, so the recipient keeps the buy-back right
    ///         only for the backed portion the contract was paid for.
    function transferWithCompliance(
        uint256 assetId,
        address to,
        uint256 amount
    ) external whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be > 0");

        FractionalOwnership storage senderOwnership = fractionalOwnership[assetId][msg.sender];
        require(senderOwnership.amount >= amount, "Insufficient fractional ownership");

        uint256 backedTransfer = senderOwnership.backedTokens >= amount ? amount : senderOwnership.backedTokens;

        // Update fractional ownership records
        senderOwnership.amount -= amount;
        senderOwnership.backedTokens -= backedTransfer;
        if (senderOwnership.amount == 0) {
            _removeUserAsset(msg.sender, assetId);
        }

        FractionalOwnership storage recipientOwnership = fractionalOwnership[assetId][to];
        if (recipientOwnership.amount == 0) {
            userAssets[to].push(assetId);
        }
        recipientOwnership.owner = to;
        recipientOwnership.tokenId = assetId;
        recipientOwnership.amount += amount;
        recipientOwnership.backedTokens += backedTransfer;
        recipientOwnership.purchasedAt = block.timestamp;

        _transfer(msg.sender, to, amount);
    }

    /// @notice Disabled. TXAT fractions are tracked per-asset in the
    ///         fractionalOwnership ledger (and their buy-back backing in
    ///         backedTokens), so plain ERC20 transfers would move tokens
    ///         without updating that ledger and desynchronize it from the
    ///         ERC20 balance. Use transferWithCompliance(assetId, to, amount)
    ///         instead, which keeps the ledgers in sync.
    function transfer(address, uint256) public virtual override returns (bool) {
        revert("AssetToken: plain ERC20 transfers disabled - use transferWithCompliance(assetId, to, amount)");
    }

    /// @notice Disabled for the same reason as transfer().
    function transferFrom(address, address, uint256) public virtual override returns (bool) {
        revert("AssetToken: plain ERC20 transferFrom disabled - use transferWithCompliance(assetId, to, amount)");
    }

    // ============ View Functions ============

    function getAsset(uint256 assetId) external view returns (Asset memory) {
        return assets[assetId];
    }

    /// @notice Outstanding (minted, not yet sold back) fraction count for an asset.
    function getIssuedTokens(uint256 assetId) external view returns (uint256) {
        return issuedTokens[assetId];
    }

    function getFractionalOwnership(uint256 assetId, address owner) external view returns (FractionalOwnership memory) {
        return fractionalOwnership[assetId][owner];
    }

    function getTradeOrders(uint256 assetId) external view returns (TradeOrder[] memory) {
        return tradeOrders[assetId];
    }

    function getActiveTradeOrders(uint256 assetId) external view returns (TradeOrder[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < tradeOrders[assetId].length; i++) {
            if (tradeOrders[assetId][i].isActive) {
                activeCount++;
            }
        }

        TradeOrder[] memory activeOrders = new TradeOrder[](activeCount);
        uint256 index = 0;
        for (uint256 i = 0; i < tradeOrders[assetId].length; i++) {
            if (tradeOrders[assetId][i].isActive) {
                activeOrders[index] = tradeOrders[assetId][i];
                index++;
            }
        }

        return activeOrders;
    }

    function getTotalAssets() external view returns (uint256) {
        return _assetCounter;
    }

    function getTotalTradeOrders() external view returns (uint256) {
        return _tradeOrderCounter;
    }

    function _removeUserAsset(address user, uint256 assetId) internal {
        uint256[] storage userAssetList = userAssets[user];
        for (uint256 i = 0; i < userAssetList.length; i++) {
            if (userAssetList[i] == assetId) {
                userAssetList[i] = userAssetList[userAssetList.length - 1];
                userAssetList.pop();
                break;
            }
        }
    }

    function getUserAssets(address user) external view returns (uint256[] memory) {
        return userAssets[user];
    }

    // ============ Emergency Functions ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {}
}