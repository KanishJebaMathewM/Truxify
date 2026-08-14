cmake_minimum_required(VERSION 3.18)
project(gpu_tile_decoder CXX)

set(CMAKE_CXX_STANDARD 17)

add_library(gpu_tile_decoder SHARED
    gpu_tile_decoder.cpp
)
