#include "pagerank_core.hpp"

#include <cmath>
#include <iostream>
#include <numeric>
#include <vector>

using TruxifyCudaGraph::computePageRankHost;
using TruxifyCudaGraph::PageRankResult;

static int g_failures = 0;

static void check(bool cond, const char* msg) {
    if (!cond) {
        std::cerr << "FAIL: " << msg << std::endl;
        ++g_failures;
    } else {
        std::cout << "PASS: " << msg << std::endl;
    }
}

// Graph (CSR):
//   0 -> 1, 2
//   1 -> 2
//   2 -> 0
//   3 -> (sink, outDegree == 0)
// Node 3 is a dangling/sink node whose rank mass used to leak before the fix.
static PageRankResult runSinkGraph() {
    std::vector<int> rowOffsets = {0, 2, 3, 4, 4};
    std::vector<int> colIndices = {1, 2, 2, 0};
    return computePageRankHost(rowOffsets, colIndices, 0.85f, 200, 1e-6f);
}

int main() {
    PageRankResult res = runSinkGraph();

    check(res.converged, "PageRank converges on a graph with a sink node");
    check(res.ranks.size() == 4, "rank vector has one entry per node");

    float sum = std::accumulate(res.ranks.begin(), res.ranks.end(), 0.0f);
    std::cout << "sum(ranks) = " << sum << std::endl;
    for (size_t i = 0; i < res.ranks.size(); ++i) {
        std::cout << "  rank[" << i << "] = " << res.ranks[i] << std::endl;
    }
    check(std::abs(sum - 1.0f) < 1e-4f,
          "sum(ranks) stays ~1.0 (dangling mass redistributed)");

    // Stability: another run with identical inputs must reproduce the ranks.
    PageRankResult res2 = runSinkGraph();
    bool stable = (res2.ranks.size() == res.ranks.size());
    for (size_t i = 0; i < res.ranks.size() && stable; ++i) {
        if (std::abs(res2.ranks[i] - res.ranks[i]) > 1e-6f) {
            stable = false;
        }
    }
    check(stable, "ranks are stable/reproducible across runs");

    // The sink node must retain non-trivial rank (its mass is redistributed,
    // not discarded).
    check(res.ranks[3] > 0.0f, "sink node receives redistributed mass");

    if (g_failures == 0) {
        std::cout << "\nAll tests passed.\n";
        return 0;
    }
    std::cout << "\n" << g_failures << " test(s) failed.\n";
    return 1;
}
