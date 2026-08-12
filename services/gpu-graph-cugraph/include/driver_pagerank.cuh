#ifndef DRIVER_PAGERANK_CUH
#define DRIVER_PAGERANK_CUH

#include <vector>
#include <cstddef>

namespace TruxifyCudaGraph {

struct PageRankResult {
    std::vector<float> ranks;
    size_t iterations;
    bool converged;
};

class CudaPageRankSolver {
public:
    static PageRankResult computePageRank(
        const std::vector<int>& rowOffsets,
        const std::vector<int>& colIndices,
        float dampingFactor,
        int maxIterations,
        float tolerance
    );
};

} // namespace TruxifyCudaGraph

#endif // DRIVER_PAGERANK_CUH
