#include "matrix_http.hpp"
#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <chrono>
#include <sstream>
#include <algorithm>
#include <cstdlib>
#include <cctype>
#include <cstring>
#include <climits>

#if defined(_WIN32)
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
typedef int socklen_t;
#else
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>
#define SOCKET int
#define INVALID_SOCKET -1
#define SOCKET_ERROR -1
#define closesocket close
#endif

// ---- Minimal HTTP/1.1 server ----

// Returns the body Content-Length from the request head, or 0.
size_t parse_content_length(const std::string& request) {
    size_t header_end = request.find("\r\n\r\n");
    if (header_end == std::string::npos) return 0;

    std::istringstream ss(request.substr(0, header_end));
    std::string line;
    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        size_t colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string name = line.substr(0, colon);
        std::string value = line.substr(colon + 1);
        for (auto& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (name == "content-length") {
            return static_cast<size_t>(std::strtoul(value.c_str(), nullptr, 10));
        }
    }
    return 0;
}

// Splits a request into method, path, and (read) body.
void parse_request(const std::string& request, std::string& method, std::string& path, std::string& body) {
    size_t line_end = request.find("\r\n");
    std::string head = request.substr(0, line_end);
    std::istringstream iss(head);
    iss >> method >> path;

    size_t header_end = request.find("\r\n\r\n");
    if (header_end != std::string::npos) {
        size_t content_length = parse_content_length(request);
        size_t body_start = header_end + 4;
        if (request.size() >= body_start + content_length) {
            body = request.substr(body_start, content_length);
        }
    }
}

// Wraps a JSON payload in an HTTP/1.1 response.
std::string build_response(const std::string& body, const std::string& status) {
    std::stringstream ss;
    ss << "HTTP/1.1 " << status << "\r\n";
    ss << "Content-Type: application/json\r\n";
    ss << "Content-Length: " << body.size() << "\r\n";
    ss << "Connection: close\r\n\r\n";
    ss << body;
    return ss.str();
}

// Sends all bytes, looping until the whole buffer is on the wire. The length
// passed to send() is capped at INT_MAX so a large buffer can never be
// truncated/corrupted by an int cast.
void send_all(SOCKET client, const std::string& data) {
    size_t total = data.size();
    size_t sent = 0;
    while (sent < total) {
        size_t remaining = total - sent;
        if (remaining > static_cast<size_t>(INT_MAX)) {
            remaining = static_cast<size_t>(INT_MAX);
        }
        int n = send(client, data.c_str() + sent, static_cast<int>(remaining), 0);
        if (n <= 0) return;
        sent += static_cast<size_t>(n);
    }
}

// Sends one chunked-encoding frame (empty data sends the terminating chunk).
void send_chunk(SOCKET client, const std::string& data) {
    if (data.empty()) {
        send_all(client, "0\r\n\r\n");
        return;
    }
    std::stringstream frame;
    frame << std::hex << data.size() << "\r\n";
    frame << data << "\r\n";
    send_all(client, frame.str());
}

// Streams the NxN matrix response row-by-row using chunked transfer encoding,
// so the response is never materialized as one giant in-memory buffer and each
// individual send stays far below INT_MAX.
void stream_matrix_response(SOCKET client, const std::vector<TruxifyMatrix::Location>& locs) {
    std::stringstream head;
    head << "HTTP/1.1 200 OK\r\n";
    head << "Content-Type: application/json\r\n";
    head << "Transfer-Encoding: chunked\r\n";
    head << "Connection: close\r\n\r\n";
    send_all(client, head.str());

    auto start_time = std::chrono::high_resolution_clock::now();

    std::stringstream opening;
    opening << "{\n";
    opening << "  \"success\": true,\n";
    opening << "  \"engine\": \"Truxify C++ SIMD Matrix Solver v1.0\",\n";
    opening << "  \"matrix\": [\n";
    send_chunk(client, opening.str());

    bool first = true;
    for (size_t i = 0; i < locs.size(); ++i) {
        std::stringstream row;
        for (size_t j = 0; j < locs.size(); ++j) {
            if (!first) row << ",\n";
            first = false;

            double dist = TruxifyMatrix::haversine_km(locs[i].lat, locs[i].lng, locs[j].lat, locs[j].lng);
            double duration = (dist / 45.0) * 60.0; // 45 km/h avg truck speed
            double cost = dist * 12.5;              // 12.5 INR / km tariff

            row << "    {\n";
            row << "      \"origin\": \"" << locs[i].id << "\",\n";
            row << "      \"destination\": \"" << locs[j].id << "\",\n";
            row << "      \"distance_km\": " << dist << ",\n";
            row << "      \"duration_mins\": " << duration << ",\n";
            row << "      \"tariff_inr\": " << cost << "\n";
            row << "    }";
        }
        send_chunk(client, row.str());
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double compute_us = std::chrono::duration<double, std::micro>(end_time - start_time).count();

    std::stringstream tail;
    tail << "\n  ],\n";
    tail << "  \"compute_time_us\": " << compute_us << "\n";
    tail << "}";
    send_chunk(client, tail.str());

    send_chunk(client, "");
}

// Reads one request and writes one response on the given client socket.
void handle_client(SOCKET client) {
    char buf[8192];
    std::string request;
    for (;;) {
        int n = recv(client, buf, sizeof(buf), 0);
        if (n <= 0) break;
        request.append(buf, static_cast<size_t>(n));

        size_t header_end = request.find("\r\n\r\n");
        if (header_end != std::string::npos) {
            size_t content_length = parse_content_length(request);
            if (request.size() >= header_end + 4 + content_length) break;
        }
        if (request.size() > 65536) break;
    }

    std::string method, path, body;
    parse_request(request, method, path, body);

    std::string response;
    if (method == "GET" && path == "/health") {
        response = build_response("{\"status\":\"ok\",\"service\":\"route-matrix-cpp\"}", "200 OK");
    } else if (method == "POST" && path == "/matrix") {
        TruxifyMatrix::ParseLocationsResult parsed = TruxifyMatrix::parse_locations(body);
        TruxifyMatrix::MatrixHttpDecision decision = TruxifyMatrix::decide_matrix_request(parsed);
        if (!decision.ok) {
            response = build_response(decision.error_body, decision.status_line);
        } else {
            stream_matrix_response(client, parsed.locs);
            return;
        }
    } else {
        response = build_response("{\"error\":\"not found\"}", "404 Not Found");
    }

    send_all(client, response);
}

int main() {
    std::cout << "🚀 Truxify C++ High-Speed Matrix Engine starting..." << std::endl;

    // Startup self-test with the sample city set.
    std::vector<TruxifyMatrix::Location> sample = {
        {"Mumbai", 19.0760, 72.8777},
        {"Delhi", 28.7041, 77.1025},
        {"Bangalore", 12.9716, 77.5946},
        {"Chennai", 13.0827, 80.2707},
        {"Kolkata", 22.5726, 88.3639}
    };
    std::string sample_out = TruxifyMatrix::compute_matrix_json(sample);
    std::cout << "✅ Sample Matrix Output:\n" << sample_out.substr(0, 300) << "...\n";

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_sock == INVALID_SOCKET) {
        std::cerr << "Failed to create socket" << std::endl;
        return 1;
    }

    int opt = 1;
    setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&opt), sizeof(opt));

    sockaddr_in addr;
    std::memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons(8086);

    if (bind(listen_sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "Failed to bind port 8086" << std::endl;
        closesocket(listen_sock);
        return 1;
    }

    if (listen(listen_sock, 16) == SOCKET_ERROR) {
        std::cerr << "Failed to listen on 8086" << std::endl;
        closesocket(listen_sock);
        return 1;
    }

    std::cout << "✅ Route Matrix Engine listening on port 8086" << std::endl;

    for (;;) {
        SOCKET client = accept(listen_sock, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        handle_client(client);
        closesocket(client);
    }
}
