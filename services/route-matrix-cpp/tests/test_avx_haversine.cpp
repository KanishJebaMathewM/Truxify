#include "../include/avx_matrix.hpp"
#include <cmath>
#include <iostream>
#include <vector>
#include <cassert>
#include <cstddef>

// Reference great-circle distance, matching haversine_km() in main.cpp.
static double haversine_km(double lat1, double lon1, double lat2, double lon2) {
    const double R = 6371.0;
    double dLat = (lat2 - lat1) * M_PI / 180.0;
    double dLon = (lon2 - lon1) * M_PI / 180.0;
    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * M_PI / 180.0) * std::cos(lat2 * M_PI / 180.0) *
                   std::sin(dLon / 2.0) * std::sin(dLon / 2.0);
    a = std::min(1.0, a);
    double c = 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
    return R * c;
}

int main() {
    // A small set of real city coordinates (lat, lon).
    std::vector<TruxifyRouting::Point2D> origins = {
        {19.0760f, 72.8777f},  // Mumbai
        {28.7041f, 77.1025f},  // Delhi
        {12.9716f, 77.5946f},  // Bangalore
    };
    std::vector<TruxifyRouting::Point2D> destinations = {
        {13.0827f, 80.2707f},  // Chennai
        {22.5726f, 88.3639f},  // Kolkata
        {19.0760f, 72.8777f},  // Mumbai
        {8.5061f,  76.9570f},  // Trivandrum
    };

    std::vector<float> avx, scalar;
    TruxifyRouting::AVXMatrixCalculator::computeDistanceMatrixAVX512(origins, destinations, avx);
    TruxifyRouting::AVXMatrixCalculator::computeDistanceMatrixScalar(origins, destinations, scalar);

    assert(avx.size() == origins.size() * destinations.size());
    assert(scalar.size() == avx.size());

    const double tol = 1e-2; // km; float precision vs double reference
    for (size_t i = 0; i < origins.size(); ++i) {
        for (size_t j = 0; j < destinations.size(); ++j) {
            double expected = haversine_km(origins[i].x, origins[i].y,
                                           destinations[j].x, destinations[j].y);
            size_t idx = i * destinations.size() + j;
            assert(std::fabs(static_cast<double>(avx[idx]) - expected) <= tol);
            assert(std::fabs(static_cast<double>(scalar[idx]) - expected) <= tol);
        }
    }

    // Same-origin check: distance from Mumbai to the Mumbai destination (~idx 2)
    // must be ~0.
    size_t self = 2; // Mumbai appears as destinations[2]
    assert(std::fabs(static_cast<double>(avx[0 * destinations.size() + self])) < 1e-3);
    assert(std::fabs(static_cast<double>(scalar[0 * destinations.size() + self])) < 1e-3);

    std::cout << "✅ AVX/haversine unit tests passed." << std::endl;
    return 0;
}
