#include "cuda_vrp.cuh"
#include <cmath>
#include <cstdio>
#include <vector>

using TruxifyCuda::Location;
using TruxifyCuda::VrpSolution;

static int failures = 0;

static void check(bool cond, const char* what) {
    if (!cond) {
        std::printf("FAIL: %s\n", what);
        failures++;
    }
}

static float approx(float a, float b) {
    return std::fabs(a - b) < 1e-4f;
}

// Relative comparison used for great-circle distances, which are large (meters).
static bool approxRel(float a, float b, float tol) {
    float denom = std::fabs(a) > 1e-6f ? std::fabs(a) : 1.0f;
    return std::fabs(a - b) / denom < tol;
}

// Independent (double-precision) reference haversine in meters. `x` is
// longitude, `y` is latitude, both in degrees. Used to validate the CUDA
// implementation and to guard against regressing to a Euclidean metric.
static const double kPi = 3.14159265358979323846;
static const double kEarthRadiusM = 6371000.0;

static double refHaversine(double lat1, double lng1, double lat2, double lng2) {
    double dLat = (lat2 - lat1) * kPi / 180.0;
    double dLng = (lng2 - lng1) * kPi / 180.0;
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * kPi / 180.0) * std::cos(lat2 * kPi / 180.0) *
                   std::sin(dLng / 2.0) * std::sin(dLng / 2.0);
    return 2.0 * kEarthRadiusM * std::asin(std::sqrt(a));
}

// Reference great-circle total tour distance mirroring solveParallelVRP's
// capacity-bounded routing, so the routing-logic assertions stay meaningful
// under the new metric.
static float refTourTotal(const Location& depot,
                          const std::vector<Location>& stops,
                          size_t cap) {
    double tot = 0.0;
    for (size_t rs = 0; rs < stops.size(); rs += cap) {
        size_t re = std::min(rs + cap, stops.size());
        Location prev = depot;
        for (size_t i = rs; i < re; ++i) {
            tot += refHaversine(prev.y, prev.x, stops[i].y, stops[i].x);
            prev = stops[i];
        }
        tot += refHaversine(prev.y, prev.x, depot.y, depot.x);
    }
    return static_cast<float>(tot);
}

int main() {
    const Location depot{0.0f, 0.0f};
    const std::vector<Location> stops = {
        {1.0f, 0.0f},
        {2.0f, 0.0f},
        {3.0f, 0.0f},
    };

    // vehicleCapacity == 0 must be rejected without crashing (no division by
    // zero / underflow).
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 0);
        check(!s.isValid, "capacity 0 rejected as invalid");
        check(s.routeCount == 0, "capacity 0 reports zero routes");
        check(s.totalDistance == 0.0f, "capacity 0 reports zero distance");
    }

    // Empty stops remain valid with zero work.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, {}, 5);
        check(s.isValid, "empty stops is valid");
        check(s.routeCount == 0 && s.totalDistance == 0.0f, "empty stops has zero routes/distance");
    }

    // capacity >= stops.size(): one out-and-back tour visiting every stop,
    // 0->1->2->3->0 equals the reference great-circle sum.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 3);
        check(s.isValid, "single-route solution is valid");
        check(s.routeCount == 1, "capacity >= n reports one route");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 3), 1e-3f),
              "single-route distance matches great-circle tour");
    }

    // capacity == 1: each stop is its own depot out-and-back route.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 1);
        check(s.isValid, "capacity 1 solution is valid");
        check(s.routeCount == 3, "capacity 1 reports one route per stop");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 1), 1e-3f),
              "capacity 1 distance sums per-route great-circle tours");
    }

    // capacity == 2: routes [1,2] and [3].
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.isValid, "capacity 2 solution is valid");
        check(s.routeCount == 2, "capacity 2 reports ceil(3/2) = 2 routes");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 2), 1e-3f),
              "capacity 2 distance sums both route tours");
    }

    // Consistency: the reported distance must equal the sum of the reported
    // capacity-bounded routes (never a single unbounded tour when routes > 1).
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.routeCount == 2, "consistency test: two routes reported");
        check(!approxRel(s.totalDistance, refTourTotal(depot, stops, 3), 1e-3f),
              "consistency: distance differs from single tour");
    }

    // Regression test for #11549: distance() must compute great-circle meters
    // on lat/lng inputs, not Euclidean degrees. Validated against a reference
    // haversine for known city pairs (within 1%) and shown to differ sharply
    // from the old Euclidean metric.
    {
        // (longitude, latitude) in degrees.
        const Location newYork{-74.0060f, 40.7128f};
        const Location london{-0.1278f, 51.5074f};
        const Location paris{2.3522f, 48.8566f};

        double refNY_London = refHaversine(newYork.y, newYork.x, london.y, london.x);
        double refLondon_Paris = refHaversine(london.y, london.x, paris.y, paris.x);

        // Reference great-circle distances are well known: NY-London ~5570 km,
        // London-Paris ~344 km.
        check(approxRel(static_cast<float>(refNY_London), 5570000.0f, 0.05),
              "reference NY-London ~5,570 km");
        check(approxRel(static_cast<float>(refLondon_Paris), 344000.0f, 0.05),
              "reference London-Paris ~344 km");

        std::vector<Location> cityStops = {london, paris};
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(newYork, cityStops, 2);
        double refTour = refHaversine(newYork.y, newYork.x, london.y, london.x) +
                         refHaversine(london.y, london.x, paris.y, paris.x) +
                         refHaversine(paris.y, paris.x, newYork.y, newYork.x);

        check(approxRel(s.totalDistance, static_cast<float>(refTour), 0.01f),
              "VRP tour distance matches great-circle reference (<1% error)");

        // The old Euclidean-on-degrees metric would report a value on the order
        // of a few tens of degrees (near-zero), not thousands of kilometers.
        // Guard against regressing to it.
        double euclideanDeg = std::sqrt(std::pow(static_cast<double>(london.x - newYork.x), 2.0) +
                                        std::pow(static_cast<double>(london.y - newYork.y), 2.0));
        check(s.totalDistance > 1.0e6f, "distance is in meters (>> Euclidean degree value)");
        check(s.totalDistance > 1000.0 * static_cast<float>(euclideanDeg),
              "great-circle distance far exceeds Euclidean degree distance");
    }

    if (failures == 0) {
        std::printf("ALL TESTS PASSED\n");
        return 0;
    }
    std::printf("%d TEST(S) FAILED\n", failures);
    return 1;
}
