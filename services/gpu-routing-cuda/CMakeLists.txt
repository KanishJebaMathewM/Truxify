cmake_minimum_required(VERSION 3.18)
project(gpu_routing_cuda CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CUDA_STANDARD 17)

include_directories(include)

add_library(gpu_vrp
    src/cuda_vrp.cu
)
<<<<<<< HEAD
=======

enable_testing()

add_executable(gpu_vrp_tests
    src/cuda_vrp_tests.cu
)
target_link_libraries(gpu_vrp_tests PRIVATE gpu_vrp)

add_test(NAME gpu_vrp_tests COMMAND gpu_vrp_tests)
>>>>>>> upstream/main
