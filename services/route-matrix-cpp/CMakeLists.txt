cmake_minimum_required(VERSION 3.14)
project(TruxifyRouteMatrix CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

add_executable(route-matrix-cpp main.cpp)

target_link_libraries(route-matrix-cpp PRIVATE Threads::Threads)

add_executable(test_avx_haversine tests/test_avx_haversine.cpp)

enable_testing()
add_test(NAME avx_haversine COMMAND test_avx_haversine)
