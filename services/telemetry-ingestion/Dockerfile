# Build Stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -o telemetry-ingestion .

# Final Production Stage
FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/telemetry-ingestion .

EXPOSE 8085

USER nobody

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${TELEMETRY_PORT:-8085}/api/v1/telemetry/health || exit 1

CMD ["./telemetry-ingestion"]
