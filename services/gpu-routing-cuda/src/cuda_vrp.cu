#include "../include/cuda_vrp.cuh"
#include <cmath>
#include <numeric>

namespace TruxifyCuda {

namespace {
// Great-circle (haversine) distance in meters. `lat`/`lng` are degrees.
// `Location.x` is longitude and `Location.y` is latitude, matching the test
// reference (`refHaversine`) and the regression test for #11549. Using a
// local PI constant avoids any dependency on `M_PI` portability.
double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    const double kPi = 3.14159265358979323846;
    const double R = 6371000.0;
    double dLat = (lat2 - lat1) * kPi / 180.0;
    double dLng = (lng2 - lng1) * kPi / 180.0;
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * kPi / 180.0) * std::cos(lat2 * kPi / 180.0) *
                   std::sin(dLng / 2.0) * std::sin(dLng / 2.0);
    return 2.0 * R * std::asin(std::sqrt(a));
}
} // namespace

VrpSolution CudaVrpSolver::solveParallelVRP(
    const Location& depot,
    const std::vector<Location>& stops,
    size_t vehicleCapacity
) {
    if (stops.empty()) {
        return { 0.0f, 0, true };
    }
    // Reject zero capacity before the division below, which would otherwise be
    // a division-by-zero (UB / SIGFPE) on this reachable, non-empty input.
    if (vehicleCapacity == 0) {
        return { 0.0f, 0, false };
    }

    float distance = 0.0f;

    for (size_t rs = 0; rs < stops.size(); rs += vehicleCapacity) {
        size_t re = std::min(rs + vehicleCapacity, stops.size());
        Location prev = depot;
        for (size_t i = rs; i < re; ++i) {
            distance += static_cast<float>(haversineMeters(prev.y, prev.x, stops[i].y, stops[i].x));
            prev = stops[i];
        }
        // Return to depot for this route.
        distance += static_cast<float>(haversineMeters(prev.y, prev.x, depot.y, depot.x));
    }

    size_t routesNeeded = (stops.size() + vehicleCapacity - 1) / vehicleCapacity;

    return { distance, routesNeeded, true };
}

} // namespace TruxifyCuda
