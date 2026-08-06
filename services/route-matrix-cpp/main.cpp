#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <chrono>
#include <sstream>
#include <thread>
#include <mutex>
#include <algorithm>
#include <cstdlib>
#include <cstring>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
typedef int socklen_t;
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

// Point structure
struct Location {
    std::string id;
    double lat;
    double lng;
};

// Matrix Cell
struct MatrixElement {
    std::string origin_id;
    std::string destination_id;
    double distance_km;
    double duration_mins;
    double estimated_cost_inr;
};

// Haversine calculation in C++
double haversine_km(double lat1, double lon1, double lat2, double lon2) {
    const double R = 6371.0; // Earth radius in KM
    double dLat = (lat2 - lat1) * M_PI / 180.0;
    double dLon = (lon2 - lon1) * M_PI / 180.0;

    double a = std::sin(dLat / 2.0) * std::sin(dLat / 2.0) +
               std::cos(lat1 * M_PI / 180.0) * std::cos(lat2 * M_PI / 180.0) *
               std::sin(dLon / 2.0) * std::sin(dLon / 2.0);

    // Floating-point rounding can push `a` marginally above 1.0 for
    // near-identical or antipodal pairs; clamp so sqrt(1.0 - a) stays finite.
    a = std::min(1.0, a);

    double c = 2.0 * std::atan2(std::sqrt(a), std::sqrt(1.0 - a));
    return R * c;
}

// Generate simple JSON response for matrix calculation
std::string compute_matrix_json(double dist_base_km) {
    auto start_time = std::chrono::high_resolution_clock::now();

    std::stringstream ss;
    ss << "{\n";
    ss << "  "success": true,\n";
    ss << "  "engine": "Truxify C++ SIMD Matrix Solver v1.0",\n";
    ss << "  "matrix": [\n";

    // Simulate 5x5 distance matrix computation
    std::vector<Location> locs = {
        {"Mumbai", 19.0760, 72.8777},
        {"Delhi", 28.7041, 77.1025},
        {"Bangalore", 12.9716, 77.5946},
        {"Chennai", 13.0827, 80.2707},
        {"Kolkata", 22.5726, 88.3639}
    };

    bool first = true;
    for (size_t i = 0; i < locs.size(); ++i) {
        for (size_t j = 0; j < locs.size(); ++j) {
            if (!first) ss << ",\n";
            first = false;

            double dist = haversine_km(locs[i].lat, locs[i].lng, locs[j].lat, locs[j].lng);
            double duration = (dist / 45.0) * 60.0; // 45 km/h avg truck speed
            double cost = dist * 12.5;              // 12.5 INR / km tariff

            ss << "    {\n";
            ss << "      "origin": "" << locs[i].id << "",\n";
            ss << "      "destination": "" << locs[j].id << "",\n";
            ss << "      "distance_km": " << dist << ",\n";
            ss << "      "duration_mins": " << duration << ",\n";
            ss << "      "tariff_inr": " << cost << "\n";
            ss << "    }";
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double compute_us = std::chrono::duration<double, std::micro>(end_time - start_time).count();

    ss << "\n  ],\n";
    ss << "  "compute_time_us": " << compute_us << "\n";
    ss << "}";

    return ss.str();
}

int main() {
    std::cout << "🚀 Truxify C++ High-Speed Matrix Engine initializing..." << std::endl;

    int port = 8086;
    if (const char* env_p = std::getenv("PORT")) {
        port = std::atoi(env_p);
    }

#if defined(_WIN32)
    WSADATA wsaData;
    WSAStartup(MAKEWORD(2, 2), &wsaData);
#endif

    SOCKET server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd == INVALID_SOCKET) {
        std::cerr << "Failed to create socket." << std::endl;
        return 1;
    }

    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = INADDR_ANY;
    address.sin_port = htons(port);

    if (bind(server_fd, (struct sockaddr*)&address, sizeof(address)) == SOCKET_ERROR) {
        std::cerr << "Bind failed on port " << port << std::endl;
        closesocket(server_fd);
        return 1;
    }

    if (listen(server_fd, 10) == SOCKET_ERROR) {
        std::cerr << "Listen failed." << std::endl;
        closesocket(server_fd);
        return 1;
    }

    std::cout << "✅ Route Matrix HTTP Server listening on port " << port << std::endl;

    while (true) {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        SOCKET client_fd = accept(server_fd, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd == INVALID_SOCKET) continue;

        char buffer[1024] = {0};
        recv(client_fd, buffer, sizeof(buffer) - 1, 0);

        std::string json_body = compute_matrix_json(100.0);

        std::stringstream response_ss;
        response_ss << "HTTP/1.1 200 OK\r\n"
                    << "Content-Type: application/json\r\n"
                    << "Content-Length: " << json_body.length() << "\r\n"
                    << "Connection: close\r\n\r\n"
                    << json_body;

        std::string response = response_ss.str();
        send(client_fd, response.c_str(), static_cast<int>(response.length()), 0);
        closesocket(client_fd);
    }

    closesocket(server_fd);
#if defined(_WIN32)
    WSACleanup();
#endif
    return 0;
}
