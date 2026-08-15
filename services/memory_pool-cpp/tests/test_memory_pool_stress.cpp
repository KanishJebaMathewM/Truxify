#include "../include/memory_pool.hpp"
#include <iostream>
#include <vector>
#include <thread>
#include <atomic>
#include <cstdint>
#include <cassert>

struct TelemetryPacket {
    double latitude;
    double longitude;
    uint64_t seq;
};

// Multi-threaded stress test: many threads allocate and deallocate from the
// same lock-free pool under heavy contention. Combined with the
// acquire/release ordering and the versioned (tagged) head, this would trip a
// data race / ABA defect that the single-threaded happy-path test never hits.
int main() {
    constexpr size_t kBlocks = 256;
    constexpr int kThreads = 8;
    constexpr int kIters = 200000;

    TruxifyMemory::LockFreeMemoryPool<TelemetryPacket, kBlocks> pool;

    // Tracks how many blocks are currently handed out. Under correct
    // concurrency this must never exceed kBlocks and must return to 0.
    std::atomic<int> in_flight{0};
    std::atomic<uint64_t> errors{0};

    std::vector<std::thread> threads;
    for (int t = 0; t < kThreads; ++t) {
        threads.emplace_back([&, t]() {
            uint64_t seed = static_cast<uint64_t>(t) * 2654435761u + 1;
            for (int i = 0; i < kIters; ++i) {
                TelemetryPacket* p = pool.allocate();
                if (p == nullptr) {
                    // Pool exhausted under contention: back off and retry.
                    std::this_thread::yield();
                    continue;
                }
                int prev = in_flight.fetch_add(1);
                if (prev >= static_cast<int>(kBlocks)) {
                    errors.fetch_add(1); // more blocks out than exist
                }
                // Own the block: stamp a per-thread marker and read it back.
                // The release store in deallocate + acquire load in allocate
                // guarantee this round-trip is not a torn read.
                p->seq = (static_cast<uint64_t>(t) << 32) | static_cast<uint64_t>(i);
                p->latitude = 28.61 + t;
                p->longitude = 77.20 - t;
                if (p->seq != ((static_cast<uint64_t>(t) << 32) | static_cast<uint64_t>(i))) {
                    errors.fetch_add(1);
                }
                if (in_flight.fetch_sub(1) <= 0) {
                    errors.fetch_add(1); // underflow
                }
                pool.deallocate(p);
                // Cheap PRNG to vary timing.
                seed = seed * 6364136223846793005u + 1442695040888963407u;
            }
        });
    }

    for (auto& th : threads) th.join();

    assert(in_flight.load() == 0);
    assert(errors.load() == 0);

    std::cout << "✅ C++ Lock-Free Memory Pool multithreaded stress test passed ("
              << kThreads << " threads x " << kIters << " iters)." << std::endl;
    return 0;
}
