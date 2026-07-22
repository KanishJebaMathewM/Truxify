import { ApolloGateway } from '@apollo/gateway';
import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { InMemoryLRUCache } from '@apollo/utils.keyvaluecache';
import logger from '../../api/src/middleware/logger.js';

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
            { name: 'payment', url: process.env.PAYMENT_SERVICE_URL || 'http://localhost:4003/graphql' },
            { name: 'trip', url: process.env.TRIP_SERVICE_URL || 'http://localhost:4004/graphql' },
            { name: 'user', url: process.env.USER_SERVICE_URL || 'http://localhost:4005/graphql' },
        ];
    }

    initializeGateway() {
        this.gateway = new ApolloGateway({
            supergraphSdl: this.getSupergraphSDL(),
            experimental_pollInterval: 10000,
            cache: new InMemoryLRUCache({
                maxSize: 100 * 1024 * 1024, // 100MB
                ttl: 300 // 5 minutes
            }),
            buildService({ name, url }) {
                return {
                    name,
                    url,
                    requestDidStart() {
                        return {
                            willSendResponse({ response }) {
                                // Log response
                                logger.debug(`GraphQL ${name} response sent`);
                            }
                        };
                    }
                };
            }
        });
    }

    getSupergraphSDL() {
        // In production: compose from service SDLs
        // For now, return combined schema
        return `
            extend type Query {
                # Order queries
                order(id: ID!): Order
                orders(status: OrderStatus, limit: Int, offset: Int): [Order]
                
                # Driver queries
                driver(id: ID!): Driver
                drivers(available: Boolean, location: LocationInput): [Driver]
                
                # Payment queries
                payment(id: ID!): Payment
                payments(orderId: ID): [Payment]
                
                # Trip queries
                trip(id: ID!): Trip
                trips(driverId: ID, status: TripStatus): [Trip]
                
                # User queries
                user(id: ID!): User
                me: User
            }

            type Mutation {
                # Order mutations
                createOrder(input: CreateOrderInput!): Order
                updateOrder(id: ID!, input: UpdateOrderInput!): Order
                cancelOrder(id: ID!, reason: String): Order
                
                # Driver mutations
                updateDriver(id: ID!, input: UpdateDriverInput!): Driver
                assignDriver(orderId: ID!, driverId: ID!): Order
                
                # Payment mutations
                createPayment(input: CreatePaymentInput!): Payment
                confirmPayment(id: ID!): Payment
                
                # Trip mutations
                startTrip(orderId: ID!): Trip
                completeTrip(id: ID!): Trip
                
                # User mutations
                updateUser(id: ID!, input: UpdateUserInput!): User
            }

            type Subscription {
                orderUpdated(orderId: ID): Order
                driverLocationUpdated(driverId: ID): DriverLocation
                tripProgressUpdated(tripId: ID): TripProgress
            }

            type Order {
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
                createdAt: String!
                updatedAt: String!
                driver: Driver
                payment: Payment
                trip: Trip
                customer: User
            }

            type Driver {
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
                user: User
                currentTrip: Trip
                orders: [Order]
            }

            type Payment {
                id: ID!
                orderId: ID!
                amount: Float!
                status: PaymentStatus!
                method: PaymentMethod!
                txHash: String
                createdAt: String!
                updatedAt: String!
                order: Order
            }

            type Trip {
                id: ID!
                orderId: ID!
                driverId: ID!
                status: TripStatus!
                startTime: String
                endTime: String
                distance: Float!
                duration: Float!
                route: [Location]
                order: Order
                driver: Driver
            }

            type User {
                id: ID!
                email: String!
                name: String!
                phone: String!
                role: UserRole!
                isVerified: Boolean!
                createdAt: String!
                orders: [Order]
                driver: Driver
            }

            type Location {
                lat: Float!
                lng: Float!
                address: String
            }

            type DriverLocation {
                driverId: ID!
                location: Location!
                speed: Float
                heading: Float
                timestamp: String!
            }

            type TripProgress {
                tripId: ID!
                currentLocation: Location!
                eta: String!
                progress: Float!
                remainingDistance: Float!
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

            enum DriverStatus {
                AVAILABLE
                BUSY
                OFFLINE
            }

            enum PaymentStatus {
                PENDING
                CONFIRMED
                FAILED
                RELEASED
            }

            enum PaymentMethod {
                UPI
                CARD
                BANK
                CRYPTO
            }

            enum TripStatus {
                SCHEDULED
                STARTED
                IN_PROGRESS
                COMPLETED
                CANCELLED
            }

            enum UserRole {
                CUSTOMER
                DRIVER
                ADMIN
            }

            input LocationInput {
                lat: Float!
                lng: Float!
                radius: Float
            }

            input CreateOrderInput {
                customerId: ID!
                pickup: LocationInput!
                dropoff: LocationInput!
                weight: Float!
                distance: Float!
                cargoType: String!
            }

            input UpdateOrderInput {
                status: OrderStatus
                pickup: LocationInput
                dropoff: LocationInput
            }

            input UpdateDriverInput {
                status: DriverStatus
                currentLocation: LocationInput
                availability: Boolean
            }

            input CreatePaymentInput {
                orderId: ID!
                amount: Float!
                method: PaymentMethod!
            }

            input UpdateUserInput {
                name: String
                phone: String
                isVerified: Boolean
            }
        `;
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

            logger.info(`✅ GraphQL Gateway running at ${url}`);
            return { url };
        } catch (error) {
            logger.error('❌ GraphQL Gateway startup failed:', error);
            throw error;
        }
    }

    async getUserFromToken(token) {
        // In production: decode JWT and fetch user
        return { id: 'user-123', role: 'CUSTOMER' };
    }

    async stop() {
        if (this.server) {
            await this.server.stop();
            logger.info('✅ GraphQL Gateway stopped');
        }
    }
}

export default new GraphQLGateway();