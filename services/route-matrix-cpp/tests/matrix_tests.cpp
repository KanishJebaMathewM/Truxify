#include "../include/matrix_http.hpp"
#include <cstdio>
#include <limits>
#include <string>
#include <vector>

using namespace TruxifyMatrix;

static int failures = 0;

static void check(bool cond, const char* what) {
    if (!cond) {
        std::printf("FAIL: %s\n", what);
        failures++;
    }
}

static std::string loc_json(size_t i) {
    return "{\"id\":\"L" + std::to_string(i) + "\",\"lat\":19.0,\"lng\":72.8}";
}

int main() {
    // 1. Normal parse.
    {
        ParseLocationsResult r =
            parse_locations("{\"locations\":[" + loc_json(0) + "," + loc_json(1) + "]}");
        check(r.locs.size() == 2 && !r.limit_hit, "parses two locations");
        check(r.locs[0].id == "L0" && r.locs[1].id == "L1", "parses location ids");
    }

    // 2. Empty body.
    {
        ParseLocationsResult r = parse_locations("{}");
        check(r.locs.empty() && !r.limit_hit, "empty body parses to zero locations");
    }

    // 3. Over-cap body: flagged as limit_hit, never fully parsed.
    {
        std::string body = "{\"locations\":[";
        for (size_t i = 0; i <= MAX_LOCATIONS; ++i) {
            if (i > 0) body += ",";
            body += loc_json(i);
        }
        body += "]}";
        ParseLocationsResult r = parse_locations(body);
        check(r.limit_hit, "over-cap body sets limit_hit");
        check(r.locs.size() <= MAX_LOCATIONS, "over-cap body is not fully parsed");
    }

    // 4. matrix_cell_count.
    {
        check(matrix_cell_count(3) == 9, "matrix_cell_count computes n^2");
        check(matrix_cell_count(1000) == MAX_MATRIX_CELLS, "1000 locations reach the cell budget");
        check(matrix_cell_count(std::numeric_limits<size_t>::max()) ==
                  std::numeric_limits<size_t>::max(),
              "matrix_cell_count guards overflow");
    }

    // 5. Decision logic: clean 413 for over-cap input (no crash, single status).
    {
        ParseLocationsResult r;
        r.limit_hit = true;
        MatrixHttpDecision d = decide_matrix_request(r);
        check(!d.ok && d.status_line == "413 Payload Too Large", "limit hit -> 413");

        ParseLocationsResult over;
        over.locs.resize(MAX_LOCATIONS + 1);
        d = decide_matrix_request(over);
        check(!d.ok && d.status_line == "413 Payload Too Large", "too many locations -> 413");
    }

    // 6. Decision logic: 400 for no locations, ok for a valid request.
    {
        MatrixHttpDecision d = decide_matrix_request(ParseLocationsResult{});
        check(!d.ok && d.status_line == "400 Bad Request", "no locations -> 400");

        ParseLocationsResult ok;
        ok.locs.push_back(Location{"A", 19.0, 72.8});
        ok.locs.push_back(Location{"B", 20.0, 73.0});
        d = decide_matrix_request(ok);
        check(d.ok && d.status_line.empty(), "valid request accepted");
    }

    // 7. compute_matrix_json builds a well-formed 2x2 response.
    {
        std::vector<Location> locs = {{"A", 19.0, 72.8}, {"B", 20.0, 73.0}};
        std::string json = compute_matrix_json(locs);
        size_t originCount = 0, at = 0;
        while ((at = json.find("\"origin\"", at)) != std::string::npos) {
            originCount++;
            at += 8;
        }
        check(json.find("\"success\": true") != std::string::npos, "matrix json has success flag");
        check(originCount == 4, "2x2 matrix emits 4 cells");
    }

    if (failures == 0) {
        std::printf("ALL TESTS PASSED\n");
        return 0;
    }
    std::printf("%d TEST(S) FAILED\n", failures);
    return 1;
}
