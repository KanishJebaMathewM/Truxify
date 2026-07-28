import { describe, it, expect } from 'vitest';
import { policy, PolicyEngine, PolicyError } from '../../src/security/policyEngine.js';

function user(role, id = 'user-1') {
  return { id, role };
}

describe('PolicyEngine', () => {
  describe('authorize', () => {
    describe('Customer permissions', () => {
      it('allows customer to create order', () => {
        expect(() => policy.authorize(user('customer'), 'order:create')).not.toThrow();
      });

      it('allows customer to view active orders', () => {
        expect(() => policy.authorize(user('customer'), 'order:view-active')).not.toThrow();
      });

      it('allows customer to view order history', () => {
        expect(() => policy.authorize(user('customer'), 'order:view-history')).not.toThrow();
      });

      it('allows customer to submit rating when owning the order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:submit-rating', { order })).not.toThrow();
      });

      it('denies customer submitting rating on non-owned order', () => {
        const order = { customer_id: 'other-user' };
        expect(() => policy.authorize(user('customer'), 'order:submit-rating', { order })).toThrow(PolicyError);
      });

      it('allows customer to view bids on own order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:view-bids', { order })).not.toThrow();
      });

      it('denies customer viewing bids on non-owned order', () => {
        const order = { customer_id: 'other-user' };
        expect(() => policy.authorize(user('customer'), 'order:view-bids', { order })).toThrow(PolicyError);
      });

      it('allows customer to accept bid on own order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:accept-bid', { order })).not.toThrow();
      });

      it('allows customer to cancel own order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:cancel', { order })).not.toThrow();
      });

      it('denies customer cancelling non-owned order', () => {
        const order = { customer_id: 'other-user' };
        expect(() => policy.authorize(user('customer'), 'order:cancel', { order })).toThrow(PolicyError);
      });

      it('allows customer to change drop on own order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:change-drop', { order })).not.toThrow();
      });

      it('allows customer to confirm deposit on own order', () => {
        const order = { customer_id: 'user-1' };
        expect(() => policy.authorize(user('customer'), 'order:confirm-deposit', { order })).not.toThrow();
      });

      it('allows customer to view own order', () => {
        const order = { customer_id: 'user-1', driver_id: null };
        expect(() => policy.authorize(user('customer'), 'order:view', { order })).not.toThrow();
      });

      it('denies customer viewing non-owned order', () => {
        const order = { customer_id: 'other-user', driver_id: null };
        expect(() => policy.authorize(user('customer'), 'order:view', { order })).toThrow(PolicyError);
      });
    });

    describe('Driver permissions', () => {
      it('allows driver to submit bid', () => {
        const offer = { customer_id: 'customer-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'bid:submit', { offer })).not.toThrow();
      });

      it('denies driver bidding on own load', () => {
        const offer = { customer_id: 'driver-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'bid:submit', { offer })).toThrow(PolicyError);
      });

      it('allows driver to update milestone on assigned order', () => {
        const order = { driver_id: 'driver-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'milestone:update', { order })).not.toThrow();
      });

      it('denies driver updating milestone on non-assigned order', () => {
        const order = { driver_id: 'other-driver' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'milestone:update', { order })).toThrow(PolicyError);
      });

      it('allows driver to verify delivery on assigned order', () => {
        const order = { driver_id: 'driver-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'delivery:verify', { order })).not.toThrow();
      });

      it('allows driver to view own order when assigned', () => {
        const order = { customer_id: null, driver_id: 'driver-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'order:view', { order })).not.toThrow();
      });

      it('allows driver to view stats', () => {
        expect(() => policy.authorize(user('driver'), 'driver:view-stats')).not.toThrow();
      });

      it('allows driver to view wallet', () => {
        expect(() => policy.authorize(user('driver'), 'driver:view-wallet')).not.toThrow();
      });

      it('allows driver to view bids', () => {
        expect(() => policy.authorize(user('driver'), 'driver:view-bids')).not.toThrow();
      });

      it('allows driver to withdraw', () => {
        expect(() => policy.authorize(user('driver'), 'driver:withdraw')).not.toThrow();
      });

      it('allows driver to view reputation', () => {
        expect(() => policy.authorize(user('driver'), 'driver:view-reputation')).not.toThrow();
      });
    });

    describe('Admin permissions', () => {
      it('allows admin to view dashboard', () => {
        expect(() => policy.authorize(user('admin'), 'admin:view-dashboard')).not.toThrow();
      });

      it('allows admin to invalidate cache', () => {
        expect(() => policy.authorize(user('admin'), 'admin:invalidate-cache')).not.toThrow();
      });

      it('allows admin to view any order', () => {
        const order = { customer_id: 'other-user', driver_id: null };
        expect(() => policy.authorize(user('admin'), 'order:view', { order })).not.toThrow();
      });
    });

    describe('Cross-role denials', () => {
      it('denies driver creating order', () => {
        expect(() => policy.authorize(user('driver'), 'order:create')).toThrow(PolicyError);
      });

      it('denies customer viewing driver stats', () => {
        expect(() => policy.authorize(user('customer'), 'driver:view-stats')).toThrow(PolicyError);
      });

      it('denies customer submitting bid', () => {
        expect(() => policy.authorize(user('customer'), 'bid:submit')).toThrow(PolicyError);
      });

      it('denies driver viewing order history', () => {
        expect(() => policy.authorize(user('driver'), 'order:view-history')).toThrow(PolicyError);
      });

      it('denies driver viewing active orders', () => {
        expect(() => policy.authorize(user('driver'), 'order:view-active')).toThrow(PolicyError);
      });

      it('denies customer viewing admin dashboard', () => {
        expect(() => policy.authorize(user('customer'), 'admin:view-dashboard')).toThrow(PolicyError);
      });

      it('denies driver viewing admin dashboard', () => {
        expect(() => policy.authorize(user('driver'), 'admin:view-dashboard')).toThrow(PolicyError);
      });
    });

    describe('Unknown action', () => {
      it('throws PolicyError for unknown action', () => {
        expect(() => policy.authorize(user('admin'), 'unknown:action')).toThrow(PolicyError);
      });
    });

    describe('Dual-role permissions', () => {
      it('allows customer to predict demand', () => {
        expect(() => policy.authorize(user('customer'), 'order:predict-demand')).not.toThrow();
      });

      it('allows driver to predict demand', () => {
        expect(() => policy.authorize(user('driver'), 'order:predict-demand')).not.toThrow();
      });

      it('denies admin predicting demand', () => {
        expect(() => policy.authorize(user('admin'), 'order:predict-demand')).toThrow(PolicyError);
      });

      it('allows customer to view driver location on own order', () => {
        const order = { customer_id: 'user-1', driver_id: null };
        expect(() => policy.authorize(user('customer', 'user-1'), 'order:view-driver-location', { order })).not.toThrow();
      });

      it('allows driver to view own location on assigned order', () => {
        const order = { customer_id: null, driver_id: 'driver-1' };
        expect(() => policy.authorize(user('driver', 'driver-1'), 'order:view-driver-location', { order })).not.toThrow();
      });

      it('denies unrelated user viewing driver location', () => {
        const order = { customer_id: 'other', driver_id: 'other-driver' };
        expect(() => policy.authorize(user('customer', 'user-1'), 'order:view-driver-location', { order })).toThrow(PolicyError);
      });
    });

    describe('Authenticated-only endpoints', () => {
      it('allows any role to view load offers', () => {
        expect(() => policy.authorize(user('customer'), 'load-offer:view-all')).not.toThrow();
        expect(() => policy.authorize(user('driver'), 'load-offer:view-all')).not.toThrow();
        expect(() => policy.authorize(user('admin'), 'load-offer:view-all')).not.toThrow();
      });

      it('allows any role to create ticket', () => {
        expect(() => policy.authorize(user('customer'), 'ticket:create')).not.toThrow();
        expect(() => policy.authorize(user('driver'), 'ticket:create')).not.toThrow();
        expect(() => policy.authorize(user('admin'), 'ticket:create')).not.toThrow();
      });

      it('rejects missing role for open actions', () => {
        expect(() => policy.authorize({ id: 'user-1' }, 'load-offer:view-all')).toThrow(PolicyError);
        expect(() => policy.authorize({ id: 'user-1' }, 'ticket:create')).toThrow(PolicyError);
        expect(() => policy.authorize({ id: 'user-1' }, 'profile:view')).toThrow(PolicyError);
      });

      it('rejects unknown role for role-restricted actions', () => {
        expect(() => policy.authorize(user('superadmin'), 'order:create')).toThrow(PolicyError);
        expect(() => policy.authorize(user('superadmin'), 'admin:view-dashboard')).toThrow(PolicyError);
        expect(() => policy.authorize(user('superadmin'), 'driver:view-stats')).toThrow(PolicyError);
      });
    });

    describe('Support ticket ownership', () => {
      it('allows ticket owner to view ticket', () => {
        const ticket = { user_id: 'user-1' };
        expect(() => policy.authorize(user('customer', 'user-1'), 'ticket:view', { ticket })).not.toThrow();
      });

      it('allows admin to view any ticket', () => {
        const ticket = { user_id: 'other-user' };
        expect(() => policy.authorize(user('admin'), 'ticket:view', { ticket })).not.toThrow();
      });

      it('denies non-owner, non-admin viewing ticket', () => {
        const ticket = { user_id: 'other-user' };
        expect(() => policy.authorize(user('customer', 'user-1'), 'ticket:view', { ticket })).toThrow(PolicyError);
      });
    });
  });

  describe('PolicyEngine class', () => {
    it('can be instantiated', () => {
      const engine = new PolicyEngine();
      expect(engine).toBeInstanceOf(PolicyEngine);
    });

    it('singleton is an instance of PolicyEngine', () => {
      expect(policy).toBeInstanceOf(PolicyEngine);
    });
  });
});
