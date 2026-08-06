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
    // Computes N x M Euclidean distance matrix using AVX-512 SIMD vectorization
    static void computeDistanceMatrixAVX512(
        const std::vector<Point2D>& origins,
        const std::vector<Point2D>& destinations,
        std::vector<float>& outputMatrix
    );

    // Fallback scalar computation for comparison & non-AVX systems
    static void computeDistanceMatrixScalar(
        const std::vector<Point2D>& origins,
        const std::vector<Point2D>& destinations,
        std::vector<float>& outputMatrix
    );
};

} // namespace TruxifyRouting

#endif // AVX_MATRIX_HPP
