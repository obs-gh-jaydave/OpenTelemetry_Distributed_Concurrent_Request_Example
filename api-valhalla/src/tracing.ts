import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { Span } from '@opentelemetry/api';
import * as http from 'http';

const traceExporter = new OTLPTraceExporter({
  url: 'http://otel-collector:4318/v1/traces',
});

const httpInstrumentation = new HttpInstrumentation({
  ignoreIncomingPaths: ['/health'],
  // Removed propagateTrace line
  requestHook: (span: Span, request: http.ClientRequest | http.IncomingMessage) => {
    if (request instanceof http.IncomingMessage) {
      span.setAttribute('http.route', request.url || '');
      const traceHeaders = ['traceparent', 'tracestate'];
      for (const header of traceHeaders) {
        const value = request.headers[header];
        if (value) {
          span.setAttribute(`http.header.${header}`, value as string);
        }
      }
    }
  }
});

const expressInstrumentation = new ExpressInstrumentation({
  requestHook: (span: Span, req) => {
    span.setAttribute('request.id', Math.random().toString(36).substring(7));
    span.setAttribute('service.name', 'api-valhalla');
  },
  // Removed includeHttpAttributes line
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'api-valhalla',
    [SemanticResourceAttributes.SERVICE_VERSION]: '1.0.0',
    'service.namespace': 'valhalla',
    'deployment.environment': 'production'
  }),
  textMapPropagator: new W3CTraceContextPropagator(),
  contextManager: new AsyncLocalStorageContextManager().enable(),
  traceExporter,
  instrumentations: [httpInstrumentation, expressInstrumentation],
  spanLimits: {
    attributeValueLengthLimit: 100,
    attributeCountLimit: 10,
  }
});

async function initTracing() {
  console.debug('[api-valhalla] Initializing tracing with OTLP endpoint:', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  await sdk.start();
  console.debug('[api-valhalla] Tracing initialized and SDK started successfully');
}

// Handle cleanup on exit
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Tracing terminated'))
    .catch((error) => console.error('Error terminating tracing', error))
    .finally(() => process.exit(0));
});

initTracing().catch((error: unknown) => {
  console.error('Error initializing tracing', error);
});