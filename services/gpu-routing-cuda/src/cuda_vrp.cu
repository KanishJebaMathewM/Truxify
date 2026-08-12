#include "../include/cuda_vrp.cuh"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace TruxifyCuda {

namespace {
// Euclidean distance between two locations.
float distance(const Location& a, const Location& b) {
    float dx = b.x - a.x;
    float dy = b.y - a.y;
    return std::sqrt(dx * dx + dy * dy);
}
} // namespace

VrpSolution CudaVrpSolver::solveParallelVRP(
    const Location& depot,
    const std::vector<Location>& stops,
    size_t vehicleCapacity
) {
    // vehicleCapacity == 0 is degenerate caller input: the ceil division
    // below would underflow/wrap and divide by zero, crashing the process.
    // Reject it up front instead.
    if (vehicleCapacity == 0) {
        return { 0.0f, 0, false };
    }

    if (stops.empty()) {
        return { 0.0f, 0, true };
    }

    size_t routesNeeded = (stops.size() + vehicleCapacity - 1) / vehicleCapacity;

    // Partition the stops into capacity-bounded route sequences. Each route
    // leaves from the depot, visits at most `vehicleCapacity` stops, and
    // returns to the depot, so the returned distance is the actual sum of the
    // per-route tour distances reported by `routesNeeded`.
    float totalDistance = 0.0f;
    for (size_t routeStart = 0; routeStart < stops.size(); routeStart += vehicleCapacity) {
        size_t routeEnd = std::min(routeStart + vehicleCapacity, stops.size());

        Location prev = depot;
        for (size_t i = routeStart; i < routeEnd; ++i) {
            totalDistance += distance(prev, stops[i]);
            prev = stops[i];
        }
        totalDistance += distance(prev, depot);
    }

    return { totalDistance, routesNeeded, true };
}

} // namespace TruxifyCuda
