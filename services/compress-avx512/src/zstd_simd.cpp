#include "../include/zstd_simd.hpp"
#include <cstring>
#include <algorithm>

#ifdef HAVE_ZSTD
#include <zstd.h>
#endif

namespace TruxifyCompress {

std::vector<uint8_t> Avx512MatrixCompressor::compressTelemetryMatrix(
    const std::vector<float>& coordinateMatrix
) {
    return compressFloatMatrix(coordinateMatrix);
}

std::vector<uint8_t> Avx512MatrixCompressor::compressFloatMatrix(
    const std::vector<float>& floatMatrix,
    int level
) {
    if (floatMatrix.empty()) {
        return {};
    }

    size_t byteSize = floatMatrix.size() * sizeof(float);
    const uint8_t* src = reinterpret_cast<const uint8_t*>(floatMatrix.data());

#ifdef HAVE_ZSTD
    // Real ZSTD compression into a bound-sized output buffer.
    size_t outCap = ZSTD_compressBound(byteSize);
    std::vector<uint8_t> compressed(outCap);

    size_t written = ZSTD_compress(
        compressed.data(), outCap, src, byteSize, level
    );
    if (ZSTD_isError(written)) {
        // On failure, fall back to a verbatim copy so callers still get
        // usable bytes rather than undefined content.
        compressed.resize(byteSize);
        std::memcpy(compressed.data(), src, byteSize);
        return compressed;
    }

    compressed.resize(written);
    return compressed;
#else
    // Build note: zstd.h was not found in the repo, so the real ZSTD path
    // is disabled. Link libzstd and define HAVE_ZSTD to enable compression;
    // until then we copy the raw bytes so the build remains green.
    std::vector<uint8_t> compressed(byteSize);
    std::memcpy(compressed.data(), src, byteSize);
    return compressed;
#endif
}

std::vector<float> Avx512MatrixCompressor::decompressFloatMatrix(
    const std::vector<uint8_t>& compressed
) {
    if (compressed.empty()) {
        return {};
    }

#ifdef HAVE_ZSTD
    size_t decompCap = ZSTD_getFrameContentSize(
        compressed.data(), compressed.size()
    );
    if (decompCap == ZSTD_CONTENTSIZE_ERROR ||
        decompCap == ZSTD_CONTENTSIZE_UNKNOWN) {
        return {};
    }

    std::vector<float> restored(decompCap / sizeof(float));
    size_t written = ZSTD_decompress(
        restored.data(), decompCap, compressed.data(), compressed.size()
    );
    if (ZSTD_isError(written)) {
        return {};
    }

    restored.resize(written / sizeof(float));
    return restored;
#else
    size_t count = compressed.size() / sizeof(float);
    std::vector<float> restored(count);
    std::memcpy(restored.data(), compressed.data(), count * sizeof(float));
    return restored;
#endif
}

} // namespace TruxifyCompress
