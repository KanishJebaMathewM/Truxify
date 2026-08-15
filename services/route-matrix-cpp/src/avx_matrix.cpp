#include "../include/avx_matrix.hpp"
#include <algorithm>
#include <cmath>
#include <immintrin.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace TruxifyRouting {

namespace {

// Great-circle distance in km between two (lat, lon) points, matching
// haversine_km() used by the HTTP endpoint and the unit tests.
float haversine_km(float lat1, float lon1, float lat2, float lon2) {
    const double R = 6371.0; // Earth radius in km
    double dLat = static_cast<double>(lat2 - lat1) * M_PI / 180.0;
    double dLon = static_cast<double>(lon2 - lon1) * M_PI / 180.0;
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(static_cast<double>(lat1) * M_PI / 180.0) *
               std::cos(static_cast<double>(lat2) * M_PI / 180.0) *
               std::sin(dLon / 2.0) * std::sin(dLon / 2.0);
    a = std::min(1.0, a);
    double c = 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
    return static_cast<float>(R * c);
}

} // namespace

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
            outputMatrix[i * M + j] =
                haversine_km(origins[i].x, origins[i].y,
                             destinations[j].x, destinations[j].y);
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
    const __m512 R = _mm512_set1_ps(6371.0f);
    const __m512 inv180 = _mm512_set1_ps(static_cast<float>(M_PI / 180.0));
    const __m512 half = _mm512_set1_ps(0.5f);
    const __m512 one = _mm512_set1_ps(1.0f);
    const __m512 two = _mm512_set1_ps(2.0f);

    for (size_t i = 0; i < N; ++i) {
        __m512 orig_lat = _mm512_set1_ps(origins[i].x);
        __m512 orig_lon = _mm512_set1_ps(origins[i].y);

        size_t j = 0;
        for (; j + 16 <= M; j += 16) {
            alignas(64) float dest_lat_buf[16];
            alignas(64) float dest_lon_buf[16];
            for (size_t k = 0; k < 16; ++k) {
                dest_lat_buf[k] = destinations[j + k].x;
                dest_lon_buf[k] = destinations[j + k].y;
            }

            __m512 dest_lat = _mm512_load_ps(dest_lat_buf);
            __m512 dest_lon = _mm512_load_ps(dest_lon_buf);

            __m512 dLat = _mm512_mul_ps(_mm512_sub_ps(dest_lat, orig_lat), inv180);
            __m512 dLon = _mm512_mul_ps(_mm512_sub_ps(dest_lon, orig_lon), inv180);

            __m512 sin_dLat2 = _mm512_sin_ps(_mm512_mul_ps(dLat, half));
            __m512 sin_dLon2 = _mm512_sin_ps(_mm512_mul_ps(dLon, half));
            __m512 sin_dLat2_sq = _mm512_mul_ps(sin_dLat2, sin_dLat2);
            __m512 sin_dLon2_sq = _mm512_mul_ps(sin_dLon2, sin_dLon2);

            __m512 cos_lat1 = _mm512_cos_ps(_mm512_mul_ps(orig_lat, inv180));
            __m512 cos_lat2 = _mm512_cos_ps(_mm512_mul_ps(dest_lat, inv180));
            __m512 term2 = _mm512_mul_ps(_mm512_mul_ps(cos_lat1, cos_lat2),
                                         sin_dLon2_sq);
            __m512 a = _mm512_add_ps(sin_dLat2_sq, term2);
            a = _mm512_min_ps(a, one);

            __m512 sqrt_a = _mm512_sqrt_ps(a);
            __m512 sqrt_1ma = _mm512_sqrt_ps(_mm512_sub_ps(one, a));
            __m512 c = _mm512_mul_ps(two, _mm512_atan2_ps(sqrt_a, sqrt_1ma));
            __m512 dist = _mm512_mul_ps(R, c);

            _mm512_storeu_ps(&outputMatrix[i * M + j], dist);
        }

        // Tail processing for remainder elements
        for (; j < M; ++j) {
            outputMatrix[i * M + j] =
                haversine_km(origins[i].x, origins[i].y,
                             destinations[j].x, destinations[j].y);
        }
    }
#else
    // Fallback to scalar implementation if compiled without AVX-512 flags
    computeDistanceMatrixScalar(origins, destinations, outputMatrix);
#endif
}

} // namespace TruxifyRouting
