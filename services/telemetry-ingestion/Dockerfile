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

CMD ["./telemetry-ingestion"]
