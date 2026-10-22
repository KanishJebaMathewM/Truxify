FROM rust:1.75-slim AS builder

WORKDIR /app

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/target/release/truxify-zkp-verifier .

EXPOSE 8087

USER nobody

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail http://localhost:8087/health || exit 1

CMD ["./truxify-zkp-verifier"]
