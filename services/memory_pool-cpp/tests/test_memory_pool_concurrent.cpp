// Regression test for https://github.com/KanishJebaMathewM/Truxify/issues/11501
//
// Exercises the lock-free free-list from multiple threads to surface the
// data race / ABA problems that the all-relaxed atomics allowed. Build with a
// modern C++ compiler, e.g.:
//
//   g++ -std=c++17 -O2 -pthread \
//       services/memory_pool-cpp/tests/test_memory_pool_concurrent.cpp -o test_pool
//   ./test_pool
//
// Optionally run under ThreadSanitizer to detect any remaining races:
//
//   g++ -std=c++17 -O1 -g -fsanitize=thread -pthread \
//       services/memory_pool-cpp/tests/test_memory_pool_concurrent.cpp -o test_pool_tsan
//   ./test_pool_tsan

#include "../include/memory_pool.hpp"

#include <atomic>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <thread>
#include <vector>

struct TelemetryPacket {
    double latitude;
    double longitude;
    std::uint64_t sequence;
};

static constexpr size_t kBlocks = 64;
static constexpr size_t kThreads = 8;
static constexpr size_t kOpsPerThread = 20000;

int main() {
    TruxifyMemory::LockFreeMemoryPool<TelemetryPacket, kBlocks> pool;

    std::atomic<bool> start{false};
    std::atomic<std::uint64_t> allocated{0};
    std::atomic<std::uint64_t> freed{0};

    std::vector<std::thread> threads;
    threads.reserve(kThreads);

    for (size_t t = 0; t < kThreads; ++t) {
        threads.emplace_back([&]() {
            // Simple per-thread PRNG so we do not share mutable state.
            std::uint64_t seed = 0x9E3779B97F4A7C15ull + t * 2654435761ull;
            auto next_rand = [&]() {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                return seed;
            };

            std::vector<TelemetryPacket*> held;
            while (!start.load(std::memory_order_acquire)) {
                std::this_thread::yield();
            }

            for (size_t i = 0; i < kOpsPerThread; ++i) {
                if (held.size() < 4 || (next_rand() & 1u)) {
                    TelemetryPacket* p = pool.allocate();
                    if (p != nullptr) {
                        p->sequence = ++allocated;
                        p->latitude = 0.0;
                        p->longitude = 0.0;
                        held.push_back(p);
                    }
                } else if (!held.empty()) {
                    size_t idx = next_rand() % held.size();
                    TelemetryPacket* p = held[idx];
                    held[idx] = held.back();
                    held.pop_back();
                    // Verify the slot still belongs to the pool before freeing.
                    assert(p != nullptr);
                    ++freed;
                    pool.deallocate(p);
                }
            }

            for (TelemetryPacket* p : held) {
                ++freed;
                pool.deallocate(p);
            }
        });
    }

    start.store(true, std::memory_order_release);

    for (auto& th : threads) {
        th.join();
    }

    std::cout << "Allocations: " << allocated.load() << ", frees: " << freed.load() << std::endl;
    std::cout << "✅ C++ concurrent memory pool stress test completed." << std::endl;
    return 0;
}
