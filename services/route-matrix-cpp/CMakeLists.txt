cmake_minimum_required(VERSION 3.14)
project(TruxifyRouteMatrix CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

add_executable(route-matrix-cpp main.cpp)

enable_testing()

add_executable(matrix_tests tests/matrix_tests.cpp)
add_test(NAME matrix_tests COMMAND matrix_tests)
