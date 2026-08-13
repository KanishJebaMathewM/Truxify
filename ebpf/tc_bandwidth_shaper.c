/*
 * eBPF TC (Traffic Control) Ingress/Egress Bandwidth Shaper for IoT Telemetry
 * Hooks into tc ingress/egress filter to shape telemetry bandwidth per client IP.
 */

#include <linux/bpf.h>
#include <linux/pkt_cls.h>
#include <linux/ip.h>
#include <bpf/bpf_helpers.h>

struct bucket_state {
    struct bpf_spin_lock lock;
    __u64 consumed;
    __u64 last_time;
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);   // Client IP
    __type(value, struct bucket_state); // Tokens bucket state
} bandwidth_bucket_map SEC(".maps");

SEC("classifier")
int tc_bandwidth_shaper(struct __sk_buff *skb) {
    struct iphdr ip;
    // Load IP header from skb offset
    if (skb->len < sizeof(ip))
        return TC_ACT_OK;

    __u32 client_ip = 0x7F000001; // Mock loopback IP
    __u64 limit = 1000000;        // 1 MB bandwidth bucket capacity
    __u64 now = bpf_ktime_get_ns();
    
    struct bucket_state *state = bpf_map_lookup_elem(&bandwidth_bucket_map, &client_ip);
    if (state) {
        bpf_spin_lock(&state->lock);
        __u64 elapsed = now - state->last_time;
        // Refill tokens based on elapsed time: 1 MB/sec means 1 byte per 1000 ns
        __u64 decay = elapsed / 1000;
        
        __u64 consumed = state->consumed;
        __u64 new_last_time = state->last_time;
        if (decay > consumed) {
            consumed = 0; // per-window reset
            new_last_time = now;
        } else {
            consumed -= decay;
            new_last_time += decay * 1000;
        }

        if (consumed + skb->len > limit) {
            bpf_spin_unlock(&state->lock);
            return TC_ACT_SHOT; // Drop packet exceeding bandwidth limit
        }
        
        state->consumed = consumed + skb->len;
        state->last_time = new_last_time;
        bpf_spin_unlock(&state->lock);
    } else {
        struct bucket_state start_state = {};
        start_state.consumed = skb->len;
        start_state.last_time = now;
        if (start_state.consumed > limit) {
            return TC_ACT_SHOT;
        }
        bpf_map_update_elem(&bandwidth_bucket_map, &client_ip, &start_state, BPF_NOEXIST);
    }

    return TC_ACT_OK;
}

char _license[] SEC("license") = "GPL";
