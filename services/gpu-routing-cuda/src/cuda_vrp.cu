#include "../include/cuda_vrp.cuh"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace TruxifyCuda {

namespace {
// Mean Earth radius (meters) for the great-circle approximation.
constexpr float kEarthRadiusMeters = 6371000.0f;
constexpr float kDeg2Rad = 3.14159265358979323846f / 180.0f;

// Great-circle (haversine) distance in meters between two geographic
// locations. `Location.x` is longitude (degrees) and `Location.y` is
// latitude (degrees); both are converted to radians before the haversine
// formula is applied. This replaces the previous Euclidean-on-degrees
// metric, which treated one degree of longitude equal to one degree of
// latitude and ignored meridian convergence.
float distance(const Location& a, const Location& b) {
    float lat1 = a.y * kDeg2Rad;
    float lat2 = b.y * kDeg2Rad;
    float dLat = (b.y - a.y) * kDeg2Rad;
    float dLng = (b.x - a.x) * kDeg2Rad;
    float h = std::sin(dLat * 0.5f) * std::sin(dLat * 0.5f) +
              std::cos(lat1) * std::cos(lat2) *
                  std::sin(dLng * 0.5f) * std::sin(dLng * 0.5f);
    return 2.0f * kEarthRadiusMeters * std::asin(std::sqrt(h));
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
