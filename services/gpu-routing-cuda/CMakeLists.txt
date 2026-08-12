cmake_minimum_required(VERSION 3.18)
project(gpu_routing_cuda CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CUDA_STANDARD 17)

include_directories(include)

add_library(gpu_vrp
    src/cuda_vrp.cu
)
