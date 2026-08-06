#include "../include/avx_matrix.hpp"
#include <cmath>
#include <immintrin.h>

namespace TruxifyRouting {

void AVXMatrixCalculator::computeDistanceMatrixScalar(
    const std::vector<Point2D>& origins,
    const std::vector<Point2D>& destinations,
    std::vector<float>& outputMatrix
) {
    size_t N = origins.size();
    size_t M = destinations.size();
    outputMatrix.resize(N * M);

    for (size_t i = 0; i < N; ++i) {
        for (size_t j = 0; j < M; ++j) {
            float dx = origins[i].x - destinations[j].x;
            float dy = origins[i].y - destinations[j].y;
            outputMatrix[i * M + j] = std::sqrt(dx * dx + dy * dy);
        }
    }
}

void AVXMatrixCalculator::computeDistanceMatrixAVX512(
    const std::vector<Point2D>& origins,
    const std::vector<Point2D>& destinations,
    std::vector<float>& outputMatrix
) {
    size_t N = origins.size();
    size_t M = destinations.size();
    outputMatrix.resize(N * M);

#if defined(__AVX512F__)
    for (size_t i = 0; i < N; ++i) {
        __m512 orig_x = _mm512_set1_ps(origins[i].x);
        __m512 orig_y = _mm512_set1_ps(origins[i].y);

        size_t j = 0;
        for (; j + 16 <= M; j += 16) {
            alignas(64) float dest_x_buf[16];
            alignas(64) float dest_y_buf[16];
            for (size_t k = 0; k < 16; ++k) {
                dest_x_buf[k] = destinations[j + k].x;
                dest_y_buf[k] = destinations[j + k].y;
            }

            __m512 dest_x = _mm512_load_ps(dest_x_buf);
            __m512 dest_y = _mm512_load_ps(dest_y_buf);

            __m512 dx = _mm512_sub_ps(orig_x, dest_x);
            __m512 dy = _mm512_sub_ps(orig_y, dest_y);

            __m512 dx2 = _mm512_mul_ps(dx, dx);
            __m512 dy2 = _mm512_mul_ps(dy, dy);

            __m512 sum = _mm512_add_ps(dx2, dy2);
            __m512 dist = _mm512_sqrt_ps(sum);

            _mm512_storeu_ps(&outputMatrix[i * M + j], dist);
        }

        // Tail processing for remainder elements
        for (; j < M; ++j) {
            float dx = origins[i].x - destinations[j].x;
            float dy = origins[i].y - destinations[j].y;
            outputMatrix[i * M + j] = std::sqrt(dx * dx + dy * dy);
        }
    }
#else
    // Fallback to scalar implementation if compiled without AVX-512 flags
    computeDistanceMatrixScalar(origins, destinations, outputMatrix);
#endif
}

} // namespace TruxifyRouting
