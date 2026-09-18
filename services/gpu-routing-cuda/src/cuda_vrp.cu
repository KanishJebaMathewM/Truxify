#include "../include/cuda_vrp.cuh"
#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <vector>

namespace TruxifyCuda {

namespace {

bool isValidLocation(const Location& location) {
    return std::isfinite(location.x) && std::isfinite(location.y) &&
           location.x >= -180.0f && location.x <= 180.0f &&
           location.y >= -90.0f && location.y <= 90.0f;
}

double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    const double kPi = 3.14159265358979323846;
    const double R = 6371000.0;
    double dLat = (lat2 - lat1) * kPi / 180.0;
    double dLng = (lng2 - lng1) * kPi / 180.0;
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * kPi / 180.0) * std::cos(lat2 * kPi / 180.0) *
                   std::sin(dLng / 2.0) * std::sin(dLng / 2.0);
    a = std::clamp(a, 0.0, 1.0);
    return 2.0 * R * std::asin(std::sqrt(a));
}

double closedRouteDistance(const Location& depot, const std::vector<Location>& route) {
    if (route.empty()) {
        return 0.0;
    }

    double distance = haversineMeters(depot.y, depot.x, route.front().y, route.front().x);
    for (size_t i = 1; i < route.size(); ++i) {
        distance += haversineMeters(
            route[i - 1].y,
            route[i - 1].x,
            route[i].y,
            route[i].x
        );
    }
    distance += haversineMeters(route.back().y, route.back().x, depot.y, depot.x);
    return distance;
}

void improveRoute2Opt(const Location& depot, std::vector<Location>& route) {
    if (route.size() < 3) {
        return;
    }

    constexpr double kImprovementEpsilon = 1e-6;
    bool improved = true;
    while (improved) {
        improved = false;

        for (size_t i = 0; i + 1 < route.size(); ++i) {
            const Location& left = i == 0 ? depot : route[i - 1];
            const Location& first = route[i];

            for (size_t k = i + 1; k < route.size(); ++k) {
                const Location& last = route[k];
                const Location& right = k + 1 == route.size() ? depot : route[k + 1];

                double currentEdges =
                    haversineMeters(left.y, left.x, first.y, first.x) +
                    haversineMeters(last.y, last.x, right.y, right.x);
                double candidateEdges =
                    haversineMeters(left.y, left.x, last.y, last.x) +
                    haversineMeters(first.y, first.x, right.y, right.x);

                if (candidateEdges + kImprovementEpsilon < currentEdges) {
                    std::reverse(route.begin() + static_cast<std::ptrdiff_t>(i),
                                 route.begin() + static_cast<std::ptrdiff_t>(k + 1));
                    improved = true;
                    break;
                }
            }

            if (improved) {
                break;
            }
        }
    }
}

std::vector<Location> buildRoute(
    const Location& depot,
    const std::vector<Location>& stops,
    std::vector<size_t>& remaining,
    size_t routeCapacity
) {
    std::vector<Location> route;
    route.reserve(std::min(routeCapacity, remaining.size()));

    Location current = depot;
    const size_t routeSize = std::min(routeCapacity, remaining.size());

    for (size_t slot = 0; slot < routeSize; ++slot) {
        size_t bestPosition = 0;
        double bestDistance = std::numeric_limits<double>::infinity();

        for (size_t position = 0; position < remaining.size(); ++position) {
            const Location& candidate = stops[remaining[position]];
            double candidateDistance = haversineMeters(
                current.y,
                current.x,
                candidate.y,
                candidate.x
            );

            const Location& bestCandidate = stops[remaining[bestPosition]];
            bool better = candidateDistance + 1e-9 < bestDistance;
            if (!better && std::fabs(candidateDistance - bestDistance) <= 1e-9) {
                better = candidate.x < bestCandidate.x ||
                         (candidate.x == bestCandidate.x && candidate.y < bestCandidate.y);
            }

            if (better) {
                bestDistance = candidateDistance;
                bestPosition = position;
            }
        }

        size_t selectedIndex = remaining[bestPosition];
        route.push_back(stops[selectedIndex]);
        current = stops[selectedIndex];
        remaining.erase(remaining.begin() + static_cast<std::ptrdiff_t>(bestPosition));
    }

    improveRoute2Opt(depot, route);
    return route;
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
    // Reject invalid coordinates before routing so malformed values can never
    // produce NaN/Inf route distances that are marked as valid solutions.
    if (!isValidLocation(depot)) {
        return { 0.0f, 0, false };
    }
    for (const auto& stop : stops) {
        if (!isValidLocation(stop)) {
            return { 0.0f, 0, false };
        }
    }
    if (vehicleCapacity == 0) {
        return { 0.0f, 0, false };
    }

    std::vector<size_t> remaining(stops.size());
    std::iota(remaining.begin(), remaining.end(), 0);

    double totalDistance = 0.0;
    size_t routeCount = 0;

    while (!remaining.empty()) {
        std::vector<Location> route = buildRoute(
            depot,
            stops,
            remaining,
            vehicleCapacity
        );
        totalDistance += closedRouteDistance(depot, route);
        ++routeCount;
    }

    return {
        static_cast<float>(totalDistance),
        routeCount,
        std::isfinite(totalDistance)
    };
}

} // namespace TruxifyCuda
