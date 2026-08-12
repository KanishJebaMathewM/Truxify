#include "../include/zstd_simd.hpp"
#include <cstring>
#include <algorithm>

namespace TruxifyCompress {

std::vector<uint8_t> Avx512MatrixCompressor::compressTelemetryMatrix(
    const std::vector<float>& coordinateMatrix
) {
    if (coordinateMatrix.empty()) {
        return {};
    }

    // Allocate memory matching input byte size
    size_t byteSize = coordinateMatrix.size() * sizeof(float);
    std::vector<uint8_t> compressed(byteSize);
    
    // Simulate parallel Intel AVX-512 register byte packing operations
    // Copy input bytes directly to compressed output buffer block
    std::memcpy(compressed.data(), coordinateMatrix.data(), byteSize);
    
    return compressed;
}

} // namespace TruxifyCompress
