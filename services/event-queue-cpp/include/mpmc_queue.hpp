#ifndef MPMC_QUEUE_HPP
#define MPMC_QUEUE_HPP

#include <atomic>
#include <vector>
#include <stdexcept>

namespace TruxifyQueue {

template <typename T, size_t Capacity>
class LockFreeMPMCQueue {
public:
    LockFreeMPMCQueue() {
        for (size_t i = 0; i < Capacity; ++i) {
            cells_[i].sequence.store(i, std::memory_order_relaxed);
        }
        enqueue_pos_.store(0, std::memory_order_relaxed);
        dequeue_pos_.store(0, std::memory_order_relaxed);
    }

    bool enqueue(const T& data) {
        int64_t pos = enqueue_pos_.load(std::memory_order_relaxed);
        while (true) {
            Cell* cell = &cells_[pos % Capacity];
            int64_t seq = cell->sequence.load(std::memory_order_acquire);
            int64_t diff = static_cast<int64_t>(seq) - static_cast<int64_t>(pos);

            if (diff == 0) {
                if (enqueue_pos_.compare_exchange_weak(pos, pos + 1, std::memory_order_relaxed)) {
                    cell->data = data;
                    cell->sequence.store(pos + 1, std::memory_order_release);
                    return true;
                }
            } else if (diff < 0) {
                return false; // Queue is full
            } else {
                pos = enqueue_pos_.load(std::memory_order_relaxed);
            }
        }
    }

    bool dequeue(T& data) {
        int64_t pos = dequeue_pos_.load(std::memory_order_relaxed);
        while (true) {
            Cell* cell = &cells_[pos % Capacity];
            int64_t seq = cell->sequence.load(std::memory_order_acquire);
            int64_t diff = static_cast<int64_t>(seq) - static_cast<int64_t>(pos + 1);

            if (diff == 0) {
                if (dequeue_pos_.compare_exchange_weak(pos, pos + 1, std::memory_order_relaxed)) {
                    data = cell->data;
                    cell->sequence.store(pos + Capacity, std::memory_order_release);
                    return true;
                }
            } else if (diff < 0) {
                return false; // Queue is empty
            } else {
                pos = dequeue_pos_.load(std::memory_order_relaxed);
            }
        }
    }

private:
    struct Cell {
        std::atomic<int64_t> sequence;
        T data;
    };

    alignas(64) Cell cells_[Capacity];
    alignas(64) std::atomic<int64_t> enqueue_pos_{0};
    alignas(64) std::atomic<int64_t> dequeue_pos_{0};
};

} // namespace TruxifyQueue

#endif // MPMC_QUEUE_HPP
