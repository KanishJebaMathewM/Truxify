#include "../include/cuda_vrp.cuh"
#include <cmath>
#include <numeric>

namespace TruxifyCuda {

VrpSolution CudaVrpSolver::solveParallelVRP(
    const Location& depot,
    const std::vector<Location>& stops,
    size_t vehicleCapacity
) {
    if (stops.empty()) {
        return { 0.0f, 0, true };
    }

    float distance = 0.0f;
    Location prev = depot;

    for (const auto& stop : stops) {
        float dx = stop.x - prev.x;
        float dy = stop.y - prev.y;
        distance += std::sqrt(dx * dx + dy * dy);
        prev = stop;
    }

    // Return to depot
    float dx = depot.x - prev.x;
    float dy = depot.y - prev.y;
    distance += std::sqrt(dx * dx + dy * dy);

    size_t routesNeeded = (stops.size() + vehicleCapacity - 1) / vehicleCapacity;

    return { distance, routesNeeded, true };
}

} // namespace TruxifyCuda
