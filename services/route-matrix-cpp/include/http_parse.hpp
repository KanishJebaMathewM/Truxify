#ifndef HTTP_PARSE_HPP
#define HTTP_PARSE_HPP

#include <string>
#include <sstream>
#include <cstdlib>
#include <cctype>
#include <cstddef>

// Total request byte budget per connection. Oversized requests are answered
// with 413 instead of being buffered, bounding memory per connection.
constexpr size_t MAX_REQUEST_BYTES = 64 * 1024;

// Returns the body Content-Length from the request head, or 0.
inline size_t parse_content_length(const std::string& request) {
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

// Computes the body byte range for an HTTP/1.1 request using checked,
// non-wrapping arithmetic. Returns true and fills body_start/body_len only
// when the declared Content-Length is within budget AND the full body is
// present in `request`. Otherwise returns false so the caller can treat the
// request as malformed (400) instead of desyncing on an overflowing
// Content-Length (e.g. strtoul(SIZE_MAX) where body_start + content_length
// would wrap modulo 2^64).
inline bool compute_body_range(const std::string& request,
                                size_t& content_length,
                                size_t& body_start,
                                size_t& body_len) {
    size_t header_end = request.find("\r\n\r\n");
    if (header_end == std::string::npos) return false;

    content_length = parse_content_length(request);
    if (content_length > MAX_REQUEST_BYTES) {
        content_length = MAX_REQUEST_BYTES;
    }

    body_start = header_end + 4;
    // Checked subtraction: body_start <= request.size() - content_length is
    // equivalent to body_start + content_length <= request.size() but cannot
    // wrap. Also require content_length <= request.size() so the subtraction
    // itself is safe.
    if (content_length <= request.size() &&
        body_start <= request.size() - content_length) {
        body_len = content_length;
        return true;
    }
    return false;
}

// Splits a request into method, path, and (read) body. When the Content-Length
// is malformed/overflowing, body is left empty rather than desynchronized.
inline void parse_request(const std::string& request,
                           std::string& method,
                           std::string& path,
                           std::string& body) {
    size_t line_end = request.find("\r\n");
    std::string head = request.substr(0, line_end);
    std::istringstream iss(head);
    iss >> method >> path;

    size_t content_length = 0;
    size_t body_start = 0;
    size_t body_len = 0;
    if (compute_body_range(request, content_length, body_start, body_len)) {
        body = request.substr(body_start, body_len);
    }
}

#endif // HTTP_PARSE_HPP
