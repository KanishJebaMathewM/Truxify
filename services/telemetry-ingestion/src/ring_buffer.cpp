#include "../include/ring_buffer.hpp"
#include <iostream>

namespace TruxifyIngestion {

void runRingBufferDemo() {
    LockFreeSPSCQueue<TelemetryPacket, 1024> queue;

    TelemetryPacket p1{28.61, 77.20, 55.0f, 1775462400};
    if (queue.push(p1)) {
        std::cout << "Pushed telemetry packet successfully!" << std::endl;
    }

    TelemetryPacket popItem;
    if (queue.pop(popItem)) {
        std::cout << "Popped telemetry packet lat: " << popItem.latitude << std::endl;
    }
}

} // namespace TruxifyIngestion
