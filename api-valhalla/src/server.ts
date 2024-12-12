import './tracing';
import { context, trace, TextMapGetter, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';

const app = express();

// TextMapGetter for extracting propagation headers from incoming requests
const getter: TextMapGetter = {
  get(carrier: Record<string, any>, key: string) {
    return carrier[key.toLowerCase()];
  },
  keys(carrier: Record<string, any>) {
    return Object.keys(carrier);
  },
};

interface TraceRequest extends Request {
  traceContext?: ReturnType<typeof context.active>;
}

// Middleware to start the incoming-request span and store context on req
function traceMiddleware(req: TraceRequest, res: Response, next: NextFunction) {
  const propagator = new W3CTraceContextPropagator();
  
  // Extract context from incoming headers
  const extractedContext = propagator.extract(context.active(), req.headers as Record<string, string>, getter);

  const tracer = trace.getTracer('api-valhalla');
  // Start the incoming-request span as a child of extractedContext
  const incomingSpan = tracer.startSpan('incoming-request', undefined, extractedContext);
  
  // Make this span active for the lifetime of this request
  const ctxWithSpan = trace.setSpan(extractedContext, incomingSpan);

  // Store the context so we can use it later for outgoing requests
  req.traceContext = ctxWithSpan;

  // When the response is finished, end the incoming-request span
  res.on('finish', () => {
    incomingSpan.setAttribute('http.status_code', res.statusCode);
    incomingSpan.end();
  });

  // Move to the next middleware with the context active
  context.with(ctxWithSpan, next);
}

// Function to make the outgoing request to valhalla-sim using the stored context
async function callValhallaSim(ctx: ReturnType<typeof context.active>) {
  const tracer = trace.getTracer('api-valhalla');
  const parentSpan = trace.getSpan(ctx);
  
  // Start the outgoing-request span as a child of the incoming-request span
  const outgoingSpan = tracer.startSpan('outgoing-request', { 
    attributes: { 'http.url': 'http://valhalla-sim:3003/data' }
  }, ctx);

  // Inject context into outgoing request headers
  const headers: Record<string, string> = {};
  propagation.inject(ctx, headers);

  let responseData;
  try {
    // Perform the outgoing request within the outgoingSpan context
    responseData = await context.with(trace.setSpan(ctx, outgoingSpan), async () => {
      const response = await axios.get('http://valhalla-sim:3003/data', { headers });
      return response.data;
    });
  } catch (err: any) {
    outgoingSpan.recordException(err);
    outgoingSpan.setStatus({ code: 2, message: err.message });
    throw err;
  } finally {
    outgoingSpan.end();
  }

  return responseData;
}

app.use(traceMiddleware);

app.get('/health', (req, res) => {
  res.send('OK');
});

app.get('/route', async (req: TraceRequest, res: Response) => {
  // Now we can use req.traceContext which includes the incoming-request span context
  if (!req.traceContext) {
    // This should never happen if our middleware is correctly set up
    console.error('No trace context available on request!');
    return res.status(500).send('No trace context');
  }

  try {
    const data = await callValhallaSim(req.traceContext);
    res.json({ from: 'api-valhalla', data });
  } catch (error: any) {
    console.error('[api-valhalla] Error in /route handler:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000, () => {
  console.log('api-valhalla running on port 3000');
});