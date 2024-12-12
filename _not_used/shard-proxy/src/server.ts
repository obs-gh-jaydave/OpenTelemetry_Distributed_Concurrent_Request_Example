import './tracing';
import { context, trace, TextMapGetter } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import express from 'express';
import axios from 'axios';

const app = express();

const getter: TextMapGetter = {
  get(carrier: Record<string, any>, key: string) {
    return carrier[key.toLowerCase()];
  },
  keys(carrier: Record<string, any>) {
    return Object.keys(carrier);
  },
};

app.get('/health', async (req: express.Request, res: express.Response) => {
  res.status(200).send('OK');
});

app.get('/shard', async (req, res) => {
  try {
    const propagator = new W3CTraceContextPropagator();

    // Extract context from incoming headers
    const extractedContext = propagator.extract(context.active(), req.headers as Record<string, string>, getter);

    // Start a new span as child of extracted context
    const tracer = trace.getTracer('shard-proxy');
    const span = tracer.startSpan('handle /shard', undefined, extractedContext);
    const ctxWithSpan = trace.setSpan(extractedContext, span);

    console.debug('[shard-proxy] /shard called');
    console.debug('[shard-proxy] Trace ID:', span.spanContext().traceId);
    console.debug('[shard-proxy] Span ID:', span.spanContext().spanId);

    // Inject context into outgoing request
    const headers: Record<string, string> = {};
    const setter = {
      set(carrier: Record<string, string>, key: string, value: string) {
        carrier[key] = value;
      }
    };
    propagator.inject(ctxWithSpan, headers, setter);

    const response = await context.with(ctxWithSpan, () => axios.get('http://valhalla:3003/data', { headers }));

    res.json({ from: 'shard-proxy', data: response.data });
    span.end();
  } catch (error: any) {
    console.error('[shard-proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3002, () => {
  console.log('shard-proxy running on port 3002');
});