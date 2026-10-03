const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const requireEscrowPermissions = async (req, res, next) => {
    try {
        const userId = req.user.uid;

        const { data: profile, error } = await supabase
            .from('profiles')
            .select('role, wallet_address')
            .eq('id', userId)
            .single();

        if (error || !profile) {
            return res.status(404).json({ error: 'User profile not found' });
        }

        if (!profile.wallet_address) {
            return res.status(400).json({
                error: 'Wallet not linked',
                message: 'You must link a wallet address to your profile to use escrow services'
            });
        }

        req.userProfile = profile;
        next();
    } catch (err) {
        console.error('Escrow auth middleware error:', err.message);
        return res.status(500).json({ error: 'Internal server error during escrow authorization' });
    }
};

module.exports = requireEscrowPermissions;
