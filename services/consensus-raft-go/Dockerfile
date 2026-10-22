FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -o consensus-raft-go .

FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/consensus-raft-go .

EXPOSE 8089

USER nobody

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${RAFT_PORT:-8089}/api/v1/raft/status || exit 1

CMD ["./consensus-raft-go"]
