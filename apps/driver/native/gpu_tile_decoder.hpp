#ifndef GPU_TILE_DECODER_HPP
#define GPU_TILE_DECODER_HPP

#include <cstdint>
#include <vector>
#include <string>

namespace TruxifyGpu {

struct DecodedGeometry {
    uint32_t vertexCount;
    std::vector<float> vertices;
};

class GpuTileDecoder {
public:
    static DecodedGeometry decodeMvtProtobuf(
        const uint8_t* protoBuffer,
        uint32_t bufferLength
    );
};

} // namespace TruxifyGpu

#endif // GPU_TILE_DECODER_HPP
