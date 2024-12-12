# Valhalla Distributed Tracing Example

This project demonstrates how to set up distributed tracing between two services—**api-valhalla** and **valhalla-sim**—using [OpenTelemetry](https://opentelemetry.io/). Traces are exported to an OpenTelemetry collector and then forwarded to a backend (like [Observe](https://www.observeinc.com)) for visualization and analysis.

## Overview

- **api-valhalla**: A Node.js service (Express-based) that receives incoming requests.  
  - It extracts the incoming trace context from requests, starts a server span, and then makes an outgoing request to `valhalla-sim`.
  - It propagates the trace context downstream, ensuring the entire request flow can be observed as a single distributed trace.
  
- **valhalla-sim**: A Python-based service that simulates a downstream dependency.
  - It receives requests from `api-valhalla`, extracts the trace context, and starts a new server span to represent its part of the flow.
  - Responses and their attributes (such as HTTP status codes) are recorded as spans, completing the distributed trace.

- **OpenTelemetry Collector**:
  - Both services send their spans to the collector via the OTLP protocol.
  - The collector can then export traces to your chosen backend (e.g. Observe).

## Components

1. **OpenTelemetry Instrumentation**:
   - `api-valhalla` (Node.js):
     - Uses `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http`, and instrumentation for HTTP/Express.
     - Extracts and injects W3C Trace Context headers to link spans across services.
   - `valhalla-sim` (Python):
     - Uses `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, and `TraceContextTextMapPropagator`.
     - On each incoming request, it starts a server span, sets attributes, and sends spans to the OTLP exporter.
   
2. **OpenTelemetry Collector**:
   - Configured via `otel-collector-config.yaml`.
   - Receives traces on `0.0.0.0:4317`/`0.0.0.0:4318` and exports them to Observe (or another backend) per the configuration.
   
3. **Loader** (Artillery-based):
   - A simple load generator that sends concurrent requests to `api-valhalla` to test tracing under load.
   - This helps you visualize how many spans are created and how they are linked in the backend.

## Running the Project

1. **Prerequisites**:
   - Docker and Docker Compose installed.

2. **Build and Start All Services**:
   ```bash
   docker compose up --build
   ```

This command:
- Builds and runs `api-valhalla`, `valhalla-sim`, `loader`, and `otel-collector`.
- `api-valhalla` listens on port `3000`.
- `valhalla-sim` listens on port `3003`.
- The loader can generate concurrent requests to `api-valhalla`.

3. Send Requests:
- Check `api-valhalla` health:

    ```
    curl http://localhost:3000/health
    ```
- Trigger a route call (which calls `valhalla-sim`):
    ```
    curl http://localhost:3000/route
    ```
    
    Spans from `api-valhalla` and `valhalla-sim` will be sent to the collector and then to your backend (Observe).
    
## Viewing Traces

After running the services and sending requests:

- **If using Observe or another OTLP-compatible backend**, navigate to that backend’s interface to view traces.
- You should see traces that include spans from both **api-valhalla** and **valhalla-sim**, linked by a common `trace_id`.
- Each service’s spans appear in the timeline, showing the propagation of context across service boundaries.

## Customization

- **Changing Backend:**  
  Modify `OTEL_EXPORTER_OTLP_ENDPOINT` in the environment variables or `otel-collector-config.yaml` to point to a different OTLP endpoint.

- **Adding More Services:**  
  Add more services similarly instrumented with OpenTelemetry. As long as they propagate `traceparent` headers, the entire transaction will be visible as a single distributed trace.

## Troubleshooting

- **No Traces Appear:**
  - Check that `api-valhalla` and `valhalla-sim` logs show successful initialization of OpenTelemetry.
  - Verify `OTEL_EXPORTER_OTLP_ENDPOINT` and confirm the collector is running.

- **Trace Context Not Propagated:**
  - Ensure that the incoming requests contain a `traceparent` header if you expect them to continue an existing trace.
  - Confirm that your code calls `propagation.inject()` on outgoing requests and `propagation.extract()` on incoming requests.

    
