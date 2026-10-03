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

add_executable(test_content_length tests/test_content_length.cpp)

add_executable(test_matcher test/test_matcher.cpp)
target_link_libraries(test_matcher PRIVATE vector_matcher)

enable_testing()
add_test(NAME content_length COMMAND test_content_length)
add_test(NAME vector_matcher_packing COMMAND test_matcher)
