import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

const typeDefs = gql`
    extend type Query {
        order(id: ID!): Order
        orders(status: OrderStatus, limit: Int, offset: Int): [Order]
        ordersByCustomer(customerId: ID!): [Order]
    }

    extend type Mutation {
        createOrder(input: CreateOrderInput!): Order
        updateOrder(id: ID!, input: UpdateOrderInput!): Order
        cancelOrder(id: ID!, reason: String): Order
    }

    type Order @key(fields: "id") {
        id: ID!
        customerId: ID!
        driverId: ID
        status: OrderStatus!
        amount: Float!
        currency: String!
        pickup: Location!
        dropoff: Location!
        distance: Float!
        weight: Float!
        cargoType: String!
        createdAt: String!
        updatedAt: String!
        driver: Driver @external
        payment: Payment @external
        trip: Trip @external
    }

    type Location {
        lat: Float!
        lng: Float!
        address: String
    }

    input LocationInput {
        lat: Float!
        lng: Float!
        address: String
    }

    input CreateOrderInput {
        customerId: ID!
        pickup: LocationInput!
        dropoff: LocationInput!
        weight: Float!
        distance: Float!
        cargoType: String!
        amount: Float!
    }

    input UpdateOrderInput {
        status: OrderStatus
        pickup: LocationInput
        dropoff: LocationInput
        driverId: ID
    }

    enum OrderStatus {
        PENDING
        CONFIRMED
        ASSIGNED
        IN_TRANSIT
        COMPLETED
        CANCELLED
        DISPUTED
    }

    extend type Driver @key(fields: "id") {
        id: ID! @external
        orders: [Order]
    }

    extend type Payment @key(fields: "id") {
        id: ID! @external
        order: Order
    }

    extend type Trip @key(fields: "id") {
        id: ID! @external
        order: Order
    }
`;

const resolvers = {
    Query: {
        order: async (_, { id }, { user }) => {
            // Fetch order from database
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) throw error;
            return data;
        },
        orders: async (_, { status, limit = 10, offset = 0 }, { user }) => {
            let query = supabase
                .from('orders')
                .select('*')
                .range(offset, offset + limit - 1);
            
            if (status) {
                query = query.eq('status', status);
            }
            
            const { data, error } = await query;
            if (error) throw error;
            return data;
        },
        ordersByCustomer: async (_, { customerId }, { user }) => {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('customer_id', customerId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data;
        }
    },
    Mutation: {
        createOrder: async (_, { input }, { user }) => {
            const { data, error } = await supabase
                .from('orders')
                .insert([{
                    customer_id: input.customerId,
                    pickup: input.pickup,
                    dropoff: input.dropoff,
                    weight: input.weight,
                    distance: input.distance,
                    cargo_type: input.cargoType,
                    amount: input.amount,
                    status: 'PENDING',
                    created_at: new Date().toISOString()
                }])
                .select()
                .single();
            
            if (error) throw error;
            return data;
        },
        updateOrder: async (_, { id, input }, { user }) => {
            const { data, error } = await supabase
                .from('orders')
                .update({
                    status: input.status,
                    pickup: input.pickup || undefined,
                    dropoff: input.dropoff || undefined,
                    driver_id: input.driverId || undefined,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        },
        cancelOrder: async (_, { id, reason }, { user }) => {
            const { data, error } = await supabase
                .from('orders')
                .update({
                    status: 'CANCELLED',
                    cancellation_reason: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        }
    },
    Order: {
        driver: async (order) => {
            if (!order.driverId) return null;
            // Fetch driver from driver service
            return { id: order.driverId };
        },
        payment: async (order) => {
            // Fetch payment from payment service
            const { data, error } = await supabase
                .from('payments')
                .select('*')
                .eq('order_id', order.id)
                .single();
            
            if (error) return null;
            return data;
        },
        trip: async (order) => {
            // Fetch trip from trip service
            const { data, error } = await supabase
                .from('trips')
                .select('*')
                .eq('order_id', order.id)
                .single();
            
            if (error) return null;
            return data;
        }
    }
};

async function startOrderService() {
    const server = new ApolloServer({
        schema: buildSubgraphSchema({ typeDefs, resolvers }),
        introspection: true
    });

    const { url } = await startStandaloneServer(server, {
        listen: { port: 4001 }
    });

    logger.info(`✅ Order GraphQL service running at ${url}`);
    return { url };
}

export default startOrderService;