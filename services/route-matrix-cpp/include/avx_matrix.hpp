#ifndef AVX_MATRIX_HPP
#define AVX_MATRIX_HPP

#include <vector>
#include <cstddef>

namespace TruxifyRouting {

struct Point2D {
    float x; // Latitude / X
    float y; // Longitude / Y
};

class AVXMatrixCalculator {
public:
    // Computes N x M great-circle (haversine) distance matrix in km using
    // AVX-512 SIMD vectorization. Point2D.x is latitude, Point2D.y is longitude.
    static void computeDistanceMatrixAVX512(
        const std::vector<Point2D>& origins,
        const std::vector<Point2D>& destinations,
        std::vector<float>& outputMatrix
    );

    // Fallback scalar great-circle (haversine) computation for comparison &
    // non-AVX systems. Point2D.x is latitude, Point2D.y is longitude.
    static void computeDistanceMatrixScalar(
        const std::vector<Point2D>& origins,
        const std::vector<Point2D>& destinations,
        std::vector<float>& outputMatrix
    );
};

} // namespace TruxifyRouting

#endif // AVX_MATRIX_HPP
