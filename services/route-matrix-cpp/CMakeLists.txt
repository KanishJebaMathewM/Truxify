cmake_minimum_required(VERSION 3.14)
project(TruxifyRouteMatrix CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)
include_directories(include)

add_executable(route-matrix-cpp main.cpp)

target_link_libraries(route-matrix-cpp PRIVATE Threads::Threads)

enable_testing()
add_executable(test_content_length tests/test_content_length.cpp)
add_test(NAME content_length COMMAND test_content_length)

add_executable(matrix_tests tests/matrix_tests.cpp)
add_test(NAME matrix_tests COMMAND matrix_tests)
