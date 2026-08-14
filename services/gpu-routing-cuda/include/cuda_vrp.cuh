#ifndef CUDA_VRP_CUH
#define CUDA_VRP_CUH

#include <vector>
#include <cstddef>

namespace TruxifyCuda {

struct Location {
    float x;
    float y;
};

struct VrpSolution {
    float totalDistance;
    size_t routeCount;
    bool isValid;
};

class CudaVrpSolver {
public:
    static VrpSolution solveParallelVRP(
        const Location& depot,
        const std::vector<Location>& stops,
        size_t vehicleCapacity
    );
};

} // namespace TruxifyCuda

#endif // CUDA_VRP_CUH
