import { PubSub } from 'graphql-subscriptions';

export const pubsub = new PubSub();
const LOAD_BID_UPDATED = 'LOAD_BID_UPDATED';

export const bidResolvers = {
  Query: {
    getLoadBids: async (_, { orderId }) => {
      return [
        {
          id: 'BID_101',
          orderId,
          driverId: 'DRV_42',
          bidAmountINR: 12500.0,
          status: 'pending',
          timestamp: new Date().toISOString(),
        },
      ];
    },
  },
  Mutation: {
    submitBid: async (_, { orderId, driverId, amountINR }) => {
      const newBid = {
        id: `BID_${Date.now()}`,
        orderId,
        driverId,
        bidAmountINR: amountINR,
        status: 'pending',
        timestamp: new Date().toISOString(),
      };
      
      // Publish real-time delta payload to WebSocket subscribers
      pubsub.publish(`${LOAD_BID_UPDATED}_${orderId}`, { loadBidUpdated: newBid });
      return newBid;
    },
  },
  Subscription: {
    loadBidUpdated: {
      subscribe: (_, { orderId }) => pubsub.asyncIterator([`${LOAD_BID_UPDATED}_${orderId}`]),
    },
  },
};
