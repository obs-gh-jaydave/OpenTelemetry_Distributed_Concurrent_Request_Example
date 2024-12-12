# Stage 1: Build wheels using a Debian-based image
FROM python:3.11-slim as builder

WORKDIR /app

RUN pip install --no-cache-dir wheel

RUN pip wheel --no-cache-dir -w /wheels \
    opentelemetry-api \
    opentelemetry-sdk \
    opentelemetry-exporter-otlp-proto-http

# Stage 2: Use Debian-based image for the final build
FROM python:3.11-slim

WORKDIR /app

COPY server.py server.py

COPY --from=builder /wheels /wheels

RUN pip install --no-cache-dir --no-index --find-links=/wheels \
    opentelemetry-api \
    opentelemetry-sdk \
    opentelemetry-exporter-otlp-proto-http

EXPOSE 3003

CMD ["python", "server.py"]
