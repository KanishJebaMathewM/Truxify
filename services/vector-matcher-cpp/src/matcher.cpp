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
        // Dimension check: box must fit within bed dimensions in at least one orientation
        bool fitsOrientation = (box.length <= truckBed.length && box.width <= truckBed.width && box.height <= truckBed.height) ||
                               (box.length <= truckBed.width && box.width <= truckBed.length && box.height <= truckBed.height) ||
                               (box.length <= truckBed.height && box.width <= truckBed.width && box.height <= truckBed.length);

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
