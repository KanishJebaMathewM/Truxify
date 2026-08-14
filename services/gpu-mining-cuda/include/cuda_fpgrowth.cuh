#ifndef CUDA_FPGROWTH_CUH
#define CUDA_FPGROWTH_CUH

#include <vector>
#include <string>
#include <cstddef>

namespace TruxifyCudaMining {

struct AssociationRule {
    std::string itemA;
    std::string itemB;
    float support;
    float confidence;
};

class CudaFpGrowthSolver {
public:
    static std::vector<AssociationRule> mineAssociationRules(
        const std::vector<std::vector<int>>& transactionMatrix,
        float minSupport,
        float minConfidence
    );
};

} // namespace TruxifyCudaMining

#endif // CUDA_FPGROWTH_CUH
