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

// Generate simple JSON response for the NxN matrix over the given locations
std::string compute_matrix_json(const std::vector<Location>& locs) {
    auto start_time = std::chrono::high_resolution_clock::now();

    std::stringstream ss;
    ss << "{\n";
    ss << "  \"success\": true,\n";
    ss << "  \"engine\": \"Truxify C++ SIMD Matrix Solver v1.0\",\n";
    ss << "  \"matrix\": [\n";

    bool first = true;
    for (size_t i = 0; i < locs.size(); ++i) {
        for (size_t j = 0; j < locs.size(); ++j) {
            if (!first) ss << ",\n";
            first = false;

            double dist = haversine_km(locs[i].lat, locs[i].lng, locs[j].lat, locs[j].lng);
            double duration = (dist / 45.0) * 60.0; // 45 km/h avg truck speed
            double cost = dist * 12.5;              // 12.5 INR / km tariff

            ss << "    {\n";
            ss << "      \"origin\": \"" << locs[i].id << "\",\n";
            ss << "      \"destination\": \"" << locs[j].id << "\",\n";
            ss << "      \"distance_km\": " << dist << ",\n";
            ss << "      \"duration_mins\": " << duration << ",\n";
            ss << "      \"tariff_inr\": " << cost << "\n";
            ss << "    }";
        }
    }

    auto end_time = std::chrono::high_resolution_clock::now();
    double compute_us = std::chrono::duration<double, std::micro>(end_time - start_time).count();

    ss << "\n  ],\n";
    ss << "  \"compute_time_us\": " << compute_us << "\n";
    ss << "}";

    return ss.str();
}

// ---- Minimal JSON extraction helpers for the /matrix request body ----

// Extracts a quoted string value for a quoted key, e.g. "id" : "A".
std::string extract_string_field(const std::string& obj, const std::string& key) {
    std::string quoted = "\"" + key + "\"";
    size_t pos = obj.find(quoted);
    if (pos == std::string::npos) return "";
    pos = obj.find(':', pos);
    if (pos == std::string::npos) return "";
    pos = obj.find('"', pos);
    if (pos == std::string::npos) return "";
    pos++;
    size_t end = obj.find('"', pos);
    if (end == std::string::npos) return "";
    return obj.substr(pos, end - pos);
}

// Extracts a numeric value for a quoted key, e.g. "lat" : 19.0760.
double extract_number_field(const std::string& obj, const std::string& key) {
    std::string quoted = "\"" + key + "\"";
    size_t pos = obj.find(quoted);
    if (pos == std::string::npos) return 0.0;
    pos = obj.find(':', pos);
    if (pos == std::string::npos) return 0.0;
    pos++;
    while (pos < obj.size() && (obj[pos] == ' ' || obj[pos] == '\t')) pos++;
    const char* begin = obj.c_str() + pos;
    char* end = nullptr;
    double val = std::strtod(begin, &end);
    return end == begin ? 0.0 : val;
}

// Parses {"locations": [{"id","lat","lng"}, ...]} into Location records.
std::vector<Location> parse_locations(const std::string& body) {
    std::vector<Location> locs;
    size_t array = body.find('[');
    if (array == std::string::npos) return locs;

    size_t pos = array;
    while (true) {
        size_t open = body.find('{', pos);
        size_t close = open == std::string::npos ? std::string::npos : body.find('}', open);
        if (open == std::string::npos || close == std::string::npos) break;

        std::string obj = body.substr(open, close - open + 1);
        Location loc;
        loc.id = extract_string_field(obj, "id");
        loc.lat = extract_number_field(obj, "lat");
        loc.lng = extract_number_field(obj, "lng");
        locs.push_back(loc);

        pos = close + 1;
    }
    return locs;
}

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
        std::vector<Location> locs = parse_locations(body);
        if (locs.empty()) {
            response = build_response("{\"success\":false,\"error\":\"no locations provided\"}", "400 Bad Request");
        } else {
            response = build_response(compute_matrix_json(locs), "200 OK");
        }
    } else {
        response = build_response("{\"error\":\"not found\"}", "404 Not Found");
    }

    send(client, response.c_str(), static_cast<int>(response.size()), 0);
}

int main() {
    std::cout << "🚀 Truxify C++ High-Speed Matrix Engine starting..." << std::endl;

    // Startup self-test with the sample city set.
    std::vector<Location> sample = {
        {"Mumbai", 19.0760, 72.8777},
        {"Delhi", 28.7041, 77.1025},
        {"Bangalore", 12.9716, 77.5946},
        {"Chennai", 13.0827, 80.2707},
        {"Kolkata", 22.5726, 88.3639}
    };
    std::string sample_out = compute_matrix_json(sample);
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
