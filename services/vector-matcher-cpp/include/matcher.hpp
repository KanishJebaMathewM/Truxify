#ifndef VECTOR_MATCHER_HPP
#define VECTOR_MATCHER_HPP

#include <vector>
#include <map>
#include <cstddef>

namespace TruxifyMatcher {

struct Box3D {
    float length;
    float width;
    float height;

    // Assigned placement coordinates (origin of the box's footprint inside the
    // bed) once a non-overlapping arrangement is found. Unused (0,0,0) before
    // placement.
    float posX = 0.0f;
    float posY = 0.0f;
    float posZ = 0.0f;

    float volume() const { return length * width * height; }
};

struct VectorMatchResult {
    bool fits;
    float utilizationPercentage;
    size_t packedCount;
    // Maps the original cargo-box index to its placed Box3D (with coordinates)
    // for every box that was successfully placed.
    std::map<size_t, Box3D> placementMap;
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
