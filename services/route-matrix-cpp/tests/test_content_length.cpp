#include "../include/http_parse.hpp"
#include <cassert>
#include <cstddef>
#include <string>

int main() {
    // Overflowing Content-Length must NOT desync body parsing: the body is
    // left empty (not garbage bytes) and the request is treated as malformed.
    std::string overflow =
        "POST /matrix HTTP/1.1\r\nHost: x\r\nContent-Length: 18446744073709551615\r\n\r\n{\"x\":1}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(overflow, cl, start, len);
        assert(!ok);
        std::string method, path, body;
        parse_request(overflow, method, path, body);
        assert(body.empty());
    }

    // A well-formed request with a small body parses normally.
    std::string normal = "POST /matrix HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(normal, cl, start, len);
        assert(ok);
        assert(cl == 2);
        assert(len == 2);
        std::string method, path, body;
        parse_request(normal, method, path, body);
        assert(body == "{}");
    }

    // Content-Length larger than the actual buffered body is rejected, not
    // silently satisfied by the wrapping guard.
    std::string short_body = "POST /m HTTP/1.1\r\nContent-Length: 100\r\n\r\n{}";
    {
        size_t cl = 0, start = 0, len = 0;
        bool ok = compute_body_range(short_body, cl, start, len);
        assert(!ok);
    }

    std::cout << "✅ Content-Length overflow regression test passed." << std::endl;
    return 0;
}
