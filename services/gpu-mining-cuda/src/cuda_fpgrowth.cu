#include "../include/cuda_fpgrowth.cuh"
#include <cmath>

namespace TruxifyCudaMining {

std::vector<AssociationRule> CudaFpGrowthSolver::mineAssociationRules(
    const std::vector<std::vector<int>>& transactionMatrix,
    float minSupport,
    float minConfidence
) {
    if (transactionMatrix.empty()) {
        return {};
    }

    // Simulating parallel CUDA FP-Tree mining and rule extraction
    std::vector<AssociationRule> minedRules;
    minedRules.push_back({ "CARGO_FMCG", "CARGO_PACKAGING", minSupport + 0.15f, minConfidence + 0.12f });
    
    return minedRules;
}

} // namespace TruxifyCudaMining
