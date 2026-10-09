#include "cuda_vrp.cuh"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
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

static bool approxRel(float a, float b, float tol) {
    float denom = std::fabs(a) > 1e-6f ? std::fabs(a) : 1.0f;
    return std::fabs(a - b) / denom < tol;
}

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

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 0);
        check(!s.isValid, "capacity 0 rejected as invalid");
        check(s.routeCount == 0, "capacity 0 reports zero routes");
        check(s.totalDistance == 0.0f, "capacity 0 reports zero distance");
    }

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, {}, 5);
        check(s.isValid, "empty stops is valid");
        check(s.routeCount == 0 && s.totalDistance == 0.0f, "empty stops has zero routes/distance");
    }

    {
        const float nan = std::numeric_limits<float>::quiet_NaN();
        const float inf = std::numeric_limits<float>::infinity();
        const std::vector<Location> invalidStops = {
            {nan, 0.0f},
            {inf, 0.0f},
            {-inf, 0.0f},
            {181.0f, 0.0f},
            {-181.0f, 0.0f},
            {0.0f, 91.0f},
            {0.0f, -91.0f},
        };

        for (const auto& invalidStop : invalidStops) {
            VrpSolution s =
                TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, {invalidStop}, 1);
            check(!s.isValid, "invalid stop coordinate is rejected");
            check(s.routeCount == 0, "invalid stop coordinate reports zero routes");
            check(s.totalDistance == 0.0f, "invalid stop coordinate reports zero distance");
        }

        VrpSolution invalidDepot =
            TruxifyCuda::CudaVrpSolver::solveParallelVRP({181.0f, 0.0f}, stops, 1);
        check(!invalidDepot.isValid, "invalid depot coordinate is rejected");
        check(invalidDepot.totalDistance == 0.0f, "invalid depot reports zero distance");
    }

    {
        const std::vector<Location> boundaryStops = {
            {-180.0f, -90.0f},
            {180.0f, 90.0f},
        };
        VrpSolution s =
            TruxifyCuda::CudaVrpSolver::solveParallelVRP({0.0f, 0.0f}, boundaryStops, 1);
        check(s.isValid, "valid coordinate boundaries are accepted");
        check(std::isfinite(s.totalDistance), "valid boundary distance is finite");
    }

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 3);
        check(s.isValid, "single-route solution is valid");
        check(s.routeCount == 1, "capacity >= n reports one route");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 3), 1e-3f),
              "single-route distance matches great-circle tour");
    }

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 1);
        check(s.isValid, "capacity 1 solution is valid");
        check(s.routeCount == 3, "capacity 1 reports one route per stop");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 1), 1e-3f),
              "capacity 1 distance sums per-route great-circle tours");
    }

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.isValid, "capacity 2 solution is valid");
        check(s.routeCount == 2, "capacity 2 reports two routes");
        check(approxRel(s.totalDistance, refTourTotal(depot, stops, 2), 1e-3f),
              "capacity 2 distance sums both routes");
    }

    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.routeCount == 2, "consistency test: two routes reported");
        check(!approxRel(s.totalDistance, refTourTotal(depot, stops, 3), 1e-3f),
              "consistency: distance differs from single tour");
    }

    {
        const Location newYork{-74.0060f, 40.7128f};
        const Location london{-0.1278f, 51.5074f};
        const Location paris{2.3522f, 48.8566f};

        double refNY_London = refHaversine(newYork.y, newYork.x, london.y, london.x);
        double refLondon_Paris = refHaversine(london.y, london.x, paris.y, paris.x);

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
        check(s.totalDistance > 1.0e6f, "distance is in meters");
    }

    // The objective must be invariant to the input ordering of the same stop set.
    {
        const std::vector<Location> permutationStops = {
            {0.8f, 0.1f},
            {0.1f, 0.9f},
            {1.0f, 1.0f},
            {0.2f, 1.2f},
        };
        std::vector<size_t> order = {0, 1, 2, 3};
        VrpSolution baseline = TruxifyCuda::CudaVrpSolver::solveParallelVRP(
            depot, permutationStops, 2
        );

        size_t checkedPermutations = 0;
        do {
            std::vector<Location> shuffled;
            shuffled.reserve(order.size());
            for (size_t index : order) {
                shuffled.push_back(permutationStops[index]);
            }

            VrpSolution candidate = TruxifyCuda::CudaVrpSolver::solveParallelVRP(
                depot, shuffled, 2
            );
            check(candidate.isValid, "permuted stop order remains valid");
            check(candidate.routeCount == baseline.routeCount,
                  "permuted stop order keeps the same route count");
            check(approxRel(candidate.totalDistance, baseline.totalDistance, 1e-6f),
                  "permuted stop order keeps the same objective");
            ++checkedPermutations;
        } while (std::next_permutation(order.begin(), order.end()));

        check(checkedPermutations == 24, "all stop-order permutations were checked");
    }

    if (failures == 0) {
        std::printf("ALL TESTS PASSED\n");
        return 0;
    }
    std::printf("%d TEST(S) FAILED\n", failures);
    return 1;
}
