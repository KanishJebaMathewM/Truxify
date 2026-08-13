/*
 * eBPF SOCKMAP Zero-Copy Proxy for Internal Microservice Routing
 * Redirects TCP payload packets directly between sockets in kernel space.
 */

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_SOCKMAP);
    __uint(max_entries, 2);
    __type(key, __u32);
    __type(value, __u32);
} sock_map SEC(".maps");

SEC("sk_msg")
int sockmap_proxy_redirection(struct sk_msg_md *msg) {
    __u32 key = 0; // Ingress mapping key
    
    // Redirect TCP payload stream directly to the target socket in kernel space
    // bypassing user-space copy operations
    bpf_msg_redirect_map(msg, &sock_map, &key, 0);
    return SK_PASS;
}

char _license[] SEC("license") = "GPL";
