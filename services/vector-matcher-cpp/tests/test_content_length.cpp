#include "../include/http_parse.hpp"
#include <cassert>
#include <cstddef>
#include <string>

int main() {
    // Overflowing Content-Length must NOT desync body parsing: the body is
    // left empty (not garbage bytes) and the request is treated as malformed.
    std::string overflow =
        "POST /search HTTP/1.1\r\nHost: x\r\nContent-Length: 18446744073709551615\r\n\r\n{\"query\":[0.1]}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(overflow, cl, start, len);
        assert(!ok);
        std::string method, path, body;
        parse_request(overflow, method, path, body);
        assert(body.empty());
    }

    // A well-formed request with a small body parses normally.
    std::string normal = "POST /search HTTP/1.1\r\nContent-Length: 12\r\n\r\n{\"query\":[0]}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(normal, cl, start, len);
        assert(ok);
        assert(cl == 12);
        assert(len == 12);
        std::string method, path, body;
        parse_request(normal, method, path, body);
        assert(body == "{\"query\":[0]}");
    }

    // Content-Length larger than the actual buffered body is rejected, not
    // silently satisfied by the wrapping guard.
    std::string short_body = "POST /s HTTP/1.1\r\nContent-Length: 100\r\n\r\n{\"q\":1}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(short_body, cl, start, len);
        assert(!ok);
    }

    std::cout << "✅ Vector-matcher Content-Length overflow regression test passed." << std::endl;
    return 0;
}
