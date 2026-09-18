cmake_minimum_required(VERSION 3.18)
project(gpu_routing_cuda CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(CheckLanguage)
check_language(CUDA)

set(TRUXIFY_ENABLE_CUDA_DEFAULT OFF)
if(CMAKE_CUDA_COMPILER)
    set(TRUXIFY_ENABLE_CUDA_DEFAULT ON)
endif()

option(
    TRUXIFY_ENABLE_CUDA
    "Build the VRP sources with the CUDA compiler when available"
    ${TRUXIFY_ENABLE_CUDA_DEFAULT}
)

if(TRUXIFY_ENABLE_CUDA)
    enable_language(CUDA)
    set(CMAKE_CUDA_STANDARD 17)
    set(CMAKE_CUDA_STANDARD_REQUIRED ON)
    set(GPU_VRP_SOURCE src/cuda_vrp.cu)
    set(GPU_VRP_TEST_SOURCE src/cuda_vrp_tests.cu)
else()
    message(STATUS "CUDA toolkit not found or disabled; building VRP sources as host C++ for tests")
    set(GPU_VRP_SOURCE src/cuda_vrp_host.cpp)
    set(GPU_VRP_TEST_SOURCE src/cuda_vrp_host_tests.cpp)
endif()

include_directories(include)

add_library(gpu_vrp
    ${GPU_VRP_SOURCE}
)

add_executable(gpu_vrp_tests
    ${GPU_VRP_TEST_SOURCE}
)

target_link_libraries(gpu_vrp_tests PRIVATE gpu_vrp)

enable_testing()
add_test(NAME gpu_vrp_tests COMMAND gpu_vrp_tests)
