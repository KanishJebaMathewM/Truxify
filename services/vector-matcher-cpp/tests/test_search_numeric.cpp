// Exercise the same functions and HTTP handler as the server executable.
#define main truxify_server_main
#include "../main.cpp"
#undef main
#include <limits>

static int failures = 0;
static void check(bool condition, const char* message) {
    if (!condition) { std::cerr << "FAIL: " << message << '\n'; ++failures; }
}

#ifndef _WIN32
static std::string request_search(const std::string& component) {
    std::string body = "{\"query\":[";
    for (int i = 0; i < EMBEDDING_DIM; ++i) {
        if (i) body += ',';
        body += component;
    }
    body += "],\"k\":1}";
    std::string request = "POST /search HTTP/1.1\r\nHost: local\r\nContent-Length: " +
        std::to_string(body.size()) + "\r\n\r\n" + body;
    int sockets[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, sockets) != 0) {
        check(false, "local socketpair creation");
        return {};
    }
    send(sockets[0], request.data(), request.size(), 0);
    std::vector<DriverEmbedding> pool{{"driver", 4.8, 0, 0, std::vector<float>(EMBEDDING_DIM, 1e30f)}};
    handle_client(sockets[1], pool);
    char buffer[8192];
    auto size = recv(sockets[0], buffer, sizeof(buffer), 0);
    close(sockets[0]);
    close(sockets[1]);
    return size > 0 ? std::string(buffer, static_cast<size_t>(size)) : std::string{};
}
#endif

int main() {
    for (float value : {1e30f, std::numeric_limits<float>::max(), 1e-30f, std::numeric_limits<float>::denorm_min()}) {
        std::vector<float> vector(EMBEDDING_DIM, value);
        float score = cosine_similarity(vector, vector);
        check(std::isfinite(score) && std::abs(score - 1.0f) < 1e-6f,
              "identical finite vectors remain similar across float range");
    }
    std::vector<float> large(EMBEDDING_DIM, 1e30f);
    std::vector<float> opposite(EMBEDDING_DIM, -1e30f);
    check(std::abs(cosine_similarity(large, opposite) + 1.0f) < 1e-6f, "opposite large vectors score -1");
    check(cosine_similarity(large, std::vector<float>(EMBEDDING_DIM, 0)) == 0, "zero-vector behavior retained");
    auto invalid = large;
    invalid[0] = std::numeric_limits<float>::infinity();
    check(cosine_similarity(large, invalid) == 0, "nonfinite vector is not scored");
    check(cosine_similarity(large, std::vector<float>(1, 1)) == 0, "short vectors cannot cause out-of-bounds reads");
    std::vector<DriverEmbedding> pool{{"driver", 4.8, 0, 0, large}};
    auto json = search_top_k(pool, large, 1);
    check(json.find("nan") == std::string::npos && json.find("inf") == std::string::npos, "ranking output contains finite JSON numbers");
#ifndef _WIN32
    for (const auto& value : {"1e39", "1e309"}) {
        auto response = request_search(value);
        check(response.find("HTTP/1.1 400 Bad Request") == 0, "overflowing query component rejected by actual HTTP handler");
    }
    auto response = request_search("1e30");
    check(response.find("HTTP/1.1 200 OK") == 0 && response.find("nan") == std::string::npos,
          "large finite query succeeds with valid numeric scores");
#endif
    if (failures) return 1;
    std::cout << "search numeric regressions passed\n";
    return 0;
}
