cmake_minimum_required(VERSION 3.15)
project(vector_matcher_cpp CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include_directories(include)

add_library(vector_matcher
    src/matcher.cpp
)

add_executable(vector-matcher-cpp
    main.cpp
)

target_compile_options(vector-matcher-cpp PRIVATE -O3)
