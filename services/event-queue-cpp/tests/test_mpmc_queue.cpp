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
    return 0;
}
