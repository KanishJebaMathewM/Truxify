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

struct VectorMatchResult {
    bool fits;
    float utilizationPercentage;
    size_t packedCount;
    std::vector<PlacedBox> placementMap;
};

class VectorMatcherEngine {
public:
    static VectorMatchResult evaluatePackingAVX(
        const Box3D& truckBed,
        const std::vector<Box3D>& cargoBoxes
    );
};

} // namespace TruxifyMatcher

#endif // VECTOR_MATCHER_HPP
