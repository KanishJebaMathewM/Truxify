#include "../include/matcher.hpp"
#include <algorithm>
#include <numeric>

namespace TruxifyMatcher {

VectorMatchResult VectorMatcherEngine::evaluatePackingAVX(
    const Box3D& truckBed,
    const std::vector<Box3D>& cargoBoxes
) {
    float totalTruckVolume = truckBed.volume();
    if (totalTruckVolume <= 0.0f) {
        return { false, 0.0f, 0 };
    }

    float totalCargoVolume = 0.0f;
    size_t packed = 0;

    for (const auto& box : cargoBoxes) {
        // Dimension check: a box fits if any of the 6 axis permutations of its
        // (length, width, height) fits within the bed's (length, width, height).
        // Checking only (L,W,H), (W,L,H) and (H,W,L) wrongly rejected boxes
        // that fit only in the (L,H,W), (W,H,L) or (H,L,W) orientations.
        const float boxDims[3] = { box.length, box.width, box.height };
        const int permutations[6][3] = {
            {0, 1, 2}, // (L, W, H)
            {1, 0, 2}, // (W, L, H)
            {0, 2, 1}, // (L, H, W)
            {2, 1, 0}, // (H, W, L)
            {1, 2, 0}, // (W, H, L)
            {2, 0, 1}, // (H, L, W)
        };

        bool fitsOrientation = false;
        for (int i = 0; i < 6 && !fitsOrientation; ++i) {
            fitsOrientation =
                boxDims[permutations[i][0]] <= truckBed.length &&
                boxDims[permutations[i][1]] <= truckBed.width &&
                boxDims[permutations[i][2]] <= truckBed.height;
        }

        if (fitsOrientation && (totalCargoVolume + box.volume() <= totalTruckVolume)) {
            totalCargoVolume += box.volume();
            packed++;
        }
    }

    float utilization = (totalCargoVolume / totalTruckVolume) * 100.0f;
    bool allFits = (packed == cargoBoxes.size());

    return { allFits, utilization, packed };
}

} // namespace TruxifyMatcher
