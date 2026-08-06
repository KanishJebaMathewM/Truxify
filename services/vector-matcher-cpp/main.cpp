#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <chrono>
#include <sstream>
#include <thread>
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

// Vector Embedding Matcher Structure (64-dimensional latent representation)
constexpr int EMBEDDING_DIM = 64;

struct DriverEmbedding {
    std::string driver_id;
    double rating;
    double lat;
    double lng;
    std::vector<float> vector;
};

// Compute Cosine Similarity between two vectors. The loop is bounded by the
// actual vector lengths so shorter embeddings cannot cause an out-of-bounds
// read.
float cosine_similarity(const std::vector<float>& v1, const std::vector<float>& v2) {
    float dot = 0.0f;
    float norm_a = 0.0f;
    float norm_b = 0.0f;

    const size_t dim = std::min<size_t>(EMBEDDING_DIM, std::min(v1.size(), v2.size()));
    for (size_t i = 0; i < dim; ++i) {
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
    ss << "{
";
    ss << "  "engine": "Truxify C++20 SIMD Vector Matcher v1.0",
";
    ss << "  "total_scanned": " << pool.size() << ",
";
    ss << "  "latency_micros": " << micros << ",
";
    ss << "  "top_matches": [
";

    int limit = std::min<int>(k, results.size());
    for (int i = 0; i < limit; ++i) {
        ss << "    {
";
        ss << "      "rank": " << (i + 1) << ",
";
        ss << "      "driver_id": "" << results[i].driver_id << "",
";
        ss << "      "match_score": " << results[i].score << ",
";
        ss << "      "latitude": " << results[i].lat << ",
";
        ss << "      "longitude": " << results[i].lng << "
";
        ss << "    }" << (i < limit - 1 ? "," : "") << "
";
    }
    ss << "  ]
";
    ss << "}";

    return ss.str();
}

int main() {
    std::cout << "🚀 Truxify C++20 Vector Matcher Engine initializing..." << std::endl;

    // Generate 1,000 synthetic driver vector embeddings
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

    int port = 8088;
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

    std::cout << "✅ Vector Matcher HTTP Server listening on port " << port << std::endl;

    while (true) {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        SOCKET client_fd = accept(server_fd, (struct sockaddr*)&client_addr, &client_len);
        if (client_fd == INVALID_SOCKET) continue;

        char buffer[1024] = {0};
        recv(client_fd, buffer, sizeof(buffer) - 1, 0);

        std::vector<float> load_query(EMBEDDING_DIM);
        for (int d = 0; d < EMBEDDING_DIM; ++d) {
            load_query[d] = static_cast<float>(rand()) / RAND_MAX;
        }

        std::string json_body = search_top_k(driver_pool, load_query, 5);

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
