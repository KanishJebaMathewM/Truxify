#ifndef ZSTD_SIMD_HPP
#define ZSTD_SIMD_HPP

#include <vector>
#include <cstdint>
#include <cstddef>

namespace TruxifyCompress {

class Avx512MatrixCompressor {
public:
    static std::vector<uint8_t> compressTelemetryMatrix(
        const std::vector<float>& coordinateMatrix
    );

    // Real ZSTD compression of a float matrix. Returns the compressed byte
    // buffer. Requires libzstd (HAVE_ZSTD); without it, falls back to a raw
    // byte copy so the build still succeeds (see CMakeLists.txt).
    static std::vector<uint8_t> compressFloatMatrix(
        const std::vector<float>& floatMatrix,
        int level = 3
    );

    // Inverse of compressFloatMatrix. Restores the original float vector.
    static std::vector<float> decompressFloatMatrix(
        const std::vector<uint8_t>& compressed
    );
};

} // namespace TruxifyCompress

#endif // ZSTD_SIMD_HPP
