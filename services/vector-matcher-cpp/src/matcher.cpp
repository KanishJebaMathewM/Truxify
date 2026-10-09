#include "../include/matcher.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <vector>

namespace TruxifyMatcher {
namespace {
struct Placement {
    double x, y, z, dx, dy, dz;
};

bool valid(const Box3D& box) {
    return std::isfinite(box.length) && box.length > 0 &&
           std::isfinite(box.width) && box.width > 0 &&
           std::isfinite(box.height) && box.height > 0;
}

double volume(const Box3D& box) {
    // Double covers all products of three positive finite binary32 values.
    return double(box.length) * double(box.width) * double(box.height);
}

// Both subtraction comparisons are necessary: adding a subnormal offset to
// a maximum float loses it even in double. For admitted binary32 operands,
// the subtraction between the larger near-boundary values is exact.
bool endsBefore(double start, double span, double endpoint) {
    return start <= endpoint && span <= endpoint - start &&
           start <= endpoint - span;
}

bool overlaps(const Placement& a, const Placement& b) {
    return !(endsBefore(a.x,a.dx,b.x) || endsBefore(b.x,b.dx,a.x)) &&
           !(endsBefore(a.y,a.dy,b.y) || endsBefore(b.y,b.dy,a.y)) &&
           !(endsBefore(a.z,a.dz,b.z) || endsBefore(b.z,b.dz,a.z));
}

bool fitsBed(const Placement& p, const Box3D& bed) {
    return p.x >= 0 && p.y >= 0 && p.z >= 0 &&
           endsBefore(p.x,p.dx,bed.length) &&
           endsBefore(p.y,p.dy,bed.width) &&
           endsBefore(p.z,p.dz,bed.height);
}

// Round outward to a representable public float coordinate, including a tiny
// positive span whose addition is absorbed in the wider temporary arithmetic.
double boundary(double start, double span) {
    float result = static_cast<float>(start + span);
    if (!endsBefore(start, span, result))
        result = std::nextafter(result, std::numeric_limits<float>::infinity());
    return double(result);
}

std::array<std::vector<double>, 3> coordinates(const std::vector<Placement>& placed) {
    std::array<std::vector<double>, 3> axes;
    for (auto& axis : axes) {
        axis.reserve(placed.size() + 1);
        axis.push_back(0);
    }
    for (const auto& p : placed) {
        axes[0].push_back(boundary(p.x, p.dx));
        axes[1].push_back(boundary(p.y, p.dy));
        axes[2].push_back(boundary(p.z, p.dz));
    }
    for (auto& axis : axes) {
        std::sort(axis.begin(), axis.end());
        axis.erase(std::unique(axis.begin(), axis.end()), axis.end());
    }
    return axes;
}

VectorMatchResult failure(PackingStatus status, size_t count = 0) {
    return {false, 0, count, {}, status};
}
}

VectorMatchResult VectorMatcherEngine::evaluatePackingAVX(
    const Box3D& truckBed, const std::vector<Box3D>& cargoBoxes
) {
    return evaluatePackingAVX(truckBed, cargoBoxes, PackingLimits{});
}

VectorMatchResult VectorMatcherEngine::evaluatePackingAVX(
    const Box3D& truckBed, const std::vector<Box3D>& cargoBoxes,
    const PackingLimits& limits
) {
    if (!valid(truckBed)) return failure(PackingStatus::InvalidInput);
    if (!limits.maxBoxes || limits.maxBoxes > 128 ||
        !limits.maxCoordinateProducts || limits.maxCoordinateProducts > 1000000 ||
        !limits.maxCandidateChecks || limits.maxCandidateChecks > 1000000 ||
        !limits.maxOverlapChecks || limits.maxOverlapChecks > 10000000)
        return failure(PackingStatus::InvalidInput);
    if (cargoBoxes.size() > limits.maxBoxes)
        return failure(PackingStatus::ResourceLimit);
    // Complete admission precedes placement: a bad late row never looks like
    // a partially successful geometric search.
    if (std::any_of(cargoBoxes.begin(), cargoBoxes.end(),
                    [](const Box3D& box) { return !valid(box); }))
        return failure(PackingStatus::InvalidInput);

    std::vector<Placement> placed;
    placed.reserve(cargoBoxes.size());
    double cargoVolume = 0;
    size_t candidates = 0, overlapChecks = 0;
    const int permutations[6][3] = {
        {0,1,2}, {1,0,2}, {0,2,1}, {2,1,0}, {1,2,0}, {2,0,1}
    };
    for (const auto& box : cargoBoxes) {
        const auto axes = coordinates(placed);
        size_t products = 1;
        for (const auto& axis : axes) {
            if (axis.size() > limits.maxCoordinateProducts / products)
                return failure(PackingStatus::ResourceLimit, placed.size());
            products *= axis.size();
        }
        const double dims[3] = {box.length, box.width, box.height};
        bool accepted = false;
        for (const auto& permutation : permutations) {
            if (accepted) break;
            for (double x : axes[0]) {
                if (accepted) break;
                for (double y : axes[1]) {
                    if (accepted) break;
                    for (double z : axes[2]) {
                        if (candidates == limits.maxCandidateChecks)
                            return failure(PackingStatus::ResourceLimit, placed.size());
                        ++candidates;
                        Placement candidate{x,y,z,dims[permutation[0]],
                                            dims[permutation[1]],dims[permutation[2]]};
                        if (!fitsBed(candidate, truckBed)) continue;
                        bool collision = false;
                        for (const auto& previous : placed) {
                            if (overlapChecks == limits.maxOverlapChecks)
                                return failure(PackingStatus::ResourceLimit, placed.size());
                            ++overlapChecks;
                            if (overlaps(candidate, previous)) {
                                collision = true;
                                break;
                            }
                        }
                        if (!collision) {
                            placed.push_back(candidate);
                            cargoVolume += volume(box);
                            accepted = true;
                            break;
                        }
                    }
                }
            }
        }
        if (!accepted) return failure(PackingStatus::Infeasible, placed.size());
    }
    VectorMatchResult result;
    result.fits = true;
    result.status = PackingStatus::Packed;
    // Certified disjoint geometry bounds this ratio; clamp only accumulated
    // arithmetic roundoff, never dimensions or an infeasible certificate.
    result.utilizationPercentage = static_cast<float>(
        std::clamp(cargoVolume / volume(truckBed) * 100, 0.0, 100.0));
    result.packedCount = placed.size();
    result.placementMap.reserve(placed.size());
    for (const auto& p : placed) {
        result.placementMap.push_back({
            {float(p.dx),float(p.dy),float(p.dz)},float(p.x),float(p.y),float(p.z)});
    }
    return result;
}
} // namespace TruxifyMatcher
