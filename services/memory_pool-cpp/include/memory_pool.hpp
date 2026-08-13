#ifndef MEMORY_POOL_HPP
#define MEMORY_POOL_HPP

#include <atomic>
#include <vector>
#include <cstddef>
#include <cstdint>
#include <stdexcept>

namespace TruxifyMemory {

// Pack a free-list index (low 32 bits) and an ABA-defeating version tag
// (high 32 bits) into a single 64-bit word so a compare-and-swap can observe
// both the pointer and how many times it has been recycled.
inline constexpr uint64_t pack_ptr(uint32_t index, uint32_t tag) {
    return (static_cast<uint64_t>(tag) << 32) | static_cast<uint64_t>(index);
}
inline constexpr uint32_t unpack_index(uint64_t p) {
    return static_cast<uint32_t>(p & 0xFFFFFFFFu);
}
inline constexpr uint32_t unpack_tag(uint64_t p) {
    return static_cast<uint32_t>(p >> 32);
}

template <typename T, size_t BlockCount>
class LockFreeMemoryPool {
public:
    LockFreeMemoryPool() {
        for (size_t i = 0; i < BlockCount; ++i) {
            // Initially node i points at node i+1 (end flag == BlockCount).
            nodes_[i].next.store(pack_ptr(static_cast<uint32_t>(i + 1), 0),
                                 std::memory_order_relaxed);
        }
        free_head_.store(pack_ptr(0, 0), std::memory_order_relaxed);
    }

    T* allocate() {
        uint64_t head = free_head_.load(std::memory_order_acquire);
        while (true) {
            uint32_t idx = unpack_index(head);
            if (idx == BlockCount) {
                return nullptr; // Out of memory blocks
            }
            // Acquire the next link so the release store performed by a prior
            // deallocate synchronizes-with this load: any payload written into
            // the block before it was freed becomes visible to the caller.
            uint64_t next_packed = nodes_[idx].next.load(std::memory_order_acquire);
            uint32_t next_idx = unpack_index(next_packed);
            uint32_t next_tag = unpack_tag(next_packed);
            // Bump the version tag on every successful pop so a recycled block
            // cannot satisfy the CAS via the classic ABA pattern.
            uint64_t new_head = pack_ptr(next_idx, next_tag + 1);
            if (free_head_.compare_exchange_weak(head, new_head,
                                                 std::memory_order_acq_rel,
                                                 std::memory_order_acquire)) {
                return &nodes_[idx].data;
            }
        }
    }

    void deallocate(T* ptr) {
        size_t block_index = (reinterpret_cast<uintptr_t>(ptr) -
                              reinterpret_cast<uintptr_t>(&nodes_[0].data)) /
                             sizeof(Node);
        if (block_index >= BlockCount) {
            throw std::invalid_argument("Pointer does not belong to Memory Pool allocation boundaries");
        }

        uint64_t head = free_head_.load(std::memory_order_acquire);
        while (true) {
            uint32_t head_idx = unpack_index(head);
            uint32_t head_tag = unpack_tag(head);
            uint32_t new_tag = head_tag + 1;
            // Release-store the current head into this node's next link so a
            // later acquire load in allocate() publishes the payload.
            nodes_[block_index].next.store(pack_ptr(head_idx, new_tag),
                                            std::memory_order_release);
            uint64_t new_head = pack_ptr(static_cast<uint32_t>(block_index), new_tag);
            if (free_head_.compare_exchange_weak(head, new_head,
                                                 std::memory_order_acq_rel,
                                                 std::memory_order_acquire)) {
                break;
            }
        }
    }

private:
    struct Node {
        // Free-list link: packed (index:low32 | tag:high32).
        std::atomic<uint64_t> next;
        T data;
    };

    alignas(64) Node nodes_[BlockCount];
    alignas(64) std::atomic<uint64_t> free_head_;
};

} // namespace TruxifyMemory

#endif // MEMORY_POOL_HPP
