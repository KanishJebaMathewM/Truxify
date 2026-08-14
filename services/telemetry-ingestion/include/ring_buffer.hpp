#ifndef TELEMETRY_RING_BUFFER_HPP
#define TELEMETRY_RING_BUFFER_HPP

#include <atomic>
#include <vector>
#include <cstddef>

namespace TruxifyIngestion {

struct TelemetryPacket {
    double latitude;
    double longitude;
    float speed;
    uint64_t timestamp;
};

template <typename T, size_t Capacity>
class LockFreeSPSCQueue {
public:
    LockFreeSPSCQueue() : head_(0), tail_(0) {}

    bool push(const T& item) {
        size_t head = head_.load(std::memory_order_relaxed);
        size_t next_head = (head + 1) % Capacity;

        if (next_head == tail_.load(std::memory_order_acquire)) {
            return false; // Queue full
        }

        buffer_[head] = item;
        head_.store(next_head, std::memory_order_release);
        return true;
    }

    bool pop(T& item) {
        size_t tail = tail_.load(std::memory_order_relaxed);

        if (tail == head_.load(std::memory_order_acquire)) {
            return false; // Queue empty
        }

        item = buffer_[tail];
        tail_.store((tail + 1) % Capacity, std::memory_order_release);
        return true;
    }

private:
    alignas(64) T buffer_[Capacity];
    alignas(64) std::atomic<size_t> head_;
    alignas(64) std::atomic<size_t> tail_;
};

} // namespace TruxifyIngestion

#endif // TELEMETRY_RING_BUFFER_HPP
