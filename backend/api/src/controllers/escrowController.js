const escrowService = require('../services/escrowService');

const depositEscrow = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { bookingId, amount, driverWalletAddress } = req.body;

        if (!bookingId || !amount || !driverWalletAddress) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'bookingId, amount, and driverWalletAddress are required'
            });
        }

        const result = await escrowService.initiateEscrowDeposit(
            userId,
            bookingId,
            amount,
            driverWalletAddress
        );

        return res.status(200).json({
            success: true,
            message: 'Escrow deposit initiated successfully',
            data: result,
        });
    } catch (error) {
    if (error.message.includes('greater than zero') || error.message.includes('valid number')) {
        return res.status(400).json({ error: error.message });
    }
    if (error.message.includes('Unauthorized') || error.message.includes('not found')) {
        return res.status(403).json({ error: error.message });
    }

    console.error('Escrow deposit controller error:', error.message);
    return res.status(500).json({
        error: 'Failed to process escrow deposit',
        details: error.message
    });
}
};

const releaseEscrow = async (req, res) => {
    try {
        const userId = req.user.uid;
        const { bookingId } = req.params;

        if (!bookingId) {
            return res.status(400).json({ error: 'bookingId is required' });
        }

        const result = await escrowService.releaseEscrowFunds(userId, bookingId);

        return res.status(200).json({
            success: true,
            message: 'Escrow funds released successfully',
            data: result,
        });
    } catch (error) {
        if (error.message.includes('Unauthorized') || error.message.includes('not found') || error.message.includes('can only be released')) {
            return res.status(403).json({ error: error.message });
        }

        console.error('Escrow release controller error:', error.message);
        return res.status(500).json({
            error: 'Failed to release escrow funds',
            details: error.message
        });
    }
};

module.exports = {
    depositEscrow,
    releaseEscrow,
};
