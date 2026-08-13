cmake_minimum_required(VERSION 3.15)
project(vector_matcher_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Threads REQUIRED)

include_directories(include)

add_library(vector_matcher
    src/matcher.cpp
)

add_executable(vector-matcher-cpp
    main.cpp
)

target_compile_options(vector-matcher-cpp PRIVATE -O3)
target_link_libraries(vector-matcher-cpp PRIVATE Threads::Threads)

# Host-side regression tests for the 3D bin-packing routine.
add_executable(vector-matcher-tests
    test/test_matcher.cpp
)

target_link_libraries(vector-matcher-tests PRIVATE vector_matcher)
