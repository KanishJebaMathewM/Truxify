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

// Rate limiting — keyed on the REMOTE destination (daddr + dport), not the
// local source address, so each outbound destination is counted against
// itself. LRU_HASH bounds memory. Counters are windowed: an entry whose
// window (RATE_LIMIT_WINDOW_NS) has elapsed is reset to 1 instead of growing
// a monotonic counter forever, so the value reflects a real rate.
#define MAX_CONNS_PER_WINDOW 100
#define RATE_LIMIT_WINDOW_NS 60000000000ULL  // 60 seconds

struct rate_key {
    __u32 daddr;
    __u16 dport;
};

struct rate_entry {
    __u32 lock;
    __u64 last_seen;  // ns timestamp of the first connection in the window
    __u64 count;      // connections observed in the current window
};

struct drop_event {
    __u32 daddr;
    __u16 dport;
    __u64 ts;
};

struct {
    __uint(type, BPF_MAP_TYPE_LRU_HASH);
    __uint(max_entries, 1024);
    __type(key, struct rate_key);
    __type(value, struct rate_entry);
} rate_limit SEC(".maps");

// Enforcement channel: this program is a tracepoint (passive) so it cannot
// return TC_ACT_SHOT / XDP_DROP. When a daddr:dport exceeds its window
// budget, a drop_event is emitted so userspace can install a firewall rule
// (or otherwise block the offending destination).
struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024);
} rate_events SEC(".maps");

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
    
    // Rate limiting check, keyed on the remote destination (daddr + dport).
    // Zero the key so struct padding does not corrupt map lookups.
    struct rate_key rk = {};
    rk.daddr = args->daddr;
    rk.dport = (__u16)dport;
    __u64 now = bpf_ktime_get_ns();

    struct rate_entry *entry = bpf_map_lookup_elem(&rate_limit, &rk);
    if (entry) {
        // Guard the read-modify-write on the shared map value so concurrent
        // connects on different CPUs cannot both pass the threshold check.
        bpf_spin_lock(&entry->lock);
        if (now - entry->last_seen < RATE_LIMIT_WINDOW_NS) {
            if (entry->count >= MAX_CONNS_PER_WINDOW) {
                // Enforce: alert userspace with the offending daddr:dport so
                // a firewall rule can be installed for the destination.
                struct drop_event ev = {
                    .daddr = rk.daddr,
                    .dport = rk.dport,
                    .ts = now,
                };
                bpf_ringbuf_output(&rate_events, &ev, sizeof(ev), 0);
                bpf_printk("Rate limit exceeded for daddr:%u dport:%u\n", rk.daddr, rk.dport);
                bpf_spin_unlock(&entry->lock);
                return 0;
            }
            entry->count++;
        } else {
            // Window elapsed: reset instead of growing the counter unbounded.
            entry->last_seen = now;
            entry->count = 1;
        }
        bpf_spin_unlock(&entry->lock);
    } else {
        struct rate_entry new_entry = {
            .lock = 0,
            .last_seen = now,
            .count = 1,
        };
        bpf_map_update_elem(&rate_limit, &rk, &new_entry, BPF_ANY);
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