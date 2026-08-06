#include "../include/avx_matrix.hpp"
#include <iostream>
#include <chrono>
#include <vector>

int main() {
    std::cout << "Running AVX-512 Distance Matrix Benchmark..." << std::endl;

    size_t N = 500;
    size_t M = 500;

    std::vector<TruxifyRouting::Point2D> origins(N);
    std::vector<TruxifyRouting::Point2D> destinations(M);

    for (size_t i = 0; i < N; ++i) {
        origins[i] = { static_cast<float>(i * 0.1), static_cast<float>(i * 0.2) };
    }
    for (size_t j = 0; j < M; ++j) {
        destinations[j] = { static_cast<float>(j * 0.15), static_cast<float>(j * 0.25) };
    }

    std::vector<float> matrixScalar;
    std::vector<float> matrixAVX;

    auto t1 = std::chrono::high_resolution_clock::now();
    TruxifyRouting::AVXMatrixCalculator::computeDistanceMatrixScalar(origins, destinations, matrixScalar);
    auto t2 = std::chrono::high_resolution_clock::now();

    auto t3 = std::chrono::high_resolution_clock::now();
    TruxifyRouting::AVXMatrixCalculator::computeDistanceMatrixAVX512(origins, destinations, matrixAVX);
    auto t4 = std::chrono::high_resolution_clock::now();

    auto durScalar = std::chrono::duration_cast<std::chrono::microseconds>(t2 - t1).count();
    auto durAVX = std::chrono::duration_cast<std::chrono::microseconds>(t4 - t3).count();

    std::cout << "Scalar execution time: " << durScalar << " us" << std::endl;
    std::cout << "AVX-512 execution time: " << durAVX << " us" << std::endl;
    std::cout << "Benchmark complete." << std::endl;

    return 0;
}
