import { ApolloGateway, IntrospectAndCompose, RemoteGraphQLDataSource } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache';
import logger from '../../api/src/middleware/logger.js';
import { supabase } from '../../api/src/config/db.js';
import { resolveUserContext, DEFAULT_ROLE } from './authContext.js';
import { computeTrustedSignature } from '../shared/trustedIdentity.js';

class GraphQLGateway {
    constructor() {
        this.gateway = null;
        this.server = null;
        this.port = process.env.GRAPHQL_PORT || 4000;
        this.services = this.getServices();
        
        this.initializeGateway();
    }

    getServices() {
        return [
            { name: 'order', url: process.env.ORDER_SERVICE_URL || 'http://localhost:4001/graphql' },
            { name: 'driver', url: process.env.DRIVER_SERVICE_URL || 'http://localhost:4002/graphql' },
            { name: 'trip', url: process.env.TRIP_SERVICE_URL || 'http://localhost:4004/graphql' },
        ];
    }

    initializeGateway() {
        this.gateway = new ApolloGateway({
            supergraphSdl: new IntrospectAndCompose({
                subgraphs: this.services,
                pollIntervalInMs: 10000,
            }),
            cache: new InMemoryLRUCache({
                maxSize: 100 * 1024 * 1024, // 100MB
                ttl: 300 // 5 minutes
            }),
            buildService({ name, url }) {
                return new RemoteGraphQLDataSource({
                    url,
                    willSendRequest({ request, context }) {
                        const authorization = context?.headers?.authorization;
                        if (authorization) {
                            request.http.headers.set('authorization', authorization);
                        }

                        // Strip any client-supplied identity headers so subgraph
                        // authorization can only ever come from the gateway's
                        // verified context (profiles-backed role), never from a
                        // forged x-user-id/x-user-role on the raw client request.
                        request.http.headers.delete('x-user-id');
                        request.http.headers.delete('x-user-role');
                        request.http.headers.delete('x-gateway-signature');

                        if (context?.user?.id) {
                            const userId = context.user.id;
                            const role = context.user.role || DEFAULT_ROLE;
                            request.http.headers.set('x-user-id', userId);
                            request.http.headers.set('x-user-role', role);
                            // Sign the trusted identity so subgraphs can verify it
                            // originated from the gateway and was not forged.
                            request.http.headers.set(
                                'x-gateway-signature',
                                computeTrustedSignature(userId, role)
                            );
                        }

                        logger.debug(`GraphQL ${name} request sent`);
                    },
                });
            }
        });
    }

    async start() {
        try {
            this.server = new ApolloServer({
                gateway: this.gateway,
                introspection: process.env.NODE_ENV !== 'production',
                csrfPrevention: true,
                cache: new InMemoryLRUCache({
                    maxSize: 100 * 1024 * 1024,
                    ttl: 300
                }),
                formatError: (error) => {
                    logger.error('GraphQL Error:', error);
                    return {
                        message: error.message,
                        path: error.path,
                        extensions: error.extensions
                    };
                }
            });

            const { url } = await startStandaloneServer(this.server, {
                listen: { port: this.port },
                context: async ({ req }) => {
                    // Extract user from auth header
                    const token = req.headers.authorization || '';
                    const user = await this.getUserFromToken(token);
                    
                    return {
                        user,
                        headers: req.headers,
                        req
                    };
                }
            });

           logger.info(`OK GraphQL Gateway running at ${url}`);
            return { url };
        } catch (error) {
            logger.error('ERROR GraphQL Gateway startup failed:', error);
            throw error;
        }
    }

    async getUserFromToken(token) {
        if (!token) return null;

        try {
            const user = await resolveUserContext(supabase, token);
            if (!user) {
                logger.warn('[GraphQL Gateway] Invalid auth token: no user');
                return null;
            }
            return user;
        } catch (err) {
            logger.warn('[GraphQL Gateway] Token verification failed:', err.message);
            return null;
        }
    }

    async stop() {
        if (this.server) {
            await this.server.stop();
            logger.info('OK GraphQL Gateway stopped');
        }
    }
}

export default new GraphQLGateway();
