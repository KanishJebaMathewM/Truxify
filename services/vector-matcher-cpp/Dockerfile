FROM gcc:13 AS builder

WORKDIR /app

COPY CMakeLists.txt main.cpp ./
COPY include/ ./include/
COPY src/ ./src/

RUN apt-get update && apt-get install -y cmake
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release
RUN cmake --build build

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/build/vector-matcher-cpp .

EXPOSE 8088

CMD ["./vector-matcher-cpp"]
