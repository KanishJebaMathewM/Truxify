#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <chrono>
#include <sstream>
#include <thread>
#include <algorithm>

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

    int limit = std::min<int>(k, results.size());
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

    // Query Vector
    std::vector<float> load_query(EMBEDDING_DIM);
    for (int d = 0; d < EMBEDDING_DIM; ++d) {
        load_query[d] = static_cast<float>(rand()) / RAND_MAX;
    }

    std::string result = search_top_k(driver_pool, load_query, 5);
    std::cout << "✅ Vector Search Results:\n" << result << "\n";
    std::cout << "C++20 Vector Matcher Engine ready." << std::endl;

    return 0;
}
