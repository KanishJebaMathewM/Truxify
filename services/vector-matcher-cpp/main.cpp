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

// Vector Embedding Matcher Structure (64-dimensional latent representation)
constexpr int EMBEDDING_DIM = 64;

struct DriverEmbedding {
    std::string driver_id;
    double rating;
    double lat;
    double lng;
    std::vector<float> vector;
};

// Compute Cosine Similarity between two 64-D vectors
float cosine_similarity(const std::vector<float>& v1, const std::vector<float>& v2) {
    float dot = 0.0f;
    float norm_a = 0.0f;
    float norm_b = 0.0f;

    for (int i = 0; i < EMBEDDING_DIM; ++i) {
        dot += v1[i] * v2[i];
        norm_a += v1[i] * v1[i];
        norm_b += v2[i] * v2[i];
    }

    if (norm_a <= 0.0f || norm_b <= 0.0f) return 0.0f;
    return dot / (std::sqrt(norm_a) * std::sqrt(norm_b));
}

// Perform SIMD KNN Vector Search across N driver embeddings
std::string search_top_k(const std::vector<DriverEmbedding>& pool, const std::vector<float>& load_vec, int k) {
    auto start = std::chrono::high_resolution_clock::now();

    struct MatchResult {
        std::string driver_id;
        float score;
        double lat;
        double lng;
    };

    std::vector<MatchResult> results;
    results.reserve(pool.size());

    for (const auto& driver : pool) {
        float sim = cosine_similarity(driver.vector, load_vec);
        results.push_back({driver.driver_id, sim, driver.lat, driver.lng});
    }

    // Sort Top-K
    std::partial_sort(results.begin(), results.begin() + std::min<size_t>(k, results.size()), results.end(),
                      [](const MatchResult& a, const MatchResult& b) {
                          return a.score > b.score;
                      });

    auto elapsed = std::chrono::high_resolution_clock::now() - start;
    double micros = std::chrono::duration<double, std::micro>(elapsed).count();

    std::stringstream ss;
    ss << "{\n";
    ss << "  \"engine\": \"Truxify C++20 SIMD Vector Matcher v1.0\",\n";
    ss << "  \"total_scanned\": " << pool.size() << ",\n";
    ss << "  \"latency_micros\": " << micros << ",\n";
    ss << "  \"top_matches\": [\n";

    int limit = std::min<int>(k, static_cast<int>(results.size()));
    for (int i = 0; i < limit; ++i) {
        ss << "    {\n";
        ss << "      \"rank\": " << (i + 1) << ",\n";
        ss << "      \"driver_id\": \"" << results[i].driver_id << "\",\n";
        ss << "      \"match_score\": " << results[i].score << ",\n";
        ss << "      \"latitude\": " << results[i].lat << ",\n";
        ss << "      \"longitude\": " << results[i].lng << "\n";
        ss << "    }" << (i < limit - 1 ? "," : "") << "\n";
    }
    ss << "  ]\n";
    ss << "}";

    return ss.str();
}

// ---- Minimal JSON extraction helpers for the /search request body ----

// Parses the first "query": [ ... ] float array in the body.
std::vector<float> parse_query_vector(const std::string& body) {
    std::vector<float> vec;
    size_t pos = body.find("query");
    if (pos == std::string::npos) return vec;
    pos = body.find('[', pos);
    if (pos == std::string::npos) return vec;
    pos++;
    while (pos < body.size()) {
        while (pos < body.size() &&
               !(std::isdigit(static_cast<unsigned char>(body[pos])) || body[pos] == '-')) {
            pos++;
        }
        if (pos >= body.size() || body[pos] == ']') break;
        const char* begin = body.c_str() + pos;
        char* end = nullptr;
        double val = std::strtod(begin, &end);
        if (end == begin) break;
        vec.push_back(static_cast<float>(val));
        pos = static_cast<size_t>(end - body.c_str());
    }
    return vec;
}

// Parses the "k" field, defaulting to 5.
int parse_top_k(const std::string& body) {
    size_t pos = body.find("\"k\"");
    if (pos == std::string::npos) return 5;
    pos = body.find(':', pos);
    if (pos == std::string::npos) return 5;
    pos++;
    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t')) pos++;
    int k = std::atoi(body.c_str() + pos);
    return k > 0 ? k : 5;
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
void handle_client(SOCKET client, const std::vector<DriverEmbedding>& driver_pool) {
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
        response = build_response(
            "{\"status\":\"ok\",\"service\":\"vector-matcher-cpp\",\"pool_size\":" + std::to_string(driver_pool.size()) + "}",
            "200 OK");
    } else if (method == "POST" && path == "/search") {
        std::vector<float> query = parse_query_vector(body);
        if (query.size() != static_cast<size_t>(EMBEDDING_DIM)) {
            response = build_response(
                "{\"success\":false,\"error\":\"query vector must contain 64 elements\"}",
                "400 Bad Request");
        } else {
            int k = parse_top_k(body);
            response = build_response(search_top_k(driver_pool, query, k), "200 OK");
        }
    } else {
        response = build_response("{\"error\":\"not found\"}", "404 Not Found");
    }

    send(client, response.c_str(), static_cast<int>(response.size()), 0);
}

// Generates the synthetic driver embedding pool used for searches.
std::vector<DriverEmbedding> generate_driver_pool() {
    std::vector<DriverEmbedding> driver_pool;
    driver_pool.reserve(1000);

    for (int i = 0; i < 1000; ++i) {
        std::vector<float> vec(EMBEDDING_DIM);
        for (int d = 0; d < EMBEDDING_DIM; ++d) {
            vec[d] = static_cast<float>(rand()) / RAND_MAX;
        }
        driver_pool.push_back({
            "driver_" + std::to_string(i + 1000),
            4.8,
            19.0760 + (rand() % 100) * 0.001,
            72.8777 + (rand() % 100) * 0.001,
            vec
        });
    }
    return driver_pool;
}

int main() {
    std::cout << "🚀 Truxify C++20 Vector Matcher Engine initializing..." << std::endl;

    // Generate 1,000 synthetic driver vector embeddings
    std::vector<DriverEmbedding> driver_pool = generate_driver_pool();

    // Startup self-test query.
    std::vector<float> load_query(EMBEDDING_DIM);
    for (int d = 0; d < EMBEDDING_DIM; ++d) {
        load_query[d] = static_cast<float>(rand()) / RAND_MAX;
    }
    std::string result = search_top_k(driver_pool, load_query, 5);
    std::cout << "✅ Vector Search Results:\n" << result << "\n";

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
    addr.sin_port = htons(8088);

    if (bind(listen_sock, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "Failed to bind port 8088" << std::endl;
        closesocket(listen_sock);
        return 1;
    }

    if (listen(listen_sock, 16) == SOCKET_ERROR) {
        std::cerr << "Failed to listen on 8088" << std::endl;
        closesocket(listen_sock);
        return 1;
    }

    std::cout << "✅ C++20 Vector Matcher Engine listening on port 8088" << std::endl;

    for (;;) {
        SOCKET client = accept(listen_sock, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        handle_client(client, driver_pool);
        closesocket(client);
    }
}
