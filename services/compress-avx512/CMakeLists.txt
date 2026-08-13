cmake_minimum_required(VERSION 3.18)
project(compress_avx512 CXX)

set(CMAKE_CXX_STANDARD 17)

# Enable AVX-512 compiler flags if supported
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mavx512f -mavx512dq")
endif()

include_directories(include)

add_library(compress_avx512
    src/zstd_simd.cpp
)
