from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.sdk.resources import Resource
import os
import logging

logger = logging.getLogger(__name__)

class Tracing:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        self.provider = None
        self.is_initialized = False
    
    def initialize(self, service_name="truxify-ml"):
        if self.is_initialized:
            return
        
        try:
            # Create resource
            resource = Resource.create({
                "service.name": service_name,
                "service.version": "1.0.0",
                "deployment.environment": os.getenv("ENVIRONMENT", "development"),
            })
            
            # Create provider
            self.provider = TracerProvider(resource=resource)
            
            # Add span processor
            otlp_exporter = OTLPSpanExporter(
                endpoint=os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317"),
                insecure=True,
            )
            self.provider.add_span_processor(
                BatchSpanProcessor(otlp_exporter)
            )
            
            # Set provider
            trace.set_tracer_provider(self.provider)
            
            self.is_initialized = True
            logger.info(f"✅ OpenTelemetry initialized for {service_name}")
            
        except Exception as e:
            logger.error(f"❌ OpenTelemetry initialization failed: {e}")
    
    def instrument_fastapi(self, app):
        """Instrument FastAPI application"""
        if self.is_initialized:
            FastAPIInstrumentor.instrument_app(
                app,
                tracer_provider=self.provider,
                excluded_urls="/health,/metrics"
            )
            logger.info("✅ FastAPI instrumented")
    
    def instrument_requests(self):
        """Instrument requests library"""
        if self.is_initialized:
            RequestsInstrumentor().instrument(tracer_provider=self.provider)
            logger.info("✅ Requests instrumented")
    
    def instrument_sqlalchemy(self, engine):
        """Instrument SQLAlchemy"""
        if self.is_initialized:
            SQLAlchemyInstrumentor().instrument(
                engine=engine,
                tracer_provider=self.provider
            )
            logger.info("✅ SQLAlchemy instrumented")
    
    def get_tracer(self, name="truxify-ml"):
        if not self.is_initialized:
            self.initialize()
        return trace.get_tracer(name)
    
    def create_span(self, name):
        tracer = self.get_tracer()
        return tracer.start_span(name)
    
    def shutdown(self):
        if self.provider:
            self.provider.shutdown()

tracing = Tracing()