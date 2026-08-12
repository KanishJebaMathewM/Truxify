FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY main.go ./

RUN CGO_ENABLED=0 GOOS=linux go build -o consensus-raft-go .

FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/consensus-raft-go .

EXPOSE 8089

CMD ["./consensus-raft-go"]
