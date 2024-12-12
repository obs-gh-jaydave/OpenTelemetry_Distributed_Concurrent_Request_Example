use axum::{
    extract::Request,
    middleware::Next,
    response::IntoResponse,
    routing::get,
    Router,
};
use opentelemetry::{global, trace::TracerProvider as _, KeyValue};
use opentelemetry::propagation::Extractor;
use opentelemetry::trace::TraceContextExt;
use opentelemetry_sdk::{Resource, trace::{self, Sampler}};
use opentelemetry_otlp::{SpanExporter, WithExportConfig, WithTonicConfig};
// use opentelemetry_otlp::WithHttpExporter;
use std::net::SocketAddr;
use std::time::Duration;
use tower_http::trace::TraceLayer;
use tracing::{debug, info, instrument, Level, Span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{EnvFilter, prelude::*};

// Extractor implementation for reading headers into OpenTelemetry
struct HeaderExtractor<'a>(&'a axum::http::HeaderMap);

impl<'a> Extractor for HeaderExtractor<'a> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|v| v.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|k| k.as_str()).collect()
    }
}

// Middleware to propagate context from incoming request headers
async fn propagate_context(
    request: Request,
    next: Next,
) -> impl IntoResponse {
    debug!("Extracting parent context from incoming request headers");
    let parent_cx = global::get_text_map_propagator(|prop| prop.extract(&HeaderExtractor(request.headers())));

    debug!("Setting parent context on the current tracing span");
    Span::current().set_parent(parent_cx);

    next.run(request).await
}

// Simple health check endpoint
async fn health_check() -> &'static str {
    debug!("Health check endpoint called, responding OK");
    "OK"
}

// Example instrumented handler
#[instrument(skip(headers))]
async fn handle_plan(headers: axum::http::HeaderMap) -> impl axum::response::IntoResponse {
    debug!("Handling /plan request");
    let parent_cx = global::get_text_map_propagator(|prop| prop.extract(&HeaderExtractor(&headers)));

    let span = Span::current();
    let span_context = parent_cx.span().span_context().clone();

    if span_context.is_valid() {
        debug!("Valid trace context found for /plan request");
        span.record("trace_id", &tracing::field::display(span_context.trace_id()));
        span.record("span_id", &tracing::field::display(span_context.span_id()));
    } else {
        debug!("No valid parent trace context found for /plan request");
    }

    info!(
        trace_id = %span_context.trace_id(),
        span_id = %span_context.span_id(),
        "Handling plan request"
    );

    axum::Json(serde_json::json!({
        "from": "ev-planner",
        "status": "success",
        "trace_id": span_context.trace_id().to_string(),
    }))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    debug!("Starting ev-planner service initialization");

    // Endpoint for OTLP
    let otlp_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://otel-collector:4318/v1/traces".to_string());
    info!("Using OTLP endpoint: {}", otlp_endpoint);

    // Build OTLP exporter using SpanExporter builder
    let exporter = opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(&otlp_endpoint)
        .with_timeout(std::time::Duration::from_secs(10))
        .build()?; // This returns a span exporter

    // Create a tracer provider with batch span processor and the given exporter
    let tracer_provider = trace::TracerProvider::builder()
        .with_config(
            trace::Config::default()
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", "ev-planner"),
                    KeyValue::new("service.namespace", "valhalla"),
                ]))
                .with_sampler(Sampler::AlwaysOn),
        )
        .with_batch_exporter(exporter, opentelemetry_sdk::runtime::Tokio)
        .build();

    // Set this tracer provider globally
    global::set_tracer_provider(tracer_provider.clone());

    // Get a tracer from the provider
    let tracer = tracer_provider.tracer("ev-planner");

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("ev_planner=debug,tower_http=debug"));

    // Attach the tracer to tracing via a layer
    let telemetry = tracing_opentelemetry::layer().with_tracer(tracer);

    let subscriber = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer()
            .with_target(true)
            .with_level(true)
            .with_file(true)
            .with_line_number(true))
        .with(env_filter)
        .with(telemetry);

    tracing::subscriber::set_global_default(subscriber)?;
    info!("Tracing initialized for ev-planner");

    // Build our Axum application
    let app = Router::new()
        .route("/plan", get(handle_plan))
        .route("/health", get(health_check))
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(|request: &Request| {
                    debug!("Creating a new span for incoming HTTP request");
                    let parent_cx = global::get_text_map_propagator(|prop| prop.extract(&HeaderExtractor(request.headers())));
                    let span_context = parent_cx.span().span_context().clone();

                    tracing::span!(
                        Level::INFO,
                        "http_request",
                        otel.name = "ev-planner-request",
                        otel.kind = "server",
                        trace_id = %span_context.trace_id(),
                        span_id = %span_context.span_id(),
                        http.method = %request.method(),
                        http.target = %request.uri().path(),
                        http.route = %request.uri().path(),
                        service.name = "ev-planner"
                    )
                })
                .on_request(|_req: &Request, _span: &Span| {
                    debug!("HTTP request received, starting processing");
                })
                .on_response(|_res: &axum::http::Response<_>, _latency: Duration, _span: &Span| {
                    debug!("Sending HTTP response");
                })
        )
        .layer(axum::middleware::from_fn(propagate_context));

    let addr = SocketAddr::from(([0, 0, 0, 0], 3001));
    info!("Starting server on {}", addr);

    // Setup a shutdown signal
    let shutdown = async {
        debug!("Waiting for shutdown signal (CTRL+C)");
        tokio::signal::ctrl_c()
            .await
            .expect("Failed to install CTRL+C signal handler");
        info!("Shutdown signal received");
    };

    // Start the server
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!("Server listening on {}", addr);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    info!("Server shutting down...");
    debug!("Shutting down tracer provider");
    opentelemetry::global::shutdown_tracer_provider();
    info!("ev-planner service has stopped cleanly");
    Ok(())
}
