// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract SupplyChain is Ownable, Pausable, ReentrancyGuard {
    using Counters for Counters.Counter;

    // ============ Structs ============

    struct Product {
        uint256 id;
        string name;
        string description;
        string category;
        address manufacturer;
        uint256 manufacturedAt;
        uint256 createdAt;
        bool isActive;
        string metadataURI;
        bytes32 productHash;
    }

    struct Shipment {
        uint256 id;
        uint256 productId;
        address sender;
        address receiver;
        uint256 sentAt;
        uint256 receivedAt;
        string status; // CREATED, IN_TRANSIT, DELIVERED
        string location;
        bytes32 shipmentHash;
        bool isActive;
    }

    struct TraceEvent {
        uint256 id;
        uint256 productId;
        uint256 shipmentId;
        string eventType; // MANUFACTURED, SHIPPED, IN_TRANSIT, DELIVERED, INSPECTED
        string location;
        string description;
        address actor;
        uint256 timestamp;
        bytes32 eventHash;
    }

    struct Verification {
        uint256 id;
        uint256 productId;
        address verifier;
        uint256 verifiedAt;
        bool isValid;
        string notes;
        bytes32 verificationHash;
    }

    // ============ State Variables ============

    mapping(uint256 => Product) public products;
    mapping(uint256 => Shipment) public shipments;
    mapping(uint256 => TraceEvent[]) public productEvents;
    mapping(uint256 => Verification[]) public productVerifications;
    mapping(uint256 => uint256[]) public productShipments;

    Counters.Counter private _productCounter;
    Counters.Counter private _shipmentCounter;
    Counters.Counter private _eventCounter;
    Counters.Counter private _verificationCounter;

    uint256 public constant MAX_PRODUCTS = 1000000;

    // Events
    event ProductCreated(uint256 indexed productId, string name, address indexed manufacturer);
    event ProductUpdated(uint256 indexed productId, string name);
    event ShipmentCreated(uint256 indexed shipmentId, uint256 productId, address indexed sender);
    event ShipmentDelivered(uint256 indexed shipmentId, uint256 productId, address indexed receiver);
    event TraceEventAdded(uint256 indexed eventId, uint256 productId, string eventType);
    event ProductVerified(uint256 indexed verificationId, uint256 productId, bool isValid);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Product Management ============

    function createProduct(
        string memory name,
        string memory description,
        string memory category,
        string memory metadataURI,
        bytes32 productHash
    ) external whenNotPaused returns (uint256) {
        require(bytes(name).length > 0, "Name required");
        require(_productCounter.current() < MAX_PRODUCTS, "Max products reached");

        _productCounter.increment();
        uint256 productId = _productCounter.current();

        products[productId] = Product({
            id: productId,
            name: name,
            description: description,
            category: category,
            manufacturer: msg.sender,
            manufacturedAt: block.timestamp,
            createdAt: block.timestamp,
            isActive: true,
            metadataURI: metadataURI,
            productHash: productHash
        });

        // Add initial event
        _addTraceEvent(productId, 0, "MANUFACTURED", "Manufacturing facility", "Product created", msg.sender);

        emit ProductCreated(productId, name, msg.sender);
        return productId;
    }

    function updateProduct(
        uint256 productId,
        string memory name,
        string memory description,
        string memory metadataURI,
        bytes32 productHash
    ) external whenNotPaused {
        require(products[productId].isActive, "Product not active");
        require(products[productId].manufacturer == msg.sender || msg.sender == owner(), "Not authorized");

        products[productId].name = name;
        products[productId].description = description;
        products[productId].metadataURI = metadataURI;
        products[productId].productHash = productHash;

        emit ProductUpdated(productId, name);
    }

    // ============ Shipment Management ============

    function createShipment(
        uint256 productId,
        address receiver,
        string memory location
    ) external whenNotPaused returns (uint256) {
        require(products[productId].isActive, "Product not active");
        require(receiver != address(0), "Invalid receiver");

        _shipmentCounter.increment();
        uint256 shipmentId = _shipmentCounter.current();

        shipments[shipmentId] = Shipment({
            id: shipmentId,
            productId: productId,
            sender: msg.sender,
            receiver: receiver,
            sentAt: block.timestamp,
            receivedAt: 0,
            status: "CREATED",
            location: location,
            shipmentHash: keccak256(abi.encodePacked(productId, msg.sender, receiver, block.timestamp)),
            isActive: true
        });

        productShipments[productId].push(shipmentId);

        _addTraceEvent(productId, shipmentId, "SHIPPED", location, "Shipment created", msg.sender);

        emit ShipmentCreated(shipmentId, productId, msg.sender);
        return shipmentId;
    }

    function updateShipmentStatus(
        uint256 shipmentId,
        string memory status,
        string memory location
    ) external whenNotPaused {
        require(shipments[shipmentId].isActive, "Shipment not active");
        require(msg.sender == shipments[shipmentId].sender || msg.sender == shipments[shipmentId].receiver || msg.sender == owner(), "Not authorized");

        shipments[shipmentId].status = status;
        shipments[shipmentId].location = location;

        if (keccak256(bytes(status)) == keccak256(bytes("DELIVERED"))) {
            shipments[shipmentId].receivedAt = block.timestamp;
        }

        _addTraceEvent(
            shipments[shipmentId].productId,
            shipmentId,
            status,
            location,
            string(abi.encodePacked("Shipment status updated to ", status)),
            msg.sender
        );
    }

    // ============ Trace Events ============

    function _addTraceEvent(
        uint256 productId,
        uint256 shipmentId,
        string memory eventType,
        string memory location,
        string memory description,
        address actor
    ) internal {
        _eventCounter.increment();
        uint256 eventId = _eventCounter.current();

        TraceEvent memory event = TraceEvent({
            id: eventId,
            productId: productId,
            shipmentId: shipmentId,
            eventType: eventType,
            location: location,
            description: description,
            actor: actor,
            timestamp: block.timestamp,
            eventHash: keccak256(abi.encodePacked(productId, shipmentId, eventType, location, block.timestamp))
        });

        productEvents[productId].push(event);

        emit TraceEventAdded(eventId, productId, eventType);
    }

    function addCustomEvent(
        uint256 productId,
        string memory eventType,
        string memory location,
        string memory description
    ) external whenNotPaused {
        require(products[productId].isActive, "Product not active");
        require(products[productId].manufacturer == msg.sender || msg.sender == owner(), "Not authorized");

        _addTraceEvent(productId, 0, eventType, location, description, msg.sender);
    }

    // ============ Verification ============

    function verifyProduct(
        uint256 productId,
        bool isValid,
        string memory notes
    ) external whenNotPaused {
        require(products[productId].isActive, "Product not active");

        _verificationCounter.increment();
        uint256 verificationId = _verificationCounter.current();

        Verification memory verification = Verification({
            id: verificationId,
            productId: productId,
            verifier: msg.sender,
            verifiedAt: block.timestamp,
            isValid: isValid,
            notes: notes,
            verificationHash: keccak256(abi.encodePacked(productId, msg.sender, isValid, block.timestamp))
        });

        productVerifications[productId].push(verification);

        emit ProductVerified(verificationId, productId, isValid);
    }

    // ============ View Functions ============

    function getProduct(uint256 productId) external view returns (Product memory) {
        return products[productId];
    }

    function getShipment(uint256 shipmentId) external view returns (Shipment memory) {
        return shipments[shipmentId];
    }

    function getProductEvents(uint256 productId) external view returns (TraceEvent[] memory) {
        return productEvents[productId];
    }

    function getProductVerifications(uint256 productId) external view returns (Verification[] memory) {
        return productVerifications[productId];
    }

    function getProductShipments(uint256 productId) external view returns (uint256[] memory) {
        return productShipments[productId];
    }

    function getProductTrace(uint256 productId) external view returns (
        Product memory,
        TraceEvent[] memory,
        Verification[] memory
    ) {
        return (products[productId], productEvents[productId], productVerifications[productId]);
    }

    function getShipmentTrace(uint256 shipmentId) external view returns (
        Shipment memory,
        TraceEvent[] memory
    ) {
        uint256 productId = shipments[shipmentId].productId;
        TraceEvent[] memory events = productEvents[productId];
        
        // Filter events for this shipment
        uint256 count = 0;
        for (uint256 i = 0; i < events.length; i++) {
            if (events[i].shipmentId == shipmentId) {
                count++;
            }
        }
        
        TraceEvent[] memory filteredEvents = new TraceEvent[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < events.length; i++) {
            if (events[i].shipmentId == shipmentId) {
                filteredEvents[index] = events[i];
                index++;
            }
        }
        
        return (shipments[shipmentId], filteredEvents);
    }

    function getTotalProducts() external view returns (uint256) {
        return _productCounter.current();
    }

    function getTotalShipments() external view returns (uint256) {
        return _shipmentCounter.current();
    }

    function getTotalEvents() external view returns (uint256) {
        return _eventCounter.current();
    }

    function getTotalVerifications() external view returns (uint256) {
        return _verificationCounter.current();
    }

    // ============ Admin Functions ============

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Receive ============

    receive() external payable {}
}