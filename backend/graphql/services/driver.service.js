import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';
import { resolveUserFromTrustedHeaders } from '../shared/trustedIdentity.js';

const DISPATCH_ROLES = new Set(['ADMIN', 'admin', 'DISPATCHER', 'dispatcher']);

function requireUser(user) {
    if (!user?.id) {
        throw new Error('Authentication required');
    }
    return user;
}

function canDispatch(user) {
    return DISPATCH_ROLES.has(user?.role);
}

function mapDriver(row) {
    if (!row) return row;

    return {
        ...row,
        userId: row.userId ?? row.user_id,
        truckType: row.truckType ?? row.truck_type,
        truckNumber: row.truckNumber ?? row.truck_number,
        currentLocation: row.currentLocation ?? row.current_location,
        tripsCompleted: row.tripsCompleted ?? row.trips_completed,
    };
}

export function maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return '****';
    const trimmed = phone.trim();
    if (trimmed.length <= 4) return '****';
    return trimmed.slice(0, -4).replace(/./g, '*') + trimmed.slice(-4);
}

export function maskTruckNumber(truckNumber) {
    if (!truckNumber || typeof truckNumber !== 'string') return '****';
    const trimmed = truckNumber.trim();
    if (trimmed.length <= 4) return '****';
    return trimmed.slice(0, -4).replace(/./g, '*') + trimmed.slice(-4);
}

export function sanitizeDriverForCaller(driver, user) {
    if (!driver) return driver;

    const mapped = mapDriver(driver);

    // Dispatchers/admins and the driver themselves see full unmasked details
    if (canDispatch(user) || (user?.id && mapped.userId === user.id)) {
        return mapped;
    }

    return {
        ...mapped,
        phone: maskPhone(mapped.phone),
        truckNumber: maskTruckNumber(mapped.truckNumber),
        currentLocation: null,
    };
}

const EARTH_RADIUS_KM = 6371;

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function getDriverLocation(driver) {
    const location = driver?.current_location || driver?.currentLocation;
    const lat = toFiniteNumber(location?.lat);
    const lng = toFiniteNumber(location?.lng);

    if (lat === null || lng === null) {
        return null;
    }

    return { lat, lng };
}

function distanceInKm(from, to) {
    const latDelta = (to.lat - from.lat) * Math.PI / 180;
    const lngDelta = (to.lng - from.lng) * Math.PI / 180;
    const fromLat = from.lat * Math.PI / 180;
    const toLat = to.lat * Math.PI / 180;

    const a = Math.sin(latDelta / 2) ** 2
        + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lngDelta / 2) ** 2;

    return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinRadius(driver, center, radiusKm) {
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
        return false;
    }
    const location = getDriverLocation(driver);
    return location ? distanceInKm(center, location) <= radiusKm : false;
}

const typeDefs = gql`
    extend type Query {
        driver(id: ID!): Driver
        drivers(available: Boolean, location: LocationInput): [Driver]
        nearbyDrivers(lat: Float!, lng: Float!, radius: Float): [Driver]
    }

    extend type Mutation {
        updateDriver(id: ID!, input: UpdateDriverInput!): Driver
        assignDriver(orderId: ID!, driverId: ID!): Order
        updateDriverLocation(id: ID!, location: LocationInput!): Driver
    }

    type Driver @key(fields: "id") {
        id: ID!
        userId: ID!
        name: String!
        phone: String!
        truckType: String!
        truckNumber: String!
        status: DriverStatus!
        currentLocation: Location
        rating: Float!
        tripsCompleted: Int!
        user: User @external
        orders: [Order] @external
        currentTrip: Trip @external
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
        radius: Float
    }

    input UpdateDriverInput {
        status: DriverStatus
        currentLocation: LocationInput
        availability: Boolean
        truckType: String
        truckNumber: String
    }

    enum DriverStatus {
        AVAILABLE
        BUSY
        OFFLINE
    }

    extend type Order @key(fields: "id") {
        id: ID! @external
        driver: Driver
    }
`;

const resolvers = {
    Query: {
        driver: async (_, { id }, { user }) => {
            const currentUser = requireUser(user);
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) throw error;
            return sanitizeDriverForCaller(data, currentUser);
        },
        drivers: async (_, { available, location }, { user }) => {
            const currentUser = requireUser(user);
            let query = supabase.from('drivers').select('*');
            
            if (available !== undefined) {
                query = query.eq('status', available ? 'AVAILABLE' : 'BUSY');
            }

            const { data, error } = await query;
            if (error) throw error;

            let results = data || [];
            if (location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))) {
                const center = { lat: Number(location.lat), lng: Number(location.lng) };
                const radiusKm = Number(location.radius) || 10;
                results = results.filter(d => isWithinRadius(d, center, radiusKm));
            }

            return results.map(driver => sanitizeDriverForCaller(driver, currentUser));
        },
        nearbyDrivers: async (_, { lat, lng, radius = 10 }, { user }) => {
            const currentUser = requireUser(user);
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('status', 'AVAILABLE');
            
            if (error) throw error;

            const center = { lat: Number(lat), lng: Number(lng) };
            const radiusKm = Number(radius);
            const inRangeDrivers = (data || []).filter(d => isWithinRadius(d, center, radiusKm));

            return inRangeDrivers.map(driver => sanitizeDriverForCaller(driver, currentUser));
        }
    },
    Mutation: {
        updateDriver: async (_, { id, input }, { user }) => {
            const currentUser = requireUser(user);
            let query = supabase
                .from('drivers')
                .update({
                    status: input.status,
                    current_location: input.currentLocation,
                    truck_type: input.truckType || undefined,
                    truck_number: input.truckNumber || undefined,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);

            if (!canDispatch(currentUser)) {
                query = query.eq('user_id', currentUser.id);
            }

            const { data, error } = await query.select().single();
            
            if (error) throw error;
            return mapDriver(data);
        },
        assignDriver: async (_, { orderId, driverId }, { user }) => {
            const currentUser = requireUser(user);
            if (!canDispatch(currentUser)) {
                throw new Error('Dispatcher role required');
            }

            const { data, error } = await supabase
                .from('orders')
                .update({
                    driver_id: driverId,
                    status: 'truck_assigned',
                    updated_at: new Date().toISOString()
                })
                .eq('id', orderId)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        },
        updateDriverLocation: async (_, { id, location }, { user }) => {
            const currentUser = requireUser(user);
            let query = supabase
                .from('drivers')
                .update({
                    current_location: location,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id);

            if (!canDispatch(currentUser)) {
                query = query.eq('user_id', currentUser.id);
            }

            const { data, error } = await query.select().single();
            
            if (error) throw error;
            return mapDriver(data);
        }
    }
};

async function startDriverService() {
    const server = new ApolloServer({
        schema: buildSubgraphSchema({ typeDefs, resolvers }),
        introspection: true
    });

    const { url } = await startStandaloneServer(server, {
        listen: { port: 4002 },
        context: async ({ req }) => {
            // Identity is derived only from gateway-signed trusted headers;
            // forged x-user-id/x-user-role reaching the subgraph directly are
            // rejected (no IDOR / privilege escalation).
            return { user: resolveUserFromTrustedHeaders(req.headers) };
        }
    });

    logger.info(`OK Driver GraphQL service running at ${url}`);
    return { url };
}

export {
    typeDefs,
    resolvers,
    requireUser,
    canDispatch,
    mapDriver,
    isWithinRadius,
};

export default startDriverService;
