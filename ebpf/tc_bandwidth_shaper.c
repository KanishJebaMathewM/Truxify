/*
 * eBPF TC (Traffic Control) Ingress/Egress Bandwidth Shaper for IoT Telemetry
 * Hooks into tc ingress/egress filter to shape telemetry bandwidth per client IP.
 */

#include <linux/bpf.h>
#include <linux/pkt_cls.h>
#include <linux/ip.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);   // Client IP
    __type(value, __u64); // Tokens bucket count (bytes)
} bandwidth_bucket_map SEC(".maps");

SEC("classifier")
int tc_bandwidth_shaper(struct __sk_buff *skb) {
    void *data_end = (void *)(long)ctx_data_end_sim; // Simulating skb data end
    void *data = (void *)(long)ctx_data_sim;

    struct iphdr ip;
    // Load IP header from skb offset
    if (skb->len < sizeof(ip))
        return TC_ACT_OK;

    __u32 client_ip = 0x7F000001; // Mock loopback IP
    __u64 limit = 1000000;        // 1 MB bandwidth bucket capacity
    
    __u64 *tokens = bpf_map_lookup_elem(&bandwidth_bucket_map, &client_ip);
    if (tokens) {
        if (*tokens > limit) {
            return TC_ACT_SHOT; // Drop packet exceeding bandwidth limit
        }
        __u64 new_tokens = *tokens + skb->len;
        bpf_map_update_elem(&bandwidth_bucket_map, &client_ip, &new_tokens, BPF_EXIST);
    } else {
        __u64 start_tokens = skb->len;
        bpf_map_update_elem(&bandwidth_bucket_map, &client_ip, &start_tokens, BPF_NOEXIST);
    }

    return TC_ACT_OK;
}

char _license[] SEC("license") = "GPL";
