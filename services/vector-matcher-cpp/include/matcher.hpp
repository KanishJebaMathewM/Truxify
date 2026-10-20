#ifndef VECTOR_MATCHER_HPP
#define VECTOR_MATCHER_HPP

#include <vector>
#include <cstddef>

namespace TruxifyMatcher {

struct Box3D {
    float length;
    float width;
    float height;

    float volume() const { return length * width * height; }
};

struct PlacedBox {
    Box3D box;
    float x;
    float y;
    float z;
};

enum class PackingStatus { Infeasible, Packed, InvalidInput, ResourceLimit };

// Limits describe this greedy certificate search, not an optimality guarantee.
struct PackingLimits {
    size_t maxBoxes = 128;
    size_t maxCoordinateProducts = 1000000;
    size_t maxCandidateChecks = 1000000;
    size_t maxOverlapChecks = 10000000;
};

struct VectorMatchResult {
    bool fits;
    float utilizationPercentage;
    size_t packedCount;
    std::vector<PlacedBox> placementMap;
    PackingStatus status = PackingStatus::Infeasible;
};

class VectorMatcherEngine {
public:
    static VectorMatchResult evaluatePackingAVX(
        const Box3D& truckBed,
        const std::vector<Box3D>& cargoBoxes
    );
    static VectorMatchResult evaluatePackingAVX(
        const Box3D& truckBed,
        const std::vector<Box3D>& cargoBoxes,
        const PackingLimits& limits
    );
};

} // namespace TruxifyMatcher

#endif // VECTOR_MATCHER_HPP
