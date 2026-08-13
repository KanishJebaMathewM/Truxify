#include "../include/driver_pagerank.cuh"
#include "../include/pagerank_core.hpp"

namespace TruxifyCudaGraph {

PageRankResult CudaPageRankSolver::computePageRank(
    const std::vector<int>& rowOffsets,
    const std::vector<int>& colIndices,
    float dampingFactor,
    int maxIterations,
    float tolerance
) {
    // Delegate to the CUDA-free core so the GPU-simulating power iteration can
    // be shared with (and verified by) host-side unit tests.
    return computePageRankHost(
        rowOffsets,
        colIndices,
        dampingFactor,
        maxIterations,
        tolerance
    );
}

} // namespace TruxifyCudaGraph
