#include "../include/matcher.hpp"
#include <algorithm>
#include <array>
#include <numeric>
#include <vector>

namespace TruxifyMatcher {

namespace {

struct Placement {
    float x, y, z;
    float dx, dy, dz;
};

bool overlaps(const Placement& a, const Placement& b) {
    return a.x < b.x + b.dx && b.x < a.x + a.dx &&
           a.y < b.y + b.dy && b.y < a.y + a.dy &&
           a.z < b.z + b.dz && b.z < a.z + a.dz;
}

bool fitsBed(const Placement& p, const Box3D& bed) {
    return p.x + p.dx <= bed.length + 1e-4f &&
           p.y + p.dy <= bed.width + 1e-4f &&
           p.z + p.dz <= bed.height + 1e-4f;
}

std::vector<std::array<float, 3>> generateAnchors(
    const std::vector<Placement>& placed
) {
    std::vector<float> xCoordinates{ 0.0f };
    std::vector<float> yCoordinates{ 0.0f };
    std::vector<float> zCoordinates{ 0.0f };

    xCoordinates.reserve(placed.size() + 1);
    yCoordinates.reserve(placed.size() + 1);
    zCoordinates.reserve(placed.size() + 1);

    for (const auto& placement : placed) {
        xCoordinates.push_back(placement.x + placement.dx);
        yCoordinates.push_back(placement.y + placement.dy);
        zCoordinates.push_back(placement.z + placement.dz);
    }

    auto deduplicate = [](std::vector<float>& coordinates) {
        std::sort(coordinates.begin(), coordinates.end());
        coordinates.erase(
            std::unique(coordinates.begin(), coordinates.end()),
            coordinates.end()
        );
    };

    deduplicate(xCoordinates);
    deduplicate(yCoordinates);
    deduplicate(zCoordinates);

    std::vector<std::array<float, 3>> anchors;
    anchors.reserve(
        xCoordinates.size() * yCoordinates.size() * zCoordinates.size()
    );

    for (float x : xCoordinates) {
        for (float y : yCoordinates) {
            for (float z : zCoordinates) {
                anchors.push_back({ x, y, z });
            }
        }
    }

    return anchors;
}

} // namespace

VectorMatchResult VectorMatcherEngine::evaluatePackingAVX(
    const Box3D& truckBed,
    const std::vector<Box3D>& cargoBoxes
) {
    float totalTruckVolume = truckBed.volume();
    if (totalTruckVolume <= 0.0f) {
        return { false, 0.0f, 0, {} };
    }

    std::vector<Placement> placed;
    float totalCargoVolume = 0.0f;

    const int permutations[6][3] = {
        {0, 1, 2}, // (L, W, H)
        {1, 0, 2}, // (W, L, H)
        {0, 2, 1}, // (L, H, W)
        {2, 1, 0}, // (H, W, L)
        {1, 2, 0}, // (W, H, L)
        {2, 0, 1}, // (H, L, W)
    };

    for (const auto& box : cargoBoxes) {
        const float dims[3] = { box.length, box.width, box.height };
        const auto anchors = generateAnchors(placed);
        bool placedBox = false;

        for (int i = 0; i < 6 && !placedBox; ++i) {
            Placement cand;
            cand.dx = dims[permutations[i][0]];
            cand.dy = dims[permutations[i][1]];
            cand.dz = dims[permutations[i][2]];

            for (const auto& anchor : anchors) {
                cand.x = anchor[0];
                cand.y = anchor[1];
                cand.z = anchor[2];

                if (!fitsBed(cand, truckBed)) {
                    continue;
                }

                bool ok = true;
                for (const auto& placement : placed) {
                    if (overlaps(cand, placement)) {
                        ok = false;
                        break;
                    }
                }

                if (ok) {
                    placed.push_back(cand);
                    totalCargoVolume += box.volume();
                    placedBox = true;
                    break;
                }
            }
        }

        if (!placedBox) {
            return { false, 0.0f, placed.size(), {} };
        }
    }

    float utilization = (totalCargoVolume / totalTruckVolume) * 100.0f;
    bool allFits = (placed.size() == cargoBoxes.size());

    VectorMatchResult res;
    res.fits = allFits;
    res.utilizationPercentage = utilization;
    res.packedCount = placed.size();
    res.placementMap.reserve(placed.size());
    for (const auto& p : placed) {
        Box3D b{ p.dx, p.dy, p.dz };
        res.placementMap.push_back({ b, p.x, p.y, p.z });
    }
    return res;
}

} // namespace TruxifyMatcher
