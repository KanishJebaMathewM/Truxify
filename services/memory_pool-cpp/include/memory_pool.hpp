#ifndef MEMORY_POOL_HPP
#define MEMORY_POOL_HPP

#include <atomic>
#include <vector>
#include <cstddef>
#include <stdexcept>

namespace TruxifyMemory {

template <typename T, size_t BlockCount>
class LockFreeMemoryPool {
public:
    LockFreeMemoryPool() {
        for (size_t i = 0; i < BlockCount; ++i) {
            nodes_[i].next.store(i + 1, std::memory_order_relaxed);
        }
        nodes_[BlockCount - 1].next.store(BlockCount, std::memory_order_relaxed); // End flag
        free_head_.store(0, std::memory_order_relaxed);
    }

    T* allocate() {
        size_t head = free_head_.load(std::memory_order_relaxed);
        while (true) {
            if (head == BlockCount) {
                return nullptr; // Out of memory blocks
            }
            size_t next_free = nodes_[head].next.load(std::memory_order_relaxed);
            if (free_head_.compare_exchange_weak(head, next_free, std::memory_order_relaxed)) {
                return &nodes_[head].data;
            }
        }
    }

    void deallocate(T* ptr) {
        size_t block_index = (reinterpret_cast<uintptr_t>(ptr) - reinterpret_cast<uintptr_t>(&nodes_[0].data)) / sizeof(Node);
        if (block_index >= BlockCount) {
            throw std::invalid_argument("Pointer does not belong to Memory Pool allocation boundaries");
        }

        size_t head = free_head_.load(std::memory_order_relaxed);
        while (true) {
            nodes_[block_index].next.store(head, std::memory_order_relaxed);
            if (free_head_.compare_exchange_weak(head, block_index, std::memory_order_relaxed)) {
                break;
            }
        }
    }

private:
    struct Node {
        std::atomic<size_t> next;
        T data;
    };

    alignas(64) Node nodes_[BlockCount];
    alignas(64) std::atomic<size_t> free_head_;
};

} // namespace TruxifyMemory

#endif // MEMORY_POOL_HPP
