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
    __u64 tokens;      /* available bytes in the bucket */
    __u64 last_refill; /* bpf_ktime_get_ns() of the last update */
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32); // Client IP
    __type(value, struct bucket_state);
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
    __u64 now = bpf_ktime_get_ns();

    struct bucket_state *bucket = bpf_map_lookup_elem(&bandwidth_bucket_map, &client_ip);
    if (bucket) {
        // Refill the bucket with the rate elapsed since the last update,
        // capped at capacity. Without this the counter only ever grows and
        // the client is blackholed forever once the initial budget is spent.
        __u64 elapsed_ns = now > bucket->last_refill ? now - bucket->last_refill : 0;
        __u64 tokens = bucket->tokens + (elapsed_ns / NS_PER_SEC) * REFILL_RATE;
        if (tokens > BUCKET_CAPACITY)
            tokens = BUCKET_CAPACITY;
        bucket->tokens = tokens;
        bucket->last_refill = now;

        if (tokens < skb->len)
            return TC_ACT_SHOT; // Drop packet exceeding sustained rate
        bucket->tokens = tokens - skb->len;
    } else {
        struct bucket_state init = { BUCKET_CAPACITY, now };
        bpf_map_update_elem(&bandwidth_bucket_map, &client_ip, &init, BPF_ANY);
    }

    return TC_ACT_OK;
}

char _license[] SEC("license") = "GPL";
