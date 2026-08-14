cmake_minimum_required(VERSION 3.14)
project(TruxifyMemoryPool CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)

add_executable(test_memory_pool tests/test_memory_pool.cpp)
add_executable(test_memory_pool_stress tests/test_memory_pool_stress.cpp)
target_link_libraries(test_memory_pool_stress PRIVATE Threads::Threads)

enable_testing()
add_test(NAME memory_pool COMMAND test_memory_pool)
add_test(NAME memory_pool_stress COMMAND test_memory_pool_stress)
