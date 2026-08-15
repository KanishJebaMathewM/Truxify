/*
 * eBPF TC (Traffic Control) Ingress/Egress Bandwidth Shaper for IoT Telemetry
 * Hooks into tc ingress/egress filter to shape telemetry bandwidth per client IP.
 */

#include <linux/bpf.h>
#include <linux/pkt_cls.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <bpf/bpf_helpers.h>

#define NS_PER_SEC 1000000000ULL
#define BUCKET_CAPACITY 1000000ULL /* 1 MB burst capacity */
#define REFILL_RATE 1000000ULL     /* bytes/sec sustained rate */

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
    void *data_end = (void *)(long)skb->data_end;
    void *data = (void *)(long)skb->data;

    struct ethhdr *eth = data;
    struct iphdr *ip = (void *)eth + sizeof(*eth);
    if ((void *)ip + sizeof(*ip) > data_end)
        return TC_ACT_OK;

    // Key the bucket on the real source IP of the packet, not a fixed loopback
    // address, otherwise every client shares one hardcoded bucket.
    __u32 client_ip = ip->saddr;
    __u64 limit = BUCKET_CAPACITY; // 1 MB bandwidth bucket capacity
    __u64 now = bpf_ktime_get_ns();
    
    struct bucket_state *state = bpf_map_lookup_elem(&bandwidth_bucket_map, &client_ip);
    if (state) {
        bpf_spin_lock(&state->lock);
        __u64 elapsed = now > state->last_time ? now - state->last_time : 0;
        // Refill tokens based on elapsed time: 1 MB/sec means 1 byte per 1000 ns
        __u64 decay = elapsed / (NS_PER_SEC / REFILL_RATE);
        
        __u64 consumed = state->consumed;
        __u64 new_last_time = state->last_time;
        if (decay > consumed) {
            consumed = 0; // per-window reset
            new_last_time = now;
        } else {
            consumed -= decay;
            new_last_time += decay * (NS_PER_SEC / REFILL_RATE);
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
        bpf_map_update_elem(&bandwidth_bucket_map, &client_ip, &start_state, BPF_ANY);
    }

    return TC_ACT_OK;
}

char _license[] SEC("license") = "GPL";
