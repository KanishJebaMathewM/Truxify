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

    // Great-circle (haversine) distance in km. Point2D.x is latitude and
    // Point2D.y is longitude (see avx_matrix.hpp), so degrees must be treated
    // as angular coordinates, not a Cartesian plane.
    constexpr float R = 6371.008f;
    constexpr float D2R = static_cast<float>(M_PI / 180.0);

    for (size_t i = 0; i < N; ++i) {
        float lat1 = origins[i].x;
        float lon1 = origins[i].y;
        for (size_t j = 0; j < M; ++j) {
            float lat2 = destinations[j].x;
            float lon2 = destinations[j].y;

            float dLat = (lat2 - lat1) * D2R;
            float dLon = (lon2 - lon1) * D2R;
            float a = std::sin(dLat / 2.0f) * std::sin(dLat / 2.0f) +
                      std::cos(lat1 * D2R) * std::cos(lat2 * D2R) *
                          std::sin(dLon / 2.0f) * std::sin(dLon / 2.0f);
            a = std::min(1.0f, a);
            float c = 2.0f * std::asin(std::sqrt(a));
            outputMatrix[i * M + j] = R * c;
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
    // Great-circle (haversine) distance in km, consistent with the scalar
    // path and with haversine_km() in main.cpp. Point2D.x is latitude and
    // Point2D.y is longitude, so degrees are angular coordinates.
    constexpr float R = 6371.008f;
    constexpr float D2R = static_cast<float>(M_PI / 180.0);
    const __m512 Rv = _mm512_set1_ps(R);
    const __m512 d2r = _mm512_set1_ps(D2R);
    const __m512 half = _mm512_set1_ps(0.5f);
    const __m512 one = _mm512_set1_ps(1.0f);

    for (size_t i = 0; i < N; ++i) {
        __m512 lat1 = _mm512_set1_ps(origins[i].x);
        __m512 lon1 = _mm512_set1_ps(origins[i].y);

        size_t j = 0;
        for (; j + 16 <= M; j += 16) {
            alignas(64) float dest_x_buf[16];
            alignas(64) float dest_y_buf[16];
            for (size_t k = 0; k < 16; ++k) {
                dest_x_buf[k] = destinations[j + k].x;
                dest_y_buf[k] = destinations[j + k].y;
            }

            __m512 lat2 = _mm512_load_ps(dest_x_buf);
            __m512 lon2 = _mm512_load_ps(dest_y_buf);

            __m512 dLat = _mm512_mul_ps(_mm512_sub_ps(lat2, lat1), d2r);
            __m512 dLon = _mm512_mul_ps(_mm512_sub_ps(lon2, lon1), d2r);

            __m512 sin_dLat = _mm512_sin_ps(_mm512_mul_ps(dLat, half));
            __m512 sin_dLat2 = _mm512_mul_ps(sin_dLat, sin_dLat);

            __m512 sin_dLon = _mm512_sin_ps(_mm512_mul_ps(dLon, half));
            __m512 sin_dLon2 = _mm512_mul_ps(sin_dLon, sin_dLon);

            __m512 cos_lat1 = _mm512_cos_ps(_mm512_mul_ps(lat1, d2r));
            __m512 cos_lat2 = _mm512_cos_ps(_mm512_mul_ps(lat2, d2r));

            __m512 a = _mm512_fmadd_ps(_mm512_mul_ps(cos_lat1, cos_lat2),
                                       sin_dLon2, sin_dLat2);
            a = _mm512_min_ps(a, one);

            __m512 sqa = _mm512_sqrt_ps(a);
            __m512 c = _mm512_mul_ps(_mm512_asin_ps(sqa), _mm512_set1_ps(2.0f));

            __m512 dist = _mm512_mul_ps(Rv, c);

            _mm512_storeu_ps(&outputMatrix[i * M + j], dist);
        }

        // Tail processing for remainder elements (scalar haversine)
        for (; j < M; ++j) {
            float lat2 = destinations[j].x;
            float lon2 = destinations[j].y;

            float dLat = (lat2 - origins[i].x) * D2R;
            float dLon = (lon2 - origins[i].y) * D2R;
            float a = std::sin(dLat / 2.0f) * std::sin(dLat / 2.0f) +
                      std::cos(origins[i].x * D2R) * std::cos(lat2 * D2R) *
                          std::sin(dLon / 2.0f) * std::sin(dLon / 2.0f);
            a = std::min(1.0f, a);
            float c = 2.0f * std::asin(std::sqrt(a));
            outputMatrix[i * M + j] = R * c;
        }
    }
#else
    // Fallback to scalar implementation if compiled without AVX-512 flags
    computeDistanceMatrixScalar(origins, destinations, outputMatrix);
#endif
}

} // namespace TruxifyRouting
