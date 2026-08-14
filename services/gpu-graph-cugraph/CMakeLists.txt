cmake_minimum_required(VERSION 3.18)
project(gpu_graph_cugraph CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CUDA_STANDARD 17)

include_directories(include)

add_library(gpu_pagerank
    src/driver_pagerank.cu
)
