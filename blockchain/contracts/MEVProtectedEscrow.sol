// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MEVProtectedEscrow
 * @dev Protects high-value freight payment releases from front-running and MEV sandwich attacks via private relayer execution.
 */
contract MEVProtectedEscrow is ReentrancyGuard, Ownable {

    struct ProtectedDeposit {
        address payable shipper;
        address payable driver;
        uint256 amount;
        bool released;
        uint256 blockMin;
        bytes32 secretHash;
    }

    mapping(uint256 => ProtectedDeposit) public deposits;
    uint256 public depositCount;
    address public trustedRelayer;

    uint256 public constant REFUND_WINDOW = 5760;

    event DepositCreated(uint256 indexed depositId, address indexed shipper, address indexed driver, uint256 amount);
    event DepositReleasedMEV(uint256 indexed depositId, address indexed driver, uint256 amount);
    event DepositRefunded(uint256 indexed depositId, address indexed shipper, uint256 amount);
    event RelayerUpdated(address indexed newRelayer);

    modifier onlyRelayer() {
        require(msg.sender == trustedRelayer || msg.sender == owner(), "Caller is not trusted MEV relayer");
        _;
    }

    constructor(address _relayer) Ownable(msg.sender) {
        trustedRelayer = _relayer;
    }

    function updateRelayer(address _newRelayer) external onlyOwner {
        trustedRelayer = _newRelayer;
        emit RelayerUpdated(_newRelayer);
    }

    /**
     * @dev The SHIPPER is responsible for minting the secret preimage and
     * committing keccak256(preimage) as _secretHash. The relayer can only
     * release after it learns the preimage out of band (e.g. a private
     * Flashbots bundle); if it never does, refundDeposit returns the funds
     * after blockMin + REFUND_WINDOW.
     */
    function createProtectedDeposit(address payable _driver, bytes32 _secretHash) external payable returns (uint256 depositId) {
        require(msg.value > 0, "Deposit must be > 0");
        require(_driver != address(0), "Invalid driver address");

        depositId = ++depositCount;
        deposits[depositId] = ProtectedDeposit({
            shipper: payable(msg.sender),
            driver: _driver,
            amount: msg.value,
            released: false,
            blockMin: block.number,
            secretHash: _secretHash
        });

        emit DepositCreated(depositId, msg.sender, _driver, msg.value);
    }

    /**
     * @dev Private Flashbots bundle release function, enforcing block deadlines & preimage verification.
     */
    function releaseDepositPrivate(uint256 _depositId, bytes32 _preimage) external onlyRelayer nonReentrant {
        ProtectedDeposit storage dep = deposits[_depositId];
        require(!dep.released, "Already released");
        require(block.number >= dep.blockMin, "Release window not open");
        require(keccak256(abi.encodePacked(_preimage)) == dep.secretHash, "Invalid preimage");

        dep.released = true;
        uint256 amt = dep.amount;
        (bool success, ) = dep.driver.call{value: amt}("");
        require(success, "ETH transfer failed");

        emit DepositReleasedMEV(_depositId, dep.driver, amt);
    }

    /**
     * @dev Refunds a deposit to the shipper once the MEV-protection window has
     * elapsed without a release. Callable by anyone so a keeper can trigger the
     * refund even if the shipper is offline; funds always go to dep.shipper.
     */
    function refundDeposit(uint256 _depositId) external nonReentrant {
        ProtectedDeposit storage dep = deposits[_depositId];
        require(!dep.released, "Already released");
        require(block.number >= dep.blockMin + REFUND_WINDOW, "Refund window not open");

        dep.released = true;
        uint256 amt = dep.amount;
        (bool success, ) = dep.shipper.call{value: amt}("");
        require(success, "ETH transfer failed");

        emit DepositRefunded(_depositId, dep.shipper, amt);
    }
}