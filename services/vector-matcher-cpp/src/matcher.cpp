#include "../include/matcher.hpp"
#include <algorithm>
#include <array>
#include <map>
#include <numeric>
#include <vector>

namespace TruxifyMatcher {

namespace {

constexpr float kEps = 1e-3f;

// A box resolved to one of its 6 axis-aligned orientations.
struct OrientedBox {
    float length;
    float width;
    float height;
};

// The 6 axis permutations of (length, width, height). Checking only 3 of them
// wrongly rejected boxes that fit only in the remaining orientations.
std::vector<OrientedBox> orientationsOf(const Box3D& box) {
    const float d[3] = { box.length, box.width, box.height };
    const int perms[6][3] = {
        {0, 1, 2}, // (L, W, H)
        {1, 0, 2}, // (W, L, H)
        {0, 2, 1}, // (L, H, W)
        {2, 1, 0}, // (H, W, L)
        {1, 2, 0}, // (W, H, L)
        {2, 0, 1}, // (H, L, W)
    };
    std::vector<OrientedBox> out;
    out.reserve(6);
    for (int i = 0; i < 6; ++i) {
        out.push_back({ d[perms[i][0]], d[perms[i][1]], d[perms[i][2]] });
    }
    return out;
}

struct PlacedBox {
    float posX;
    float posY;
    float posZ;
    float length;
    float width;
    float height;
    size_t originalIndex;
};

// Axis-aligned overlap test (strict: touching faces are allowed).
bool overlaps(const PlacedBox& a, const PlacedBox& b) {
    return (a.posX < b.posX + b.length - kEps) &&
           (a.posX + a.length > b.posX + kEps) &&
           (a.posY < b.posY + b.width - kEps) &&
           (a.posY + a.width > b.posY + kEps) &&
           (a.posZ < b.posZ + b.height - kEps) &&
           (a.posZ + a.height > b.posZ + kEps);
}

bool withinBed(const PlacedBox& b, const Box3D& bed) {
    return (b.posX + b.length) <= bed.length + kEps &&
           (b.posY + b.width) <= bed.width + kEps &&
           (b.posZ + b.height) <= bed.height + kEps;
}

// Extreme-point candidate generator: every box is placed flush against the
// origin or against the three forward faces of an already-placed box. Together
// with the backtracking below this is a complete axis-aligned rectangular
// packer (an optimal arrangement always exists at such corner points).
std::vector<std::array<float, 3>> candidatePoints(const std::vector<PlacedBox>& placed) {
    std::vector<std::array<float, 3>> cands;
    cands.push_back({ 0.0f, 0.0f, 0.0f });
    for (const auto& p : placed) {
        cands.push_back({ p.posX + p.length, p.posY, p.posZ });
        cands.push_back({ p.posX, p.posY + p.width, p.posZ });
        cands.push_back({ p.posX, p.posY, p.posZ + p.height });
    }
    return cands;
}

// Backtracking placement: try to place every box (already sorted
// largest-first) in some orientation at some extreme point, recursing and
// backtracking on failure. Returns true iff all boxes fit non-overlapping.
bool tryPack(
    size_t idx,
    const Box3D& bed,
    const std::vector<std::pair<Box3D, size_t>>& sortedBoxes,
    std::vector<PlacedBox>& placed
) {
    if (idx == sortedBoxes.size()) return true;

    const Box3D& box = sortedBoxes[idx].first;
    size_t origIdx = sortedBoxes[idx].second;
    std::vector<std::array<float, 3>> cands = candidatePoints(placed);

    for (const auto& orient : orientationsOf(box)) {
        for (const auto& c : cands) {
            PlacedBox cand{ c[0], c[1], c[2], orient.length, orient.width, orient.height, origIdx };
            if (!withinBed(cand, bed)) continue;

            bool free = true;
            for (const auto& p : placed) {
                if (overlaps(cand, p)) { free = false; break; }
            }
            if (!free) continue;

            placed.push_back(cand);
            if (tryPack(idx + 1, bed, sortedBoxes, placed)) return true;
            placed.pop_back();
        }
    }
    return false;
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

    // Order-independent: always attempt to pack largest-first. This removes the
    // input-order dependence the previous greedy first-fit suffered from and
    // gives a deterministic packing decision regardless of how boxes are
    // supplied.
    std::vector<std::pair<Box3D, size_t>> sorted;
    sorted.reserve(cargoBoxes.size());
    for (size_t i = 0; i < cargoBoxes.size(); ++i) {
        sorted.push_back({ cargoBoxes[i], i });
    }
    std::stable_sort(sorted.begin(), sorted.end(),
        [](const std::pair<Box3D, size_t>& a, const std::pair<Box3D, size_t>& b) {
            return a.first.volume() > b.first.volume();
        });

    std::vector<PlacedBox> placed;
    bool allFits = tryPack(0, truckBed, sorted, placed);

    std::map<size_t, Box3D> placementMap;
    float packedVolume = 0.0f;
    if (allFits) {
        for (const auto& p : placed) {
            Box3D placedBox{ p.length, p.width, p.height, p.posX, p.posY, p.posZ };
            packedVolume += placedBox.volume();
            placementMap[p.originalIndex] = placedBox;
        }
    }

    float utilization = (packedVolume / totalTruckVolume) * 100.0f;
    return { allFits, utilization, placed.size(), placementMap };
}

} // namespace TruxifyMatcher
