// eBPF program for network monitoring
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

// Map for network statistics
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // port
    __type(value, __u64);    // bytes
} network_stats SEC(".maps");

// Map for connection tracking
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // connection ID
    __type(value, __u64);    // timestamp
} connections SEC(".maps");

// Map for rate limiting
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // IP
    __type(value, __u64);    // count
} rate_limit SEC(".maps");

// Tracepoint for TCP connect
SEC("tracepoint/tcp/tcp_connect")
int trace_tcp_connect(struct trace_event_raw_tcp_connect *args)
{
    __u32 sport = args->sport;
    __u32 dport = args->dport;
    
    // Update network stats
    __u32 key = sport;
    __u64 *value = bpf_map_lookup_elem(&network_stats, &key);
    
    if (value) {
        (*value)++;
    } else {
        __u64 init_val = 1;
        bpf_map_update_elem(&network_stats, &key, &init_val, BPF_ANY);
    }
    
    // Track connection
    __u32 conn_key = sport ^ dport;
    __u64 timestamp = bpf_ktime_get_ns();
    bpf_map_update_elem(&connections, &conn_key, &timestamp, BPF_ANY);
    
    // Rate limiting check
    __u32 ip_key = args->saddr;
    __u64 *count = bpf_map_lookup_elem(&rate_limit, &ip_key);
    
    if (count) {
        if (*count > 100) {
            bpf_printk("Rate limit exceeded for IP\n");
        }
        (*count)++;
    } else {
        __u64 init_val = 1;
        bpf_map_update_elem(&rate_limit, &ip_key, &init_val, BPF_ANY);
    }
    
    return 0;
}

// Tracepoint for UDP send
SEC("tracepoint/udp/udp_sendmsg")
int trace_udp_send(struct trace_event_raw_udp_sendmsg *args)
{
    __u32 sport = args->sport;
    __u32 dport = args->dport;
    __u64 len = args->len;
    
    // Update network stats
    __u32 key = sport;
    __u64 *value = bpf_map_lookup_elem(&network_stats, &key);
    
    if (value) {
        (*value) += len;
    } else {
        __u64 init_val = len;
        bpf_map_update_elem(&network_stats, &key, &init_val, BPF_ANY);
    }
    
    return 0;
}