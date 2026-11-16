const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');
const {
    validateEscrowAmount,
    validateBlockchainAddress,
    validateBookingId
} = require('../utils/escrowValidator');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const escrowContractAddress = process.env.ESCROW_CONTRACT_ADDRESS;

const ESCROW_ABI = [
    "function depositEscrow(bytes32 bookingId, address driver) payable",
    "function releaseEscrow(bytes32 bookingId)",
    "function getEscrowStatus(bytes32 bookingId) view returns (uint8, uint256, address, address)"
];

const getEscrowContract = (provider) => {
    const pk = process.env.ESCROW_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
    const wallet = new ethers.Wallet(pk, provider);
    return new ethers.Contract(escrowContractAddress, ESCROW_ABI, wallet);
};

const initiateEscrowDeposit = async (userId, bookingId, amount, driverWalletAddress) => {
    try {
        const validAmount = validateEscrowAmount(amount);
        const validBookingId = validateBookingId(bookingId);
        const validDriverAddress = validateBlockchainAddress(driverWalletAddress);

        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('id, customer_id, driver_id, status, total_amount')
            .eq('id', validBookingId)
            .single();

        if (bookingError || !booking) {
            throw new Error('Booking not found');
        }

        if (booking.customer_id !== userId) {
            throw new Error('Unauthorized: You are not the customer for this booking');
        }

        if (booking.status !== 'accepted') {
            throw new Error('Escrow can only be deposited for accepted bookings');
        }

        const amountWei = ethers.parseEther(validAmount.toString());
        const bookingIdBytes32 = ethers.id(validBookingId);

        let receipt;
        if (process.env.NODE_ENV === 'test') {
            const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
            const contract = getEscrowContract(provider);
            const tx = await contract.depositEscrow(bookingIdBytes32, validDriverAddress, {
                value: amountWei,
            });
            receipt = await tx.wait();
        } else {
            const { defaultRpcManager } = await import('./blockchain/rpcProviderManager.js');
            receipt = await defaultRpcManager.executeWithRetry(async (provider) => {
                const contract = getEscrowContract(provider);
                const tx = await contract.depositEscrow(bookingIdBytes32, validDriverAddress, {
                    value: amountWei,
                });
                return await tx.wait();
            });
        }

        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                escrow_deposited: true,
                escrow_amount: validAmount,
                escrow_tx_hash: receipt.hash,
                escrow_status: 'deposited',
                updated_at: new Date().toISOString(),
            })
            .eq('id', validBookingId);

        if (updateError) {
            console.error('Failed to update booking with escrow details:', updateError.message);
        }

        return {
            success: true,
            transactionHash: receipt.hash,
            amount: validAmount,
            bookingId: validBookingId,
        };
    } catch (error) {
        console.error('Escrow deposit service error:', error.message);
        throw error;
    }
};

const releaseEscrowFunds = async (userId, bookingId) => {
    try {
        const validBookingId = validateBookingId(bookingId);

        const { data: booking, error: bookingError } = await supabase
            .from('bookings')
            .select('id, customer_id, status, escrow_status')
            .eq('id', validBookingId)
            .single();

        if (bookingError || !booking) {
            throw new Error('Booking not found');
        }

        if (booking.customer_id !== userId) {
            throw new Error('Unauthorized: You are not the customer for this booking');
        }

        if (booking.status !== 'completed') {
            throw new Error('Escrow can only be released for completed bookings');
        }

        if (booking.escrow_status === 'released') {
            throw new Error('Escrow has already been released for this booking');
        }

        if (booking.escrow_status === 'releasing') {
            throw new Error('Escrow release is already in progress for this booking');
        }

        if (booking.escrow_status !== 'deposited') {
            throw new Error('No escrow deposit found for this booking');
        }

        // Atomic lock transition: prevents concurrent calls from double-releasing funds
        const { data: lockedBooking, error: lockError } = await supabase
            .from('bookings')
            .update({
                escrow_status: 'releasing',
                updated_at: new Date().toISOString(),
            })
            .eq('id', validBookingId)
            .eq('escrow_status', 'deposited')
            .select()
            .maybeSingle();

        if (lockError || !lockedBooking) {
            throw new Error('Escrow release is already in progress or has already been processed');
        }

        const bookingIdBytes32 = ethers.id(validBookingId);

        let receipt;
        try {
            if (process.env.NODE_ENV === 'test') {
                const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com');
                const contract = getEscrowContract(provider);
                const tx = await contract.releaseEscrow(bookingIdBytes32);
                receipt = await tx.wait();
            } else {
                const { defaultRpcManager } = await import('./blockchain/rpcProviderManager.js');
                receipt = await defaultRpcManager.executeWithRetry(async (provider) => {
                    const contract = getEscrowContract(provider);
                    const tx = await contract.releaseEscrow(bookingIdBytes32);
                    return await tx.wait();
                });
            }
        } catch (chainError) {
            // Roll back status from 'releasing' to 'deposited' so a retry is possible
            await supabase
                .from('bookings')
                .update({
                    escrow_status: 'deposited',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', validBookingId)
                .eq('escrow_status', 'releasing');

            throw chainError;
        }

        const { error: updateError } = await supabase
            .from('bookings')
            .update({
                escrow_status: 'released',
                escrow_released_at: new Date().toISOString(),
                escrow_release_tx_hash: receipt?.hash,
                updated_at: new Date().toISOString(),
            })
            .eq('id', validBookingId);

        if (updateError) {
            console.error('Failed to update booking escrow status:', updateError.message);
        }

        return {
            success: true,
            transactionHash: receipt?.hash,
            bookingId: validBookingId,
        };
    } catch (error) {
        console.error('Escrow release service error:', error.message);
        throw error;
    }
};

module.exports = {
    initiateEscrowDeposit,
    releaseEscrowFunds,
};
