// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ColdChainSLAEscrow is ReentrancyGuard, Ownable {
    // State variables
    mapping(bytes32 => ShipmentSLA) public shipmentSLAs;
    mapping(bytes32 => bool) public isDisputed;

    struct ShipmentSLA {
        address shipper;
        address carrier;
        uint256 deposit;
        uint256 minTemp;
        uint256 maxTemp;
        bool completed;
        bool slashed;
    }

    event SLACreated(bytes32 indexed shipmentId, address indexed shipper, address indexed carrier, uint256 deposit);
    event SLAResolved(bytes32 indexed shipmentId, bool slashed);

    constructor() Ownable(msg.sender) {}

    function createSLA(
        bytes32 shipmentId,
        address carrier,
        uint256 minTemp,
        uint256 maxTemp
    ) external payable {
        require(msg.value > 0, "Deposit required");
        require(shipmentSLAs[shipmentId].shipper == address(0), "SLA already exists");

        shipmentSLAs[shipmentId] = ShipmentSLA({
            shipper: msg.sender,
            carrier: carrier,
            deposit: msg.value,
            minTemp: minTemp,
            maxTemp: maxTemp,
            completed: false,
            slashed: false
        });

        emit SLACreated(shipmentId, msg.sender, carrier, msg.value);
    }

    function completeShipment(bytes32 shipmentId, int256 recordedTemp) external nonReentrant {
        ShipmentSLA storage sla = shipmentSLAs[shipmentId];
        require(msg.sender == sla.shipper || msg.sender == owner(), "Not authorized");
        require(!sla.completed, "Already completed");

        sla.completed = true;

        if (recordedTemp < int256(sla.minTemp) || recordedTemp > int256(sla.maxTemp)) {
            sla.slashed = true;
            (bool success, ) = sla.shipper.call{value: sla.deposit}("");
            require(success, "Transfer to shipper failed");
            emit SLAResolved(shipmentId, true);
        } else {
            (bool success, ) = sla.carrier.call{value: sla.deposit}("");
            require(success, "Transfer to carrier failed");
            emit SLAResolved(shipmentId, false);
        }
    }
}