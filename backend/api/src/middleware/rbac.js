const { createClient } = require('@supabase/supabase-js');
const { can } = require('../policies/roles');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const requireAuthorization = (resourceType, action, idParam = 'id') => {
    return async (req, res, next) => {
        if (!req.user || !req.user.uid) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const resourceId = req.params[idParam];
        if (!resourceId) {
            return res.status(400).json({ error: 'Resource ID is required for authorization check' });
        }

        let resource;

        try {
            if (resourceType === 'orders') {
                const { data, error } = await supabase
                    .from('bookings')
                    .select('*')
                    .eq('id', resourceId)
                    .single();

                if (error || !data) {
                    return res.status(404).json({ error: 'Order not found' });
                }
                resource = data;
            } else if (resourceType === 'bids') {
                const { data, error } = await supabase
                    .from('bids')
                    .select('*')
                    .eq('id', resourceId)
                    .single();

                if (error || !data) {
                    return res.status(404).json({ error: 'Bid not found' });
                }
                resource = data;
            } else {
                return res.status(500).json({ error: 'Unsupported resource type for RBAC' });
            }

            const isAllowed = can(req.user, action, resourceType, resource);

            if (!isAllowed) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have permission to perform this action on this resource.'
                });
            }

            req.resource = resource;
            next();
        } catch (err) {
            console.error('RBAC Middleware Error:', err.message);
            return res.status(500).json({ error: 'Internal server error during authorization' });
        }
    };
};

module.exports = {
    requireAuthorization,
};
