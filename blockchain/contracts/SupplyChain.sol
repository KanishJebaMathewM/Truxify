// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SupplyChain is Ownable, Pausable, ReentrancyGuard {
    
    // ============ Structs ============

<<<<<<< HEAD
=======
    /// @dev Strict, forward-only lifecycle for shipments. Transitions must
    ///      advance one step at a time: Created -> InTransit -> Arrived ->
    ///      Delivered. The only terminal branch is Created -> Cancelled.
    enum ShipmentStatus { Created, InTransit, Arrived, Delivered, Cancelled }

>>>>>>> upstream/main
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
<<<<<<< HEAD
        string status; // CREATED, IN_TRANSIT, DELIVERED
        string location;
        bytes32 shipmentHash;
        bool isActive;
=======
        string status; // CREATED, IN_TRANSIT, ARRIVED, DELIVERED, CANCELLED
        string location;
        bytes32 shipmentHash;
        bool isActive;
        uint256 updatedAt;
        address verifiedBy;
        uint256 verifiedAt;
>>>>>>> upstream/main
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
<<<<<<< HEAD
=======
    mapping(uint256 => ShipmentStatus[]) public shipmentStatusHistory;
>>>>>>> upstream/main
    mapping(uint256 => TraceEvent[]) public productEvents;
    mapping(uint256 => Verification[]) public productVerifications;
    mapping(uint256 => uint256[]) public productShipments;

<<<<<<< HEAD
=======
    /// @dev Independent parties allowed to verify shipments. A verifier must
    ///      not be the sender or receiver of the shipment it attests.
    mapping(address => bool) public verifiers;

>>>>>>> upstream/main
    uint256 private _productCounter;
    uint256 private _shipmentCounter;
    uint256 private _eventCounter;
    uint256 private _verificationCounter;

    uint256 public constant MAX_PRODUCTS = 1000000;

    // Events
    event ProductCreated(uint256 indexed productId, string name, address indexed manufacturer);
    event ProductUpdated(uint256 indexed productId, string name);
    event ShipmentCreated(uint256 indexed shipmentId, uint256 productId, address indexed sender);
<<<<<<< HEAD
    event ShipmentDelivered(uint256 indexed shipmentId, uint256 productId, address indexed receiver);
=======
    event ShipmentStatusUpdated(uint256 indexed shipmentId, ShipmentStatus status, address indexed actor);
    event ShipmentDelivered(uint256 indexed shipmentId, uint256 productId, address indexed receiver);
    event ShipmentVerified(uint256 indexed shipmentId, address indexed verifier, uint256 timestamp);
    event VerifierUpdated(address indexed verifier, bool allowed);
>>>>>>> upstream/main
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
        require(_productCounter < MAX_PRODUCTS, "Max products reached");

        _productCounter++;
        uint256 productId = _productCounter;

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
        require(products[productId].manufacturer == msg.sender || msg.sender == owner(), "Not authorized");

        _shipmentCounter++;
        uint256 shipmentId = _shipmentCounter;

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
<<<<<<< HEAD
            isActive: true
        });

=======
            isActive: true,
            updatedAt: block.timestamp,
            verifiedBy: address(0),
            verifiedAt: 0
        });

        shipmentStatusHistory[shipmentId].push(ShipmentStatus.Created);

>>>>>>> upstream/main
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
<<<<<<< HEAD
        require(shipments[shipmentId].isActive, "Shipment not active");
        require(msg.sender == shipments[shipmentId].sender || msg.sender == shipments[shipmentId].receiver || msg.sender == owner(), "Not authorized");

        shipments[shipmentId].status = status;
        shipments[shipmentId].location = location;

        if (keccak256(bytes(status)) == keccak256(bytes("DELIVERED"))) {
            shipments[shipmentId].receivedAt = block.timestamp;
        }

        _addTraceEvent(
            shipments[shipmentId].productId,
=======
        Shipment storage s = shipments[shipmentId];
        require(s.isActive, "Shipment not active");
        require(msg.sender == s.sender || msg.sender == s.receiver || msg.sender == owner(), "Not authorized");

        ShipmentStatus currentStatus = _currentStatus(shipmentId);
        ShipmentStatus newStatus = _parseStatus(status);
        require(_isValidTransition(currentStatus, newStatus), "Invalid transition");

        s.status = status;
        s.location = location;
        s.updatedAt = block.timestamp;

        if (newStatus == ShipmentStatus.Delivered) {
            s.receivedAt = block.timestamp;
        }

        // Append-only status history: past states can never be rewritten.
        shipmentStatusHistory[shipmentId].push(newStatus);

        _addTraceEvent(
            s.productId,
>>>>>>> upstream/main
            shipmentId,
            status,
            location,
            string(abi.encodePacked("Shipment status updated to ", status)),
            msg.sender
        );
<<<<<<< HEAD
=======

        emit ShipmentStatusUpdated(shipmentId, newStatus, msg.sender);
        if (newStatus == ShipmentStatus.Delivered) {
            emit ShipmentDelivered(shipmentId, s.productId, s.receiver);
        }
    }

    /**
     * @dev Strict forward state machine: Created -> InTransit -> Arrived ->
     *      Delivered, with only Created -> Cancelled as a terminal branch.
     *      Backwards and skipped transitions are never allowed, so the ledger
     *      always reflects reality.
     */
    function _isValidTransition(
        ShipmentStatus current,
        ShipmentStatus next
    ) internal pure returns (bool) {
        if (next == ShipmentStatus.Cancelled) {
            // Only a created shipment may be cancelled.
            return current == ShipmentStatus.Created;
        }
        // Otherwise the status must advance exactly one step forward.
        return uint256(next) == uint256(current) + 1;
    }

    function _currentStatus(uint256 shipmentId) internal view returns (ShipmentStatus) {
        ShipmentStatus[] storage history = shipmentStatusHistory[shipmentId];
        require(history.length > 0, "No status history");
        return history[history.length - 1];
    }

    function _parseStatus(string memory status) internal pure returns (ShipmentStatus) {
        bytes32 h = keccak256(bytes(status));
        if (h == keccak256(bytes("CREATED"))) return ShipmentStatus.Created;
        if (h == keccak256(bytes("IN_TRANSIT"))) return ShipmentStatus.InTransit;
        if (h == keccak256(bytes("ARRIVED"))) return ShipmentStatus.Arrived;
        if (h == keccak256(bytes("DELIVERED"))) return ShipmentStatus.Delivered;
        if (h == keccak256(bytes("CANCELLED"))) return ShipmentStatus.Cancelled;
        revert("Invalid status");
>>>>>>> upstream/main
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
        _eventCounter++;
        uint256 eventId = _eventCounter;

        TraceEvent memory traceEvent = TraceEvent({
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

        productEvents[productId].push(traceEvent);

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

<<<<<<< HEAD
=======
    /**
     * @dev Owner registers or removes an independent verifier (e.g. an oracle
     *      or third-party verifier role) allowed to attest shipments.
     */
    function setVerifier(address verifier, bool allowed) external onlyOwner {
        require(verifier != address(0), "Invalid verifier address");
        verifiers[verifier] = allowed;
        emit VerifierUpdated(verifier, allowed);
    }

    /**
     * @dev Verifies a shipment as an authorized, independent verifier. The
     *      verifier must not be the shipment's sender or receiver, so a
     *      carrier/shipper can never self-attest its own delivery.
     */
    function verifyShipment(uint256 shipmentId) external whenNotPaused {
        Shipment storage s = shipments[shipmentId];
        require(s.isActive, "Shipment not active");
        require(verifiers[msg.sender], "Not an authorized verifier");
        require(msg.sender != s.sender && msg.sender != s.receiver, "Self verification not allowed");

        s.verifiedBy = msg.sender;
        s.verifiedAt = block.timestamp;

        emit ShipmentVerified(shipmentId, msg.sender, block.timestamp);
    }

>>>>>>> upstream/main
    function verifyProduct(
        uint256 productId,
        bool isValid,
        string memory notes
    ) external whenNotPaused {
        require(products[productId].isActive, "Product not active");
        require(products[productId].manufacturer == msg.sender || msg.sender == owner(), "Not authorized");

        _verificationCounter++;
        uint256 verificationId = _verificationCounter;

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

<<<<<<< HEAD
=======
    function getShipmentStatusHistory(uint256 shipmentId) external view returns (ShipmentStatus[] memory) {
        return shipmentStatusHistory[shipmentId];
    }

>>>>>>> upstream/main
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
        return _productCounter;
    }

    function getTotalShipments() external view returns (uint256) {
        return _shipmentCounter;
    }

    function getTotalEvents() external view returns (uint256) {
        return _eventCounter;
    }

    function getTotalVerifications() external view returns (uint256) {
        return _verificationCounter;
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