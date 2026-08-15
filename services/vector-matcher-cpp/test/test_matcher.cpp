#include "../include/matcher.hpp"

#include <cassert>
#include <iostream>
#include <vector>

using namespace TruxifyMatcher;

// (a) An input ordering that a naive greedy first-fit would fail to pack in
// full, yet is physically packable. The new placer must report allFits == true
// and must be order-independent: shuffling the same box list yields the same
// result.
static void test_order_independent_packable() {
    // Bed 10x10x10 (volume 1000).
    Box3D bed{ 10.0f, 10.0f, 10.0f };

    // Three boxes that only fit together when each is placed flush against a
    // different wall / corner. A first-fit that drops them in input order into
    // the first free corner can leave the last box stranded, but a real
    // arrangement exists.
    std::vector<Box3D> boxesA{
        { 6.0f, 4.0f, 10.0f }, // vol 240
        { 4.0f, 6.0f, 10.0f }, // vol 240
        { 6.0f, 6.0f, 4.0f },  // vol 144
    };
    std::vector<Box3D> boxesB = boxesA;
    std::reverse(boxesB.begin(), boxesB.end());

    VectorMatchResult rA = VectorMatcherEngine::evaluatePackingAVX(bed, boxesA);
    VectorMatchResult rB = VectorMatcherEngine::evaluatePackingAVX(bed, boxesB);

    assert(rA.fits == true && "physically packable set must report allFits == true");
    assert(rB.fits == true && "reverse order must also report allFits == true");
    assert(rA.packedCount == boxesA.size());
    assert(rB.packedCount == boxesB.size());
    // Order independence: same decision and same number packed regardless of order.
    assert(rA.fits == rB.fits);
    assert(rA.packedCount == rB.packedCount);
    // A real placement map must be returned.
    assert(rA.placementMap.size() == boxesA.size());
    std::cout << "[ok] order-independent packable set\n";
}

// (b) Two boxes that each fit an orientation and whose combined volume is below
// the bed volume, but which geometrically MUST overlap. The volume-only greedy
// check would have accepted them; the overlap-aware placer must reject.
static void test_overlap_rejected() {
    Box3D bed{ 10.0f, 10.0f, 10.0f }; // volume 1000

    // Two 7x7x7 cubes: volume 343 each, total 686 < 1000 (volume-feasible),
    // but each needs a 7-unit span on every axis. Along any single axis
    // 7 + 7 = 14 > 10, so two such cubes cannot be separated on X, Y or Z,
    // hence they must overlap. allFits must be false.
    std::vector<Box3D> boxes{
        { 7.0f, 7.0f, 7.0f },
        { 7.0f, 7.0f, 7.0f },
    };

    VectorMatchResult r = VectorMatcherEngine::evaluatePackingAVX(bed, boxes);
    assert(r.fits == false && "overlapping boxes must be rejected");
    assert(r.placementMap.empty() && "no placement when packing is infeasible");
    std::cout << "[ok] overlapping cubes rejected\n";
}

// (c) Sanity: an obviously infeasible (by volume) request is rejected, and a
// trivially feasible one with room to spare is accepted.
static void test_volume_bounds() {
    Box3D bed{ 10.0f, 10.0f, 10.0f };

    std::vector<Box3D> tooBig{ { 11.0f, 1.0f, 1.0f } };
    assert(VectorMatcherEngine::evaluatePackingAVX(bed, tooBig).fits == false);

    std::vector<Box3D> small{ { 2.0f, 2.0f, 2.0f }, { 2.0f, 2.0f, 2.0f } };
    VectorMatchResult r = VectorMatcherEngine::evaluatePackingAVX(bed, small);
    assert(r.fits == true);
    assert(r.packedCount == 2);
    std::cout << "[ok] volume bounds sanity\n";
}

int main() {
    test_order_independent_packable();
    test_overlap_rejected();
    test_volume_bounds();
    std::cout << "All vector-matcher packing tests passed.\n";
    return 0;
}
