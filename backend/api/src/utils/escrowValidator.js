const ethers = require('ethers');

const MIN_DEPOSIT_AMOUNT = 0.0001;

const validateEscrowAmount = (amount) => {
    if (amount === undefined || amount === null) {
        throw new Error('Deposit amount is required');
    }

    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount)) {
        throw new Error('Deposit amount must be a valid number');
    }

    if (parsedAmount <= 0) {
        throw new Error('Deposit amount must be greater than zero. Zero-value transactions are rejected to prevent gas waste.');
    }

    if (parsedAmount < MIN_DEPOSIT_AMOUNT) {
        throw new Error(`Deposit amount must be at least ${MIN_DEPOSIT_AMOUNT} to cover minimum network requirements`);
    }

    return parsedAmount;
};

const validateBlockchainAddress = (address) => {
    if (!address || typeof address !== 'string') {
        throw new Error('Valid blockchain address is required');
    }

    try {
        const checksumAddress = ethers.getAddress(address);
        return checksumAddress;
    } catch (error) {
        throw new Error('Invalid Ethereum address format');
    }
};

const validateBookingId = (bookingId) => {
    if (!bookingId || typeof bookingId !== 'string' || bookingId.trim().length === 0) {
        throw new Error('Valid booking ID is required');
    }
    return bookingId.trim();
};

module.exports = {
    validateEscrowAmount,
    validateBlockchainAddress,
    validateBookingId,
    MIN_DEPOSIT_AMOUNT,
};
