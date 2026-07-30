FROM gcc:12 AS builder

WORKDIR /app

COPY CMakeLists.txt main.cpp ./

RUN apt-get update && apt-get install -y cmake
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release
RUN cmake --build build

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /app/build/route-matrix-cpp .

EXPOSE 8086

CMD ["./route-matrix-cpp"]
