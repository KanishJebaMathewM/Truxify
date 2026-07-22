export class PolicyError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PolicyError';
    this.status = status;
  }
}

const ROLES = Object.freeze({
  CUSTOMER: 'customer',
  DRIVER: 'driver',
  ADMIN: 'admin',
});

function roleAllowed(policyRoles, userRole) {
  if (!userRole) return false;
  if (!policyRoles || policyRoles.length === 0) return true;
  return policyRoles.includes(userRole);
}

const POLICIES = {
  'order:create':              { roles: [ROLES.CUSTOMER] },
  'order:view-active':         { roles: [ROLES.CUSTOMER] },
  'order:view-history':        { roles: [ROLES.CUSTOMER] },
  'order:view':                { ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === ROLES.ADMIN) },
  'order:view-timeline':       { ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === ROLES.ADMIN) },
  'order:view-bids':           { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:accept-bid':          { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:submit-rating':       { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:change-drop':         { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:cancel':              { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:confirm-deposit':     { roles: [ROLES.CUSTOMER], ownership: (u, r) => r?.order && r.order.customer_id === u.id },
  'order:predict-demand':      { roles: [ROLES.CUSTOMER, ROLES.DRIVER] },
  'order:view-driver-location': { ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === ROLES.ADMIN) },
  'order:view-route':          { ownership: (u, r) => r?.order && (r.order.customer_id === u.id || r.order.driver_id === u.id || u.role === ROLES.ADMIN) },

  'bid:submit':                { roles: [ROLES.DRIVER], ownership: (u, r) => r?.offer && r.offer.customer_id !== u.id },

  'milestone:update':          { roles: [ROLES.DRIVER], ownership: (u, r) => r?.order && r.order.driver_id === u.id },
  'delivery:verify':           { roles: [ROLES.DRIVER], ownership: (u, r) => r?.order && r.order.driver_id === u.id },
  'delivery:resend-otp':       { roles: [ROLES.DRIVER], ownership: (u, r) => r?.order && r.order.driver_id === u.id },

  'load-offer:view-all':       {},
  'load-offer:browse':         { roles: [ROLES.DRIVER] },

  'profile:view':              {},
  'profile:update':            { ownership: (u, r) => r?.profile && r.profile.id === u.id },
  'profile:update-wallet':     { ownership: (u, r) => r?.profile && r.profile.id === u.id },
  'profile:update-fcm':        { ownership: (u, r) => r?.profile && r.profile.id === u.id },
  'profile:view-statement':    { roles: [ROLES.DRIVER] },

  'driver:view-stats':         { roles: [ROLES.DRIVER] },
  'document:upload':           { roles: [ROLES.DRIVER] },
  'driver:toggle-online':      { roles: [ROLES.DRIVER] },
  'driver:view-wallet':        { roles: [ROLES.DRIVER] },
  'driver:view-earnings':      { roles: [ROLES.DRIVER] },
  'driver:view-trips':         { roles: [ROLES.DRIVER] },
  'driver:view-trip-items':    { roles: [ROLES.DRIVER], ownership: (u, r) => r?.trip && r.trip.driver_id === u.id },
  'driver:view-trip-stops':    { roles: [ROLES.DRIVER], ownership: (u, r) => r?.trip && r.trip.driver_id === u.id },
  'driver:view-route-points':  { roles: [ROLES.DRIVER], ownership: (u, r) => r?.trip && r.trip.driver_id === u.id },
  'driver:claim-route-point':  { roles: [ROLES.DRIVER], ownership: (u, r) => r?.trip && r.trip.driver_id === u.id },
  'driver:view-bids':          { roles: [ROLES.DRIVER] },
  'driver:withdraw':           { roles: [ROLES.DRIVER] },
  'driver:view-reputation':    { roles: [ROLES.DRIVER] },

  'truck:register':            { roles: [ROLES.DRIVER] },
  'truck:list-own':            { roles: [ROLES.DRIVER] },

  'maintenance:upload-photos':  { roles: [ROLES.DRIVER] },

  'ticket:create':             {},
  'ticket:view-own':           {},
  'ticket:view':               { ownership: (u, r) => r?.ticket && (r.ticket.user_id === u.id || u.role === ROLES.ADMIN) },
  'ticket:update':             { ownership: (u, r) => r?.ticket && (r.ticket.user_id === u.id || u.role === ROLES.ADMIN) },
  'ticket:add-comment':        { ownership: (u, r) => r?.ticket && (r.ticket.user_id === u.id || u.role === ROLES.ADMIN) },
  'ticket:view-comments':      { ownership: (u, r) => r?.ticket && (r.ticket.user_id === u.id || u.role === ROLES.ADMIN) },
  'ticket:admin-view-all':     { roles: [ROLES.ADMIN] },

  'admin:view-dashboard':      { roles: [ROLES.ADMIN] },
  'admin:invalidate-cache':    { roles: [ROLES.ADMIN] },

  'shard:view':                { roles: [ROLES.ADMIN] },
  'shard:query-orders':        { roles: [ROLES.ADMIN] },

  'fraud:view-stats':          { roles: [ROLES.ADMIN] },
  'fraud:view-risk':           { roles: [ROLES.ADMIN] },
  'fraud:manage-review':       { roles: [ROLES.ADMIN] },
  'fraud:track':               {},
  'fraud:analyze-network':     { roles: [ROLES.ADMIN] },

  'trip:sync-events':          {},
  'trip:view-events':          { ownership: (u, r) => r?.trip && (u.role === ROLES.ADMIN || r.trip.driver_id === u.id || r.trip.customer_id === u.id) },

  'device:register':           {},
  'device:unregister':         {},
  'device:view-platforms':     {},

  'webrtc:view-stats':         { roles: [ROLES.ADMIN] },
  'webrtc:view-nearby':        { roles: [ROLES.DRIVER, ROLES.ADMIN] },
  'webrtc:view-offline':       { roles: [ROLES.DRIVER, ROLES.ADMIN] },
  'webrtc:sync-offline':       { roles: [ROLES.DRIVER, ROLES.ADMIN] },
};

export class PolicyEngine {
  authorize(user, action, resource) {
    const policy = POLICIES[action];
    if (!policy) {
      throw new PolicyError(403, `Unknown action: ${action}`);
    }
    if (!roleAllowed(policy.roles, user.role)) {
      throw new PolicyError(403, 'Forbidden: Insufficient privileges.');
    }
    if (resource !== undefined && policy.ownership && !policy.ownership(user, resource)) {
      throw new PolicyError(403, 'Access Denied: You do not have permission to access this resource.');
    }
  }
}

export const policy = new PolicyEngine();
