#include "../include/driver_pagerank.cuh"
#include <cmath>
#include <numeric>

namespace TruxifyCudaGraph {

PageRankResult CudaPageRankSolver::computePageRank(
    const std::vector<int>& rowOffsets,
    const std::vector<int>& colIndices,
    float dampingFactor,
    int maxIterations,
    float tolerance
) {
    if (rowOffsets.empty()) {
        return { {}, 0, true };
    }

    size_t numNodes = rowOffsets.size() - 1;
    std::vector<float> ranks(numNodes, 1.0f / numNodes);
    
    // Simulating parallel GPU power iteration updates
    for (int iter = 0; iter < maxIterations; ++iter) {
        std::vector<float> nextRanks(numNodes, (1.0f - dampingFactor) / numNodes);
        
        for (size_t u = 0; u < numNodes; ++u) {
            int start = rowOffsets[u];
            int end = rowOffsets[u + 1];
            int outDegree = end - start;
            
            if (outDegree > 0) {
                float share = ranks[u] / outDegree;
                for (int idx = start; idx < end; ++idx) {
                    int v = colIndices[idx];
                    nextRanks[v] += dampingFactor * share;
                }
            }
        }

        // L1 Norm convergence check
        float diff = 0.0f;
        for (size_t i = 0; i < numNodes; ++i) {
            diff += std::abs(nextRanks[i] - ranks[i]);
        }

        ranks = nextRanks;
        if (diff < tolerance) {
            return { ranks, static_cast<size_t>(iter + 1), true };
        }
    }

    return { ranks, static_cast<size_t>(maxIterations), false };
}

} // namespace TruxifyCudaGraph
