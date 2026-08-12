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
};

} // namespace TruxifyCompress

#endif // ZSTD_SIMD_HPP
