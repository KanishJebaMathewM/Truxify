const ROLES = {
    CUSTOMER: 'customer',
    DRIVER: 'driver',
    ADMIN: 'admin',
};

const POLICIES = {
    orders: {
        read: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.CUSTOMER && resource.customer_id === user.uid) return true;
            if (user.role === ROLES.DRIVER && resource.driver_id === user.uid) return true;
            return false;
        },
        update: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.CUSTOMER && resource.customer_id === user.uid && resource.status === 'pending') return true;
            return false;
        },
        delete: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.CUSTOMER && resource.customer_id === user.uid && resource.status === 'pending') return true;
            return false;
        },
        accept: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.DRIVER && resource.status === 'pending') return true;
            return false;
        },
    },
    bids: {
        read: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.DRIVER && resource.driver_id === user.uid) return true;
            if (user.role === ROLES.CUSTOMER && resource.customer_id === user.uid) return true;
            return false;
        },
        create: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.DRIVER) return true;
            return false;
        },
        update: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.DRIVER && resource.driver_id === user.uid && resource.status === 'pending') return true;
            return false;
        },
        delete: (user, resource) => {
            if (user.role === ROLES.ADMIN) return true;
            if (user.role === ROLES.DRIVER && resource.driver_id === user.uid && resource.status === 'pending') return true;
            return false;
        },
    },
};

const can = (user, action, resourceType, resource) => {
    const policy = POLICIES[resourceType];
    if (!policy || !policy[action]) {
        return false;
    }
    return policy[action](user, resource);
};

module.exports = {
    ROLES,
    POLICIES,
    can,
};
