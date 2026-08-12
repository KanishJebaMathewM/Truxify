#include "../include/cuda_fpgrowth.cuh"
#include <cmath>
#include <unordered_map>
#include <map>
#include <algorithm>
#include <string>
#include <vector>

namespace TruxifyCudaMining {

static float clampProb(float val) {
    return std::fmax(0.0f, std::fmin(1.0f, val));
}

std::vector<AssociationRule> CudaFpGrowthSolver::mineAssociationRules(
    const std::vector<std::vector<int>>& transactionMatrix,
    float minSupport,
    float minConfidence
) {
    if (transactionMatrix.empty()) {
        return {};
    }

    float totalTransactions = static_cast<float>(transactionMatrix.size());
    std::unordered_map<int, int> itemCounts;
    std::map<std::pair<int, int>, int> pairCounts;

    for (const auto& tx : transactionMatrix) {
        std::vector<int> uniqueItems = tx;
        std::sort(uniqueItems.begin(), uniqueItems.end());
        uniqueItems.erase(std::unique(uniqueItems.begin(), uniqueItems.end()), uniqueItems.end());

        for (size_t i = 0; i < uniqueItems.size(); ++i) {
            itemCounts[uniqueItems[i]]++;
            for (size_t j = i + 1; j < uniqueItems.size(); ++j) {
                int u = uniqueItems[i];
                int v = uniqueItems[j];
                if (u > v) std::swap(u, v);
                pairCounts[{u, v}]++;
            }
        }
    }

    std::vector<AssociationRule> minedRules;

    for (const auto& pairKv : pairCounts) {
        int itemA = pairKv.first.first;
        int itemB = pairKv.first.second;
        int countAB = pairKv.second;

        float supportAB = countAB / totalTransactions;
        if (supportAB >= minSupport) {
            float countA = static_cast<float>(itemCounts[itemA]);
            float countB = static_cast<float>(itemCounts[itemB]);

            float confAtoB = countA > 0.0f ? (countAB / countA) : 0.0f;
            float confBtoA = countB > 0.0f ? (countAB / countB) : 0.0f;

            if (confAtoB >= minConfidence) {
                minedRules.push_back({
                    std::to_string(itemA),
                    std::to_string(itemB),
                    clampProb(supportAB),
                    clampProb(confAtoB)
                });
            }
            if (confBtoA >= minConfidence) {
                minedRules.push_back({
                    std::to_string(itemB),
                    std::to_string(itemA),
                    clampProb(supportAB),
                    clampProb(confBtoA)
                });
            }
        }
    }

    return minedRules;
}

} // namespace TruxifyCudaMining
