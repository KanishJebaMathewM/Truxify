import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/federation';
import { gql } from 'graphql-tag';
import DataLoader from 'dataloader';
import { supabase } from '../../api/src/config/db.js';
import logger from '../../api/src/middleware/logger.js';

const typeDefs = gql`
    extend type Query {
        logisticsRoute(id: ID!): LogisticsRoute
        logisticsRoutes(limit: Int, offset: Int): [LogisticsRoute]
    }

    type LogisticsRoute @key(fields: "id") {
        id: ID!
        tripDisplayId: String!
        driverId: ID!
        orderId: ID
        routeLabel: String!
        status: String!
        checkpoints: [VehicleCheckpoint!]!
    }

    type VehicleCheckpoint {
        id: ID!
        tripDisplayId: String!
        title: String!
        subtitle: String
        latitude: Float!
        longitude: Float!
        progress: Float!
    }
`;

const resolvers = {
    Query: {
        logisticsRoute: async (_, { id }) => {
            const { data, error } = await supabase.from('trips').select('*').eq('id', id).single();
            if (error) throw error;
            return {
                ...data,
                tripDisplayId: data.trip_display_id,
                driverId: data.driver_id,
                orderId: data.order_id,
                routeLabel: data.route_label,
            };
        },
        logisticsRoutes: async (_, { limit = 50, offset = 0 }) => {
            const { data, error } = await supabase.from('trips').select('*').range(offset, offset + limit - 1);
            if (error) throw error;
            return data.map(row => ({
                ...row,
                tripDisplayId: row.trip_display_id,
                driverId: row.driver_id,
                orderId: row.order_id,
                routeLabel: row.route_label,
            }));
        }
    },
    LogisticsRoute: {
        checkpoints: async (route, _, context) => {
            // Using DataLoader to resolve the N+1 query vulnerability for vehicle checkpoints
            return await context.checkpointLoader.load(route.tripDisplayId);
        }
    }
};

// Batch function for DataLoader
const batchCheckpoints = async (tripDisplayIds) => {
    const { data, error } = await supabase
        .from('route_map_points')
        .select('*')
        .in('trip_display_id', tripDisplayIds);

    if (error) {
        logger.error('Failed to batch fetch checkpoints', error);
        throw error;
    }

    // Group checkpoints by tripDisplayId
    const checkpointsMap = tripDisplayIds.reduce((acc, id) => {
        acc[id] = [];
        return acc;
    }, {});

    if (data) {
        data.forEach(point => {
            if (checkpointsMap[point.trip_display_id]) {
                checkpointsMap[point.trip_display_id].push({
                    ...point,
                    tripDisplayId: point.trip_display_id,
                });
            }
        });
    }

    // Must return an array of the same length and order as tripDisplayIds
    return tripDisplayIds.map(id => checkpointsMap[id]);
};

async function startLogisticsService() {
    const server = new ApolloServer({
        schema: buildSubgraphSchema({ typeDefs, resolvers }),
        introspection: true
    });

    const { url } = await startStandaloneServer(server, {
        listen: { port: 4004 },
        context: async () => {
            return {
                checkpointLoader: new DataLoader(keys => batchCheckpoints(keys))
            };
        }
    });

    logger.info(`✅ Logistics Route (Trip) GraphQL service running at ${url}`);
    return { url };
}

export default startLogisticsService;
