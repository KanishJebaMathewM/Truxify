#include "../include/matcher.hpp"

#include <algorithm>
#include <cassert>
#include <iostream>
#include <vector>

using namespace TruxifyMatcher;

static void assert_valid_placement(
    const std::vector<PlacedBox>& placements,
    const Box3D& bed
) {
    for (const auto& placed : placements) {
        assert(placed.x >= 0.0f);
        assert(placed.y >= 0.0f);
        assert(placed.z >= 0.0f);
        assert(placed.x + placed.box.length <= bed.length + 1e-4f);
        assert(placed.y + placed.box.width <= bed.width + 1e-4f);
        assert(placed.z + placed.box.height <= bed.height + 1e-4f);
    }

    for (size_t i = 0; i < placements.size(); ++i) {
        for (size_t j = i + 1; j < placements.size(); ++j) {
            const auto& a = placements[i];
            const auto& b = placements[j];
            const bool overlaps =
                a.x < b.x + b.box.length &&
                b.x < a.x + a.box.length &&
                a.y < b.y + b.box.width &&
                b.y < a.y + a.box.width &&
                a.z < b.z + b.box.height &&
                b.z < a.z + a.box.height;
            assert(!overlaps && "placement map must not contain overlapping boxes");
        }
    }
}

// (a) An input ordering that a naive greedy first-fit would fail to pack in
// full, yet is physically packable. The new placer must report allFits == true
// and must be order-independent: shuffling the same box list yields the same
// result.
static void test_order_independent_packable() {
    Box3D bed{ 10.0f, 10.0f, 10.0f };

    std::vector<Box3D> boxesA{
        { 6.0f, 4.0f, 10.0f },
        { 4.0f, 6.0f, 10.0f },
        { 6.0f, 6.0f, 4.0f },
    };
    std::vector<Box3D> boxesB = boxesA;
    std::reverse(boxesB.begin(), boxesB.end());

    VectorMatchResult rA = VectorMatcherEngine::evaluatePackingAVX(bed, boxesA);
    VectorMatchResult rB = VectorMatcherEngine::evaluatePackingAVX(bed, boxesB);

    assert(rA.fits == true && "physically packable set must report allFits == true");
    assert(rB.fits == true && "reverse order must also report allFits == true");
    assert(rA.packedCount == boxesA.size());
    assert(rB.packedCount == boxesB.size());
    assert(rA.fits == rB.fits);
    assert(rA.packedCount == rB.packedCount);
    assert(rA.placementMap.size() == boxesA.size());
    assert_valid_placement(rA.placementMap, bed);
    std::cout << "[ok] order-independent packable set" << std::endl;
}

// (b) Two boxes that each fit an orientation and whose combined volume is below
// the bed volume, but which geometrically MUST overlap.
static void test_overlap_rejected() {
    Box3D bed{ 10.0f, 10.0f, 10.0f };

    std::vector<Box3D> boxes{
        { 7.0f, 7.0f, 7.0f },
        { 7.0f, 7.0f, 7.0f },
    };

    VectorMatchResult r = VectorMatcherEngine::evaluatePackingAVX(bed, boxes);
    assert(r.fits == false && "overlapping boxes must be rejected");
    assert(r.placementMap.empty() && "no placement when packing is infeasible");
    std::cout << "[ok] overlapping cubes rejected" << std::endl;
}

// (c) Sanity: an obviously infeasible request is rejected, and a trivially
// feasible one with room to spare is accepted.
static void test_volume_bounds() {
    Box3D bed{ 10.0f, 10.0f, 10.0f };

    std::vector<Box3D> tooBig{ { 11.0f, 1.0f, 1.0f } };
    assert(VectorMatcherEngine::evaluatePackingAVX(bed, tooBig).fits == false);

    std::vector<Box3D> small{ { 2.0f, 2.0f, 2.0f }, { 2.0f, 2.0f, 2.0f } };
    VectorMatchResult r = VectorMatcherEngine::evaluatePackingAVX(bed, small);
    assert(r.fits == true);
    assert(r.packedCount == 2);
    assert_valid_placement(r.placementMap, bed);
    std::cout << "[ok] volume bounds sanity" << std::endl;
}

// (d) Regression for mixed-coordinate extreme points: the third box can only
// be placed at a point whose x, y, and z coordinates come from different
// occupied boundaries.
static void test_mixed_coordinate_anchor() {
    Box3D bed{ 4.0f, 4.0f, 4.0f };
    std::vector<Box3D> boxes{
        { 2.0f, 1.0f, 2.0f },
        { 1.0f, 2.0f, 1.0f },
        { 3.0f, 3.0f, 3.0f },
    };

    VectorMatchResult result =
        VectorMatcherEngine::evaluatePackingAVX(bed, boxes);

    assert(result.fits == true);
    assert(result.packedCount == boxes.size());
    assert(result.placementMap.size() == boxes.size());
    assert_valid_placement(result.placementMap, bed);
    std::cout << "[ok] mixed-coordinate extreme point packing" << std::endl;
}

int main() {
    test_order_independent_packable();
    test_overlap_rejected();
    test_volume_bounds();
    test_mixed_coordinate_anchor();
    std::cout << "All vector-matcher packing tests passed." << std::endl;
    return 0;
}
