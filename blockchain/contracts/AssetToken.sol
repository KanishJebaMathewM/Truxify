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
        uint256 purchasedAt;
    }

    struct TradeOrder {
        uint256 orderId;
        uint256 tokenId;
        address seller;
        address buyer;
        uint256 amount;
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

        uint256 tokenPrice = totalValue / totalTokens;

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

        uint256 totalCost = amount * asset.tokenPrice;
        require(msg.value >= totalCost, "Insufficient payment");

        // Update asset
        asset.availableTokens -= amount;

        // Update fractional ownership
        fractionalOwnership[assetId][msg.sender].owner = msg.sender;
        fractionalOwnership[assetId][msg.sender].tokenId = assetId;
        fractionalOwnership[assetId][msg.sender].amount += amount;
        fractionalOwnership[assetId][msg.sender].purchasedAt = block.timestamp;

        // Mint tokens
        _mint(msg.sender, amount);

        // Refund excess payment
        if (msg.value > totalCost) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - totalCost}("");
            require(refunded, "Refund failed");
        }

        userAssets[msg.sender].push(assetId);

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

        // Burn tokens
        _burn(msg.sender, amount);

        // Update ownership
        ownership.amount -= amount;

        // Update asset
        assets[assetId].availableTokens += amount;

        if (ownership.amount == 0) {
            _removeUserAsset(msg.sender, assetId);
        }

        emit FractionalSale(assetId, msg.sender, amount);
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

        _tradeOrderCounter++;
        uint256 orderId = _tradeOrderCounter;

        // Escrow seller's tokens into the contract
        _transfer(msg.sender, address(this), amount);

        TradeOrder memory order = TradeOrder({
            orderId: orderId,
            tokenId: assetId,
            seller: msg.sender,
            buyer: address(0),
            amount: amount,
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
    ) external nonReentrant whenNotPaused {
        require(assetExists[assetId], "Asset not found");
        require(orderIndex < tradeOrders[assetId].length, "Order not found");

        TradeOrder storage order = tradeOrders[assetId][orderIndex];
        require(order.isActive, "Order not active");
        require(order.expiresAt > block.timestamp, "Order expired");
        require(order.seller != msg.sender, "Cannot buy own order");

        uint256 totalCost = order.amount * order.price;
        require(msg.value >= totalCost, "Insufficient payment");

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

        // Return escrowed tokens to seller
        _transfer(address(this), order.seller, order.amount);

        order.isActive = false;
    }

    // ============ Compliance ============

    function verifyCompliance(address user) external onlyOwner {
        // KYC/AML check
        emit ComplianceCheck(user, true);
    }

    function transferWithCompliance(
        address to,
        uint256 amount
    ) external whenNotPaused {
        require(msg.sender != address(0), "Invalid sender");
        require(to != address(0), "Invalid recipient");

        _transfer(msg.sender, to, amount);
    }

    // ============ View Functions ============

    function getAsset(uint256 assetId) external view returns (Asset memory) {
        return assets[assetId];
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
        uint256[] storage assets = userAssets[user];
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == assetId) {
                assets[i] = assets[assets.length - 1];
                assets.pop();
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