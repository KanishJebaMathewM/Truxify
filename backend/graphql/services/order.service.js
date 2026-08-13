import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import { generateOrderDisplayId } from '../../api/src/lib/orderDisplayId.js';
import { createLoaders } from '../gateway/authContext.js';

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
        cargoType: row.cargoType ?? row.goods_type,
        weight: row.weight ?? row.weight_tonnes,
        amount: row.amount ?? row.total_amount,
        pickup: {
            lat: row.pickup_lat,
            lng: row.pickup_lng,
            address: row.pickup_address,
        },
        dropoff: {
            lat: row.drop_lat,
            lng: row.drop_lng,
            address: row.drop_address,
        },
        createdAt: row.createdAt ?? row.created_at,
        updatedAt: row.updatedAt ?? row.updated_at,
    };
}

const ORDER_STATUS_TO_DB = {
    PENDING: 'pending',
    CONFIRMED: 'truck_assigned',
    ASSIGNED: 'truck_assigned',
    IN_TRANSIT: 'in_transit',
    COMPLETED: 'delivered',
    CANCELLED: 'cancelled',
    DISPUTED: 'disputed',
};

function toDbStatus(status) {
    if (!status) return status;
    return ORDER_STATUS_TO_DB[status] || status.toLowerCase();
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
                query = query.eq('status', toDbStatus(status));
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
                    order_display_id: generateOrderDisplayId(),
                    pickup_address: input.pickup?.address,
                    pickup_lat: input.pickup?.lat,
                    pickup_lng: input.pickup?.lng,
                    drop_address: input.dropoff?.address,
                    drop_lat: input.dropoff?.lat,
                    drop_lng: input.dropoff?.lng,
                    goods_type: input.cargoType,
                    weight_tonnes: input.weight,
                    total_amount: input.amount,
                    pickup_date: new Date().toISOString().slice(0, 10),
                    status: toDbStatus(input.status) || 'pending',
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
                status: toDbStatus(input.status),
                pickup_address: input.pickup?.address ?? undefined,
                pickup_lat: input.pickup?.lat ?? undefined,
                pickup_lng: input.pickup?.lng ?? undefined,
                drop_address: input.dropoff?.address ?? undefined,
                drop_lat: input.dropoff?.lat ?? undefined,
                drop_lng: input.dropoff?.lng ?? undefined,
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
                    status: 'cancelled',
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
        payment: async (order, _, context) => {
            if (!context.loaders) {
                const { data, error } = await supabase
                    .from('payments')
                    .select('*')
                    .eq('order_id', order.id)
                    .single();
                
                if (error) return null;
                return data;
            }
            return context.loaders.paymentLoader.load(order.id);
        },
        trip: async (order, _, context) => {
            if (!context.loaders) {
                const { data, error } = await supabase
                    .from('trips')
                    .select('*')
                    .eq('order_id', order.id)
                    .single();
                
                if (error) return null;
                return data;
            }
            return context.loaders.tripLoader.load(order.id);
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
        context: async ({ req }) => {
            const id = req.headers['x-user-id'];
            const role = req.headers['x-user-role'];
            const user = id ? { id, role } : null;
            
            return {
                user,
                loaders: createLoaders(supabase)
            };
        }
    });

   logger.info(`OK Order GraphQL service running at ${url}`);
    return { url };
}

export default startOrderService;
