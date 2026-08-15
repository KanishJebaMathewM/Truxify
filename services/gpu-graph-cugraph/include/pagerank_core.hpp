#ifndef PAGERANK_CORE_HPP
#define PAGERANK_CORE_HPP

#include "driver_pagerank.cuh"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace TruxifyCudaGraph {

// Host-callable core of the PageRank power iteration.
//
// Kept CUDA-free so it can be unit-tested on the build host without an nvcc
// toolchain. The .cu driver (which simulates the parallel GPU update) delegates
// to this routine.
inline PageRankResult computePageRankHost(
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

    // Reject malformed CSR input up front. Without this, a negative or
    // over-large colIndices value (or out-of-range start/end) would index
    // nextRanks out of bounds below.
    if (colIndices.size() < static_cast<size_t>(rowOffsets.back())) {
        return { {}, 0, false };
    }

    // Two rank buffers reused across iterations (no per-loop reallocation).
    std::vector<float> nextRanks(numNodes, 0.0f);

    for (int iter = 0; iter < maxIterations; ++iter) {
        // Collect the total mass held by dangling/sink nodes (outDegree == 0)
        // so it can be redistributed and the stochastic property holds.
        float danglingMass = 0.0f;
        for (size_t u = 0; u < numNodes; ++u) {
            int start = rowOffsets[u];
            int end = rowOffsets[u + 1];
            if (end - start == 0) {
                danglingMass += ranks[u];
            }
        }

        // Teleport term folds in both the (1-d)/n baseline and the
        // redistribution of the dangling mass (d * danglingMass / n).
        float teleport =
            (1.0f - dampingFactor) / numNodes +
            dampingFactor * danglingMass / numNodes;
        std::fill(nextRanks.begin(), nextRanks.end(), teleport);

        for (size_t u = 0; u < numNodes; ++u) {
            int start = rowOffsets[u];
            int end = rowOffsets[u + 1];
            int outDegree = end - start;

            // Guard against out-of-range CSR offsets before dereferencing.
            if (start < 0 || end < 0 ||
                end > static_cast<int>(colIndices.size())) {
                return { {}, 0, false };
            }

            if (outDegree > 0) {
                float share = ranks[u] / outDegree;
                for (int idx = start; idx < end; ++idx) {
                    int v = colIndices[idx];
                    // Bounds-check the destination node: colIndices is a
                    // signed int vector, so v may be negative or >= numNodes.
                    if (v < 0 || v >= static_cast<int>(numNodes)) {
                        continue;
                    }
                    nextRanks[v] += dampingFactor * share;
                }
            }
        }

        // Scale-independent L1 residual: average absolute change per node.
        float diff = 0.0f;
        for (size_t i = 0; i < numNodes; ++i) {
            diff += std::abs(nextRanks[i] - ranks[i]);
        }
        diff /= static_cast<float>(numNodes);

        std::swap(ranks, nextRanks);
        if (diff < tolerance) {
            return { ranks, static_cast<size_t>(iter + 1), true };
        }
    }

    return { ranks, static_cast<size_t>(maxIterations), false };
}

} // namespace TruxifyCudaGraph

#endif // PAGERANK_CORE_HPP
