#include "../include/ring_buffer.hpp"
#include <iostream>
#include <cassert>

int main() {
    TruxifyIngestion::LockFreeSPSCQueue<int, 4> queue;

    assert(queue.push(10));
    assert(queue.push(20));
    assert(queue.push(30));
    assert(!queue.push(40)); // Full

    int val;
    assert(queue.pop(val) && val == 10);
    assert(queue.pop(val) && val == 20);
    assert(queue.pop(val) && val == 30);
    assert(!queue.pop(val)); // Empty

    std::cout << "✅ C++ Lock-Free SPSC Ring Buffer tests passed successfully." << std::endl;
    return 0;
}
