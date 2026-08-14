#include "../include/zstd_simd.hpp"

#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>

int main() {
    using namespace TruxifyCompress;

    // A representative float matrix: smooth-ish data compresses well.
    std::vector<float> matrix;
    matrix.reserve(4096);
    for (int i = 0; i < 4096; ++i) {
        matrix.push_back(static_cast<float>(std::sin(i * 0.01) * 100.0));
    }

    std::vector<uint8_t> compressed =
        Avx512MatrixCompressor::compressFloatMatrix(matrix);

    size_t inputBytes = matrix.size() * sizeof(float);

#ifdef HAVE_ZSTD
    if (compressed.size() >= inputBytes) {
        std::fprintf(stderr,
            "FAIL: compressed size (%zu) not smaller than input (%zu)\n",
            compressed.size(), inputBytes);
        return 1;
    }
    std::printf("compressed %zu -> %zu bytes (%.1f%%)\n",
        inputBytes, compressed.size(),
        100.0 * compressed.size() / inputBytes);
#else
    std::printf("HAVE_ZSTD not defined: skipping size assertion "
                "(raw copy fallback)\n");
#endif

    std::vector<float> restored =
        Avx512MatrixCompressor::decompressFloatMatrix(compressed);

    if (restored.size() != matrix.size()) {
        std::fprintf(stderr,
            "FAIL: restored size %zu != input size %zu\n",
            restored.size(), matrix.size());
        return 1;
    }

    const float tol = 1e-5f;
    bool ok = true;
    for (size_t i = 0; i < matrix.size(); ++i) {
        if (std::fabs(restored[i] - matrix[i]) > tol) {
            ok = false;
            break;
        }
    }
    if (!ok) {
        std::fprintf(stderr, "FAIL: round-trip mismatch\n");
        return 1;
    }

    std::printf("round-trip OK: %zu floats preserved within tolerance\n",
        matrix.size());
    return 0;
}
