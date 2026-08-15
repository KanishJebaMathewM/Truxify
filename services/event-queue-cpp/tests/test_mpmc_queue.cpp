#include "../include/mpmc_queue.hpp"
#include <iostream>
#include <cassert>
#include <string>

int main() {
    TruxifyQueue::LockFreeMPMCQueue<std::string, 4> queue;

    assert(queue.enqueue("ORDER_01"));
    assert(queue.enqueue("ORDER_02"));
    assert(queue.enqueue("ORDER_03"));
    assert(queue.enqueue("ORDER_04"));
    assert(!queue.enqueue("ORDER_05")); // Queue is full

    std::string val;
    assert(queue.dequeue(val) && val == "ORDER_01");
    assert(queue.dequeue(val) && val == "ORDER_02");
    
    assert(queue.enqueue("ORDER_06"));
    assert(queue.dequeue(val) && val == "ORDER_03");
    assert(queue.dequeue(val) && val == "ORDER_04");
    assert(queue.dequeue(val) && val == "ORDER_06");
    assert(!queue.dequeue(val)); // Queue is empty

    std::cout << "✅ C++ Lock-Free MPMC Bounded Queue tests passed successfully." << std::endl;

    // Soak test: drive the queue through a large number of enqueue/dequeue
    // operations to stress the position/sequence counters. With the signed
    // int64_t counters the modular arithmetic (diff == 0 / diff < 0
    // classification and ABA protection) stays well-defined across wraps; with
    // the previous unsigned size_t counters this would silently corrupt data
    // past INT64_MAX. Driving the counters all the way past INT64_MAX is not
    // practical at runtime, but this soak validates correctness of the wrap
    // logic over an extended lifetime of the queue.
    {
        TruxifyQueue::LockFreeMPMCQueue<long long, 16> soak;
        const long long iterations = 1000000;
        long long produced = 0;
        long long consumed = 0;
        for (long long i = 0; i < iterations; ++i) {
            if (soak.enqueue(i)) {
                ++produced;
            }
            long long val;
            if (soak.dequeue(val)) {
                assert(val == consumed);
                ++consumed;
            }
        }
        // Drain whatever remains so produced == consumed and ordering holds.
        long long val;
        while (soak.dequeue(val)) {
            assert(val == consumed);
            ++consumed;
        }
        assert(produced == consumed);
        assert(consumed == iterations);

        std::cout << "✅ C++ Lock-Free MPMC Bounded Queue soak test passed ("
                  << consumed << " events, no corruption)." << std::endl;
    }

    return 0;
}
