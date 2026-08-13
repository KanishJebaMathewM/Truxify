cmake_minimum_required(VERSION 3.18)
project(compress_avx512 CXX)

set(CMAKE_CXX_STANDARD 17)

# Enable AVX-512 compiler flags if supported
if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
    set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mavx512f -mavx512dq")
endif()

include_directories(include)

# Optional libzstd: when found, enable real compression via HAVE_ZSTD.
find_package(zstd QUIET)
if(zstd_FOUND)
    target_compile_definitions(compress_avx512 PUBLIC HAVE_ZSTD)
    target_link_libraries(compress_avx512 PUBLIC zstd::zstd)
else()
    # Build note: zstd.h is not vendored in this repo. Install libzstd and
    # ensure it is discoverable (or set -DHAVE_ZSTD and link -lzstd) to enable
    # real compression; otherwise zstd_simd.cpp falls back to a raw byte copy.
    message(STATUS "zstd not found: compress-avx512 builds without real "
            "compression (HAVE_ZSTD undefined)")
endif()

add_library(compress_avx512
    src/zstd_simd.cpp
)

find_package(GTest QUIET)
if(GTest_FOUND)
    add_executable(test_zstd_simd test/test_zstd_simd.cpp)
    target_link_libraries(test_zstd_simd PRIVATE compress_avx512 GTest::gtest GTest::gtest_main)
    if(zstd_FOUND)
        target_compile_definitions(test_zstd_simd PRIVATE HAVE_ZSTD)
        target_link_libraries(test_zstd_simd PRIVATE zstd::zstd)
    endif()
endif()
