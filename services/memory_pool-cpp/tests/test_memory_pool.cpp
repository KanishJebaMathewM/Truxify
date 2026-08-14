#include "../include/memory_pool.hpp"
#include <iostream>
#include <cassert>

struct TelemetryPacket {
    double latitude;
    double longitude;
};

int main() {
    TruxifyMemory::LockFreeMemoryPool<TelemetryPacket, 3> pool;

    TelemetryPacket* p1 = pool.allocate();
    assert(p1 != nullptr);
    p1->latitude = 28.61;
    p1->longitude = 77.20;

    TelemetryPacket* p2 = pool.allocate();
    assert(p2 != nullptr);

    TelemetryPacket* p3 = pool.allocate();
    assert(p3 != nullptr);

    TelemetryPacket* p4 = pool.allocate();
    assert(p4 == nullptr); // Pool empty

    pool.deallocate(p1);
    
    TelemetryPacket* p5 = pool.allocate();
    assert(p5 == p1); // Recycled memory block slot

    std::cout << "✅ C++ Lock-Free Memory Pool tests passed successfully." << std::endl;
    return 0;
}
