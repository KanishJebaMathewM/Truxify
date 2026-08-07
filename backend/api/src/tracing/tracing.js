import { createRequire } from 'module';
import logger from '../middleware/logger.js';

const require = createRequire(import.meta.url);

let NodeTracerProvider;
let Resource;
let SemanticResourceAttributes;
let OTLPTraceExporter;
let BatchSpanProcessor;
let ExpressInstrumentation;
let HttpInstrumentation;
let registerInstrumentations;
let PinoInstrumentation;
let MongoDBInstrumentation;
let RedisInstrumentation;
let WinstonInstrumentation;
let trace;
let context;
let otelAvailable = false;

try {
  ({ NodeTracerProvider } = require('@opentelemetry/sdk-trace-node'));
  ({ Resource } = require('@opentelemetry/resources'));
  ({ SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions'));
  ({ OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc'));
  ({ BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base'));
  ({ ExpressInstrumentation } = require('@opentelemetry/instrumentation-express'));
  ({ HttpInstrumentation } = require('@opentelemetry/instrumentation-http'));
  ({ registerInstrumentations } = require('@opentelemetry/instrumentation'));
  ({ PinoInstrumentation } = require('@opentelemetry/instrumentation-pino'));
  ({ MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb'));
  ({ RedisInstrumentation } = require('@opentelemetry/instrumentation-redis'));
  ({ WinstonInstrumentation } = require('@opentelemetry/instrumentation-winston'));
  ({ trace, context } = require('@opentelemetry/api'));
  otelAvailable = true;
} catch (err) {
  logger.warn(`[tracing] OpenTelemetry packages unavailable; tracing disabled (${err.message})`);
}

class Tracing {
    constructor() {
        this.provider = null;
        this.isInitialized = false;
    }

    initialize(serviceName = 'truxify-api') {
        if (this.isInitialized) return;
        if (!otelAvailable) return;

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
        return trace.getSpan(context.active());
    }

    shutdown() {
        if (this.provider) {
            return this.provider.shutdown();
        }
    }
}

export default new Tracing();