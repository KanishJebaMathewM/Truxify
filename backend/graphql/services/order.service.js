import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import DataLoader from 'dataloader';
import { supabase } from '../api/src/config/db.js';
import logger from '../api/src/middleware/logger.js';

const ADMIN_ROLES = new Set(['ADMIN', 'admin']);

function requireUser(user) {
    if (!user?.id) {
        throw new Error('Authentication required');
    }
    return user;
}

function isAdmin(user) {
    return ADMIN_ROLES.has(user?.role);
}

function mapOrder(row) {
    if (!row) return row;

    return {
        ...row,
        customerId: row.customerId ?? row.customer_id,
        driverId: row.driverId ?? row.driver_id,
        cargoType: row.cargoType ?? row.cargo_type,
        createdAt: row.createdAt ?? row.created_at,
        updatedAt: row.updatedAt ?? row.updated_at,
    };
}

/**
 * Create DataLoaders for batching database queries
 * This fixes N+1 query issues by batching multiple requests into single queries
 */
function createLoaders() {
    // Batch loader for payments - fetches all payments for a list of orders in one query
    const paymentLoader = new DataLoader(async (orderIds) => {
        const { data: payments, error } = await supabase
            .from('payments')
            .select('*')
            .in('order_id', orderIds);
        
        if (error) {
            logger.error('[N+1 FIX] Failed to batch fetch payments:', error);
            return orderIds.map(() => null);
        }
        
        // Group payments by order_id
        const paymentsByOrder = new Map();
        payments?.forEach(payment => {
            paymentsByOrder.set(payment.order_id, payment);
        });
        
        return orderIds.map(orderId => paymentsByOrder.get(orderId) || null);
    });

    // Batch loader for trips - fetches all trips for a list of orders in one query
    const tripLoader = new DataLoader(async (orderIds) => {
        const { data: trips, error } = await supabase
            .from('trips')
            .select('*')
            .in('order_id', orderIds);
        
        if (error) {
            logger.error('[N+1 FIX] Failed to batch fetch trips:', error);
            return orderIds.map(() => null);
        }
        
        // Group trips by order_id
        const tripsByOrder = new Map();
        trips?.forEach(trip => {
            tripsByOrder.set(trip.order_id, trip);
        });
        
        return orderIds.map(orderId => tripsByOrder.get(orderId) || null);
    });

    return { paymentLoader, tripLoader };
}

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
            const currentUser = requireUser(user);

            // Fetch order from database
            let query = supabase
                .from('orders')
                .select('*')
                .eq('id', id);

            if (!isAdmin(currentUser)) {
                query = query.eq('customer_id', currentUser.id);
            }

            const { data, error } = await query.single();
            
            if (error) throw error;
            return mapOrder(data);
        },
        orders: async (_, { status, limit = 10, offset = 0 }, { user }) => {
            const currentUser = requireUser(user);

            let query = supabase
                .from('orders')
                .select('*')
                .range(offset, offset + limit - 1);

            if (!isAdmin(currentUser)) {
                query = query.eq('customer_id', currentUser.id);
            }
            
            if (status) {
                query = query.eq('status', status);
            }
            
            const { data, error } = await query;
            if (error) throw error;
            return data.map(mapOrder);
        },
        ordersByCustomer: async (_, { customerId }, { user }) => {
            const currentUser = requireUser(user);
            const scopedCustomerId = isAdmin(currentUser) ? customerId : currentUser.id;

            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .eq('customer_id', scopedCustomerId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            return data.map(mapOrder);
        }
    },
    Mutation: {
        createOrder: async (_, { input }, { user }) => {
            const currentUser = requireUser(user);
            const customerId = isAdmin(currentUser) ? input.customerId : currentUser.id;

            const { data, error } = await supabase
                .from('orders')
                .insert([{
                    customer_id: customerId,
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
            return mapOrder(data);
        },
        updateOrder: async (_, { id, input }, { user }) => {
            const currentUser = requireUser(user);
            const updates = {
                status: input.status,
                pickup: input.pickup || undefined,
                dropoff: input.dropoff || undefined,
                updated_at: new Date().toISOString()
            };

            if (isAdmin(currentUser)) {
                updates.driver_id = input.driverId || undefined;
            }

            let query = supabase
                .from('orders')
                .update(updates)
                .eq('id', id);

            if (!isAdmin(currentUser)) {
                query = query.eq('customer_id', currentUser.id);
            }

            const { data, error } = await query.select().single();
            
            if (error) throw error;
            return mapOrder(data);
        },
        cancelOrder: async (_, { id, reason }, { user }) => {
            const currentUser = requireUser(user);
            let query = supabase
                .from('orders')
                .update({
                    status: 'CANCELLED',
                    cancellation_reason: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);

            if (!isAdmin(currentUser)) {
                query = query.eq('customer_id', currentUser.id);
            }

            const { data, error } = await query.select().single();
            
            if (error) throw error;
            return mapOrder(data);
        }
    },
    Order: {
        driver: async (order) => {
            if (!order.driverId) return null;
            // Fetch driver from driver service
            return { id: order.driverId };
        },
        payment: async (order, _, { loaders }) => {
            // Use DataLoader to batch fetch payments (N+1 fix)
            if (!order.id) return null;
            return loaders.paymentLoader.load(order.id);
        },
        trip: async (order, _, { loaders }) => {
            // Use DataLoader to batch fetch trips (N+1 fix)
            if (!order.id) return null;
            return loaders.tripLoader.load(order.id);
        }
    }
};

async function startOrderService() {
    const server = new ApolloServer({
        schema: buildSubgraphSchema({ typeDefs, resolvers }),
        introspection: true
    });

    const { url } = await startStandaloneServer(server, {
        listen: { port: 4001 },
        context: async () => {
            // Create new loaders for each request to avoid caching issues
            const loaders = createLoaders();
            return { loaders };
        }
    });

    logger.info(`✅ Order GraphQL service running at ${url}`);
    logger.info('[N+1 FIX] DataLoader pattern implemented for payment and trip queries');
    return { url };
}

export default startOrderService;
