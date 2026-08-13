#ifndef MATRIX_HTTP_HPP
#define MATRIX_HTTP_HPP

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace TruxifyMatrix {

struct Location {
    std::string id;
    double lat;
    double lng;
};

// Hard cap on the number of locations accepted by /matrix, and the matching
// matrix-cell budget (N^2). Requests exceeding either are rejected with 413
// before any matrix data is built.
constexpr size_t MAX_LOCATIONS = 1000;
constexpr size_t MAX_MATRIX_CELLS = 1000u * 1000u;

// Haversine distance in km between two lat/lng points.
double haversine_km(double lat1, double lon1, double lat2, double lon2);

// Total matrix cells for n locations (n^2), guarded against size_t overflow.
size_t matrix_cell_count(size_t n);

// Builds the full NxN matrix JSON response (used by the startup self-test;
// the live /matrix handler streams rows instead of materializing this).
std::string compute_matrix_json(const std::vector<Location>& locs);

// Result of parsing a /matrix request body.
struct ParseLocationsResult {
    std::vector<Location> locs;
    bool limit_hit = false; // true when the body contained more objects past the cap
};

ParseLocationsResult parse_locations(const std::string& body);

// Pure decision logic for /matrix requests, unit-testable without sockets.
struct MatrixHttpDecision {
    bool ok = false;
    std::string status_line; // e.g. "413 Payload Too Large" when !ok
    std::string error_body;  // JSON error payload when !ok
};

MatrixHttpDecision decide_matrix_request(const ParseLocationsResult& parsed);

// ---- Implementation (header-only for this small service) ----

inline double haversine_km(double lat1, double lon1, double lat2, double lon2) {
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

inline size_t matrix_cell_count(size_t n) {
    if (n > std::numeric_limits<size_t>::max() / n) {
        return std::numeric_limits<size_t>::max();
    }
    return n * n;
}

inline std::string compute_matrix_json(const std::vector<Location>& locs) {
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

// Extracts a quoted string value for a quoted key, e.g. "id" : "A".
inline std::string extract_string_field(const std::string& obj, const std::string& key) {
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
inline double extract_number_field(const std::string& obj, const std::string& key) {
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

inline ParseLocationsResult parse_locations(const std::string& body) {
    ParseLocationsResult result;
    size_t array = body.find('[');
    if (array == std::string::npos) return result;

    size_t pos = array;
    while (true) {
        size_t open = body.find('{', pos);
        size_t close = open == std::string::npos ? std::string::npos : body.find('}', open);
        if (open == std::string::npos || close == std::string::npos) break;

        // Stop parsing once the cap is hit; record that the body wanted more.
        if (result.locs.size() >= MAX_LOCATIONS) {
            result.limit_hit = true;
            break;
        }

        std::string obj = body.substr(open, close - open + 1);
        Location loc;
        loc.id = extract_string_field(obj, "id");
        loc.lat = extract_number_field(obj, "lat");
        loc.lng = extract_number_field(obj, "lng");
        result.locs.push_back(loc);

        pos = close + 1;
    }
    return result;
}

inline MatrixHttpDecision decide_matrix_request(const ParseLocationsResult& parsed) {
    // Location count exceeds the hard cap (or the body kept providing more):
    // reject with 413 before building anything.
    if (parsed.limit_hit || parsed.locs.size() > MAX_LOCATIONS) {
        return {false, "413 Payload Too Large",
                "{\"success\":false,\"error\":\"too many locations\"}"};
    }
    if (parsed.locs.empty()) {
        return {false, "400 Bad Request",
                "{\"success\":false,\"error\":\"no locations provided\"}"};
    }
    // Matrix-cell budget: N^2 cells would exceed the cap.
    if (matrix_cell_count(parsed.locs.size()) > MAX_MATRIX_CELLS) {
        return {false, "413 Payload Too Large",
                "{\"success\":false,\"error\":\"matrix cell budget exceeded\"}"};
    }
    return {true, "", ""};
}

} // namespace TruxifyMatrix

#endif // MATRIX_HTTP_HPP
