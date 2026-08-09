import { ethers } from 'ethers';
import logger from '../../middleware/logger.js';

// Real getters exposed by blockchain/contracts/TruxifyEscrow.sol.
const ESCROW_ABI = [
  'function getBooking(uint256 bookingId) view returns (address payable customer, address payable driver, uint256 amount, uint8 status, bool paid, bool started, uint256 createdAt, uint256 disputedAt)',
  'function pendingWithdrawals(address account) view returns (uint256)',
];

// Real getter exposed by blockchain/contracts/Reputation.sol.
const REPUTATION_ABI = [
  'function getReputation(address driver) view returns (uint256)',
];

class BatchCallBuilder {
  constructor(deps = {}) {
    this.escrowAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    this.reputationAddress = process.env.REPUTATION_CONTRACT_ADDRESS;
    this.provider = deps.provider;
    this.escrowIface = new ethers.Interface(ESCROW_ABI);
    this.reputationIface = new ethers.Interface(REPUTATION_ABI);
  }

  buildPaymentStatusCall(bookingId) {
    return {
      target: this.escrowAddress,
      callData: this.escrowIface.encodeFunctionData('getBooking', [bookingId]),
      decodeFn: (data) => {
        const decoded = this.escrowIface.decodeFunctionResult('getBooking', data);
        return { status: decoded.status };
      },
    };
  }

  buildDriverBalanceCall(driver) {
    return {
      target: this.escrowAddress,
      callData: this.escrowIface.encodeFunctionData('pendingWithdrawals', [driver]),
      decodeFn: (data) => {
        const decoded = this.escrowIface.decodeFunctionResult('pendingWithdrawals', data);
        return { balance: decoded[0].toString() };
      },
    };
  }

  buildReputationCall(driver) {
    return {
      target: this.reputationAddress || this.escrowAddress,
      callData: this.reputationIface.encodeFunctionData('getReputation', [driver]),
      decodeFn: (data) => {
        const decoded = this.reputationIface.decodeFunctionResult('getReputation', data);
        return { score: decoded[0].toString() };
      },
    };
  }

  buildShipmentCompletionBatch(shipment) {
    return [
      this.buildPaymentStatusCall(shipment.bookingId),
      this.buildDriverBalanceCall(shipment.driverAddress),
      this.buildReputationCall(shipment.driverAddress),
    ];
  }

  buildMultiShipmentBatch(shipments) {
    const allCalls = [];

    shipments.forEach(shipment => {
      const batchCalls = this.buildShipmentCompletionBatch(shipment);
      batchCalls.forEach(call => {
        call.shipmentId = shipment.id;
      });
      allCalls.push(...batchCalls);
    });

    return allCalls;
  }

  _ifaceFor(target) {
    if (this.reputationAddress && target === this.reputationAddress) {
      return this.reputationIface;
    }
    return this.escrowIface;
  }

  buildCustomBatch(callDefinitions) {
    return callDefinitions.map(def => {
      try {
        const functionName = def.functionName;
        const args = def.args || [];
        const target = def.target || this.escrowAddress;
        const iface = this._ifaceFor(target);

        return {
          target,
          callData: iface.encodeFunctionData(functionName, args),
          decodeFn: (data) => {
            try {
              const result = iface.decodeFunctionResult(functionName, data);
              return {
                functionName,
                result: result[0]?.toString?.() || result[0],
              };
            } catch (err) {
              logger.warn('[BatchCallBuilder] Failed to decode result:', err.message);
              return { error: err.message };
            }
          },
          ...def,
        };
      } catch (err) {
        logger.error('[BatchCallBuilder] Error building call:', err.message);
        return { error: err.message };
      }
    });
  }
}

export { ESCROW_ABI, REPUTATION_ABI };
export default BatchCallBuilder;
