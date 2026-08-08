#include <stdio.h>
#include <stdint.h>

// Accelerated C extension helper for VDF modular squaring y = x^(2^T) mod N
uint64_t vdf_repeat_squaring_c(uint64_t x, uint64_t iterations, uint64_t modulus) {
    uint64_t result = x % modulus;
    for (uint64_t i = 0; i < iterations; i++) {
        result = (result * result) % modulus;
    }
    return result;
}
