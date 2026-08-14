#ifndef MEMORY_POOL_HPP
#define MEMORY_POOL_HPP

#include <atomic>
#include <vector>
#include <cstddef>
#include <stdexcept>

namespace TruxifyMemory {

// Free-list head is packed as (tag << kIndexBits) | index to defeat the ABA
// problem: a node can be popped, recycled and pushed back with a stale `next`
// pointer. Incrementing the tag on every push/pop makes the CAS fail if the
// head was reused in between, even when the index matches.
static constexpr size_t kIndexBits = 32;
static constexpr size_t kIndexMask = (size_t(1) << kIndexBits) - 1;
static constexpr size_t kTagIncrement = size_t(1) << kIndexBits;

template <typename T, size_t BlockCount>
class LockFreeMemoryPool {
public:
    LockFreeMemoryPool() {
        for (size_t i = 0; i < BlockCount; ++i) {
            nodes_[i].next.store(i + 1, std::memory_order_relaxed);
        }
        nodes_[BlockCount - 1].next.store(BlockCount, std::memory_order_relaxed); // End flag
        // Publish the initial free-list head with release so the packed layout
        // is visible to the first consumer.
        free_head_.store(pack(0, 0), std::memory_order_release);
    }

    T* allocate() {
        size_t packed = free_head_.load(std::memory_order_acquire);
        while (true) {
            size_t head = unpack_index(packed);
            if (head == BlockCount) {
                return nullptr; // Out of memory blocks
            }
            // Acquire: ensure the node's `next` is visible before we trust it.
            size_t next_free = nodes_[head].next.load(std::memory_order_acquire);
            size_t desired = pack(unpack_tag(packed) + 1, next_free);
            // Acq_rel on success: publish the new head and synchronize with the
            // matching release store in deallocate. Acquire on failure keeps the
            // reloaded head consistent for the next loop iteration.
            if (free_head_.compare_exchange_weak(packed, desired,
                    std::memory_order_acq_rel, std::memory_order_acquire)) {
                return &nodes_[head].data;
            }
        }
    }

    void deallocate(T* ptr) {
        size_t block_index = (reinterpret_cast<uintptr_t>(ptr) - reinterpret_cast<uintptr_t>(&nodes_[0].data)) / sizeof(Node);
        if (block_index >= BlockCount) {
            throw std::invalid_argument("Pointer does not belong to Memory Pool allocation boundaries");
        }

        size_t packed = free_head_.load(std::memory_order_acquire);
        while (true) {
            size_t head = unpack_index(packed);
            // Release: make the stored `next` (and the returned block's data)
            // visible to the consumer that publishes this node as head.
            nodes_[block_index].next.store(head, std::memory_order_release);
            size_t desired = pack(unpack_tag(packed) + 1, block_index);
            if (free_head_.compare_exchange_weak(packed, desired,
                    std::memory_order_acq_rel, std::memory_order_acquire)) {
                break;
            }
        }
    }

private:
    static size_t pack(size_t tag, size_t index) {
        return (tag << kIndexBits) | (index & kIndexMask);
    }
    static size_t unpack_tag(size_t packed) { return packed >> kIndexBits; }
    static size_t unpack_index(size_t packed) { return packed & kIndexMask; }

    struct Node {
        std::atomic<size_t> next;
        T data;
    };

    alignas(64) Node nodes_[BlockCount];
    alignas(64) std::atomic<size_t> free_head_;
};

} // namespace TruxifyMemory

#endif // MEMORY_POOL_HPP
