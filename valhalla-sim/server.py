import os
from http.server import BaseHTTPRequestHandler, HTTPServer

from opentelemetry import trace
from opentelemetry.propagate import get_global_textmap, set_global_textmap
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.trace import SpanKind, StatusCode
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# ------------------------------------------
# OpenTelemetry Initialization
# ------------------------------------------
# Create a Resource with service name
resource = Resource.create({"service.name": "valhalla-sim"})

# Create a TracerProvider and set it globally
tracer_provider = TracerProvider(resource=resource)

# Configure the OTLP exporter
otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318/v1/traces")
otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint)

# Add BatchSpanProcessor to TracerProvider
span_processor = BatchSpanProcessor(otlp_exporter)
tracer_provider.add_span_processor(span_processor)

# Set the global TracerProvider
trace.set_tracer_provider(tracer_provider)

# Get a tracer from the global provider
tracer = trace.get_tracer(__name__)

# Set global text map propagator (W3C Trace Context)
set_global_textmap(TraceContextTextMapPropagator())

# ------------------------------------------
# HTTP Request Handler
# ------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Extract the parent context from incoming request headers using the global propagator
        carrier = {k.lower(): v for k, v in self.headers.items()}
        parent_context = get_global_textmap().extract(carrier)

        # Start a server span to represent the handling of this incoming request
        with tracer.start_as_current_span(
            "incoming-request", 
            context=parent_context, 
            kind=SpanKind.SERVER
        ) as span:
            # Add attributes about the request
            span.set_attribute("http.method", "GET")
            span.set_attribute("http.target", self.path)
            span.set_attribute("http.host", self.headers.get('host', 'unknown'))

            if self.path == '/data':
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"from":"valhalla","result":"ok"}')
                span.set_attribute("http.status_code", 200)
            elif self.path == '/health':
                self.send_response(200)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b'OK')
                span.set_attribute("http.status_code", 200)
            else:
                self.send_response(404)
                self.end_headers()
                span.set_attribute("http.status_code", 404)
                span.set_status(StatusCode.ERROR)
                span.add_event("Resource not found")

# ------------------------------------------
# Server Entry Point
# ------------------------------------------
if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 3003), Handler)
    print("valhalla-sim running on 3003")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Shutting down the server...")
        server.server_close()
