"""Check actual native public certificates against exact binary32 rationals."""

import argparse
import math
import random
import struct
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

HARNESS = r"""
#include "matcher.hpp"
#include <cstdint>
#include <cstring>
#include <iostream>
using namespace TruxifyMatcher;
float decode(uint32_t bits) { float result; std::memcpy(&result,&bits,4); return result; }
uint32_t encode(float value) { uint32_t result; std::memcpy(&result,&value,4); return result; }
Box3D box() { uint32_t a,b,c; std::cin>>a>>b>>c; return {decode(a),decode(b),decode(c)}; }
int main() {
    size_t cases; std::cin>>cases;
    while (cases--) {
        auto bed=box(); size_t count; std::cin>>count;
        std::vector<Box3D> cargo; while(count--) cargo.push_back(box());
        auto r=VectorMatcherEngine::evaluatePackingAVX(bed,cargo);
        std::cout<<int(r.status)<<" "<<r.packedCount<<" "<<encode(r.utilizationPercentage)<<" "<<r.placementMap.size();
        for(const auto&p:r.placementMap)
            std::cout<<" "<<encode(p.box.length)<<" "<<encode(p.box.width)<<" "<<encode(p.box.height)
                     <<" "<<encode(p.x)<<" "<<encode(p.y)<<" "<<encode(p.z);
        std::cout<<"\n";
    }
}
"""


def value(bits):
    return struct.unpack("<f", struct.pack("<I", bits))[0]


def bits(number):
    return struct.unpack("<I", struct.pack("<f", number))[0]


def rational(encoded):
    return Fraction.from_float(value(encoded))


def fixtures():
    randomizer = random.Random(18033)
    result = []
    # Exact powers and their neighboring encodings span subnormals to float max.
    for scale in [1, 0x007FFFFF, 0x00800000, 0x3F800000, 0x7F7FFFFF]:
        result.append(([scale] * 3, [[scale] * 3]))
    for _ in range(600):
        bed = [randomizer.randint(1, 0x7F7FFFFF) for _ in range(3)]
        cargo = []
        for _ in range(randomizer.randint(0, 8)):
            if randomizer.random() < 0.6:
                shape = []
                for axis in bed:
                    scaled = value(axis) * randomizer.choice([0.25, 0.5, 0.75, 1])
                    shape.append(max(1, bits(scaled)))
                cargo.append(shape)
            else:
                cargo.append([randomizer.randint(1, 0x7F7FFFFF) for _ in range(3)])
        result.append((bed, cargo))
    # An absorbed offset is unsafe on each coordinate axis, in either ordering.
    for axis in range(3):
        bed = [bits(1)] * 3
        bed[axis] = 0x7F7FFFFF
        small = [bits(1)] * 3
        small[axis] = 1
        for cargo in [[small, bed], [bed, small]]:
            result.append((bed, cargo))
    return result


def check(bed, cargo, row):
    status, count, utilization, size, *placements = map(int, row.split())
    assert len(placements) == 6 * size
    if status != 1:
        assert size == 0 and utilization == 0
        assert count <= len(cargo)
        return
    assert size == count == len(cargo)
    bounds = list(map(rational, bed))
    boxes = []
    occupied = Fraction(0)
    for i in range(size):
        encoded = placements[6 * i : 6 * i + 6]
        assert sorted(encoded[:3]) == sorted(cargo[i])
        dimensions = list(map(rational, encoded[:3]))
        coordinates = list(map(rational, encoded[3:]))
        assert all(d > 0 for d in dimensions)
        assert all(
            c >= 0 and c + d <= b for c, d, b in zip(coordinates, dimensions, bounds)
        )
        for previous_c, previous_d in boxes:
            assert any(
                c + d <= pc or pc + pd <= c
                for c, d, pc, pd in zip(coordinates, dimensions, previous_c, previous_d)
            )
        boxes.append((coordinates, dimensions))
        occupied += math.prod(dimensions)
    ratio = occupied / math.prod(bounds) * 100
    assert 0 <= ratio <= 100
    shown = value(utilization)
    assert math.isfinite(shown) and math.isclose(
        shown, float(ratio), rel_tol=2e-6, abs_tol=1e-6
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", default="clang++")
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    cases = fixtures()
    with tempfile.TemporaryDirectory(prefix="packing-exact-") as temporary:
        source = Path(temporary) / "certificate.cpp"
        executable = Path(temporary) / "certificate"
        source.write_text(HARNESS)
        subprocess.run(
            [
                arguments.compiler,
                "-std=c++17",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-fsanitize=address,undefined",
                "-fno-omit-frame-pointer",
                "-I",
                str(root / "include"),
                str(source),
                str(root / "src/matcher.cpp"),
                "-o",
                str(executable),
            ],
            check=True,
        )
        payload = [str(len(cases))]
        for bed, cargo in cases:
            payload.extend(map(str, bed))
            payload.append(str(len(cargo)))
            for box in cargo:
                payload.extend(map(str, box))
        result = subprocess.run(
            [str(executable)],
            input=" ".join(payload),
            capture_output=True,
            text=True,
            check=True,
        )
        rows = result.stdout.splitlines()
        assert len(rows) == len(cases)
        for (bed, cargo), row in zip(cases, rows):
            check(bed, cargo, row)
    print(
        f"{len(cases)} actual native certificates checked with exact binary32 rationals"
    )


if __name__ == "__main__":
    main()
