import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

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
        driver: async (_, { id }) => {
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('id', id)
                .single();
            
            if (error) throw error;
            return data;
        },
        drivers: async (_, { available, location }) => {
            let query = supabase.from('drivers').select('*');
            
            if (available !== undefined) {
                query = query.eq('status', available ? 'AVAILABLE' : 'BUSY');
            }

            const { data, error } = await query;
            if (error) throw error;

            if (location) {
                const center = { lat: location.lat, lng: location.lng };
                return data.filter(driver => isWithinRadius(driver, center, location.radius ?? 10));
            }

            return data;
        },
        nearbyDrivers: async (_, { lat, lng, radius = 10 }) => {
            const { data, error } = await supabase
                .from('drivers')
                .select('*')
                .eq('status', 'AVAILABLE');
            
            if (error) throw error;
            return data.filter(driver => isWithinRadius(driver, { lat, lng }, radius));
        }
    },
    Mutation: {
        updateDriver: async (_, { id, input }) => {
            const { data, error } = await supabase
                .from('drivers')
                .update({
                    status: input.status,
                    current_location: input.currentLocation,
                    truck_type: input.truckType || undefined,
                    truck_number: input.truckNumber || undefined,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        },
        assignDriver: async (_, { orderId, driverId }) => {
            const { data, error } = await supabase
                .from('orders')
                .update({
                    driver_id: driverId,
                    status: 'ASSIGNED',
                    updated_at: new Date().toISOString()
                })
                .eq('id', orderId)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        },
        updateDriverLocation: async (_, { id, location }) => {
            const { data, error } = await supabase
                .from('drivers')
                .update({
                    current_location: location,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .select()
                .single();
            
            if (error) throw error;
            return data;
        }
    }
};

async function startDriverService() {
    const server = new ApolloServer({
        schema: buildSubgraphSchema({ typeDefs, resolvers }),
        introspection: true
    });

    const { url } = await startStandaloneServer(server, {
        listen: { port: 4002 }
    });

    logger.info(`✅ Driver GraphQL service running at ${url}`);
    return { url };
}

export default startDriverService;
