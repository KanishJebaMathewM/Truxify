import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import logger from '../middleware/logger.js';

class Tracing {
    constructor() {
        this.provider = null;
        this.isInitialized = false;
    }

    initialize(serviceName = 'truxify-api') {
        if (this.isInitialized) return;

        try {
            // Create resource
            const resource = new Resource({
                [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
                [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
                [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
                [SemanticResourceAttributes.HOST_NAME]: process.env.HOSTNAME || 'localhost',
            });

            // Create provider
            this.provider = new NodeTracerProvider({
                resource: resource,
                spanProcessors: [
                    new BatchSpanProcessor(
                        new OTLPTraceExporter({
                            url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317',
                            timeoutMillis: 10000,
                        })
                    )
                ]
            });

            // Register provider
            this.provider.register();

            // Register instrumentations
            this.registerInstrumentations();

            this.isInitialized = true;
            logger.info(`✅ OpenTelemetry initialized for ${serviceName}`);
        } catch (error) {
            logger.error('❌ OpenTelemetry initialization failed:', error);
        }
    }

    registerInstrumentations() {
        registerInstrumentations({
            instrumentations: [
                new ExpressInstrumentation({
                    ignoreLruCache: true,
                    enabled: true,
                }),
                new HttpInstrumentation({
                    ignoreIncomingPaths: ['/health', '/metrics', '/favicon.ico'],
                    enabled: true,
                }),
                new PinoInstrumentation({
                    enabled: true,
                }),
                new WinstonInstrumentation({
                    enabled: true,
                }),
                new MongoDBInstrumentation({
                    enabled: true,
                }),
                new RedisInstrumentation({
                    enabled: true,
                }),
            ]
        });
    }

    getTracer(name = 'truxify') {
        if (!this.isInitialized) {
            this.initialize();
        }
        return this.provider.getTracer(name);
    }

    createSpan(name, options = {}) {
        const tracer = this.getTracer();
        return tracer.startSpan(name, options);
    }

    async withSpan(name, fn, options = {}) {
        const tracer = this.getTracer();
        const span = tracer.startSpan(name, options);
        
        try {
            const result = await fn(span);
            span.end();
            return result;
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message });
            span.end();
            throw error;
        }
    }

    addAttributes(span, attributes) {
        if (span) {
            span.setAttributes(attributes);
        }
    }

    addEvent(span, name, attributes = {}) {
        if (span) {
            span.addEvent(name, attributes);
        }
    }

    getActiveSpan() {
        return this.provider?.getActiveSpan();
    }

    shutdown() {
        if (this.provider) {
            return this.provider.shutdown();
        }
    }
}

export default new Tracing();