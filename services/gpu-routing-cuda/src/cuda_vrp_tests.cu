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
    // 0->1->2->3->0 = 1+1+1+3 = 6.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 3);
        check(s.isValid, "single-route solution is valid");
        check(s.routeCount == 1, "capacity >= n reports one route");
        check(approx(s.totalDistance, 6.0f), "single-route distance matches tour");
    }

    // capacity == 1: each stop is its own depot out-and-back route;
    // (1+1) + (2+2) + (3+3) = 12.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 1);
        check(s.isValid, "capacity 1 solution is valid");
        check(s.routeCount == 3, "capacity 1 reports one route per stop");
        check(approx(s.totalDistance, 12.0f), "capacity 1 distance sums per-route tours");
    }

    // capacity == 2: routes [1,2] and [3];
    // (0->1->2->0) + (0->3->0) = (1+1+2) + (3+3) = 10.
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.isValid, "capacity 2 solution is valid");
        check(s.routeCount == 2, "capacity 2 reports ceil(3/2) = 2 routes");
        check(approx(s.totalDistance, 10.0f), "capacity 2 distance sums both route tours");
    }

    // Consistency: the reported distance must equal the sum of the reported
    // capacity-bounded routes (never a single unbounded tour when routes > 1).
    {
        VrpSolution s = TruxifyCuda::CudaVrpSolver::solveParallelVRP(depot, stops, 2);
        check(s.routeCount == 2, "consistency test: two routes reported");
        check(!approx(s.totalDistance, 6.0f), "consistency: distance differs from single tour");
    }

    if (failures == 0) {
        std::printf("ALL TESTS PASSED\n");
        return 0;
    }
    std::printf("%d TEST(S) FAILED\n", failures);
    return 1;
}
