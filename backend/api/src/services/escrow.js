const provider = escrowContract.runner.provider
  const receipt = await provider.waitForTransaction(txHash, 1, 60_000)
  if (!receipt || receipt.status === 0) {
    throw new Error('Escrow refund transaction reverted or was not found on chain.')
  }
  logger.info(`[escrow] Refund transaction confirmed: ${txHash}`)
  return { txHash: receipt.hash, success: true }
  });
}

/**
 * Derive the unique bytes32 booking ID from an order's display ID.
 *
 * @param {string} orderDisplayId
 * @returns {string} bytes32 hex string
 */
export function getEscrowBookingId (orderDisplayId) {
  if (!orderDisplayId) {
    throw new TypeError('orderDisplayId is required to generate escrow booking ID')
  }
  return ethers.keccak256(ethers.toUtf8Bytes(String(orderDisplayId)))
}
