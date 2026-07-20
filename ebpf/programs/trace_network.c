// eBPF program for network tracing
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

// Tracepoint for TCP connections
SEC("tracepoint/tcp/tcp_connect")
int trace_tcp_connect(struct trace_event_raw_tcp_connect *args)
{
    __u32 sport = args->sport;
    __u32 dport = args->dport;
    
    bpf_printk("TCP Connect: sport=%d, dport=%d\n", sport, dport);
    
    return 0;
}

// Tracepoint for UDP traffic
SEC("tracepoint/udp/udp_sendmsg")
int trace_udp_send(struct trace_event_raw_udp_sendmsg *args)
{
    __u32 sport = args->sport;
    __u32 dport = args->dport;
    __u64 len = args->len;
    
    bpf_printk("UDP Send: sport=%d, dport=%d, len=%llu\n", sport, dport, len);
    
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