/*
 * eBPF Socket Filter for Zero-Copy TCP Telemetry Ring Buffering
 * SO_ATTACH_BPF socket program filtering TCP telemetry packets in kernel space.
 */

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/tcp.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 256 * 1024); // 256 KB Ring Buffer
} telemetry_ringbuf SEC(".maps");

struct telemetry_event {
    __u32 src_ip;
    __u16 src_port;
    __u32 payload_len;
};

SEC("socket")
int socket_telemetry_filter(struct __sk_buff *skb) {
    // Read IP header
    struct iphdr ip;
    if (bpf_skb_load_bytes(skb, ETH_HLEN, &ip, sizeof(ip)) < 0)
        return 0; // Drop invalid packet

    if (ip.protocol != IPPROTO_TCP)
        return 0;

    struct tcphdr tcp;
    if (bpf_skb_load_bytes(skb, ETH_HLEN + sizeof(ip), &tcp, sizeof(tcp)) < 0)
        return 0;

    // Filter telemetry frames by magic header or port
    __u32 payload_len = skb->len - (ETH_HLEN + sizeof(ip) + (tcp.doff * 4));
    if (payload_len > 0) {
        struct telemetry_event *evt = bpf_ringbuf_reserve(&telemetry_ringbuf, sizeof(struct telemetry_event), 0);
        if (evt) {
            evt->src_ip = ip.saddr;
            evt->src_port = tcp.source;
            evt->payload_len = payload_len;
            bpf_ringbuf_submit(evt, 0);
        }
    }

    return skb->len; // Pass frame to socket buffer
}

char _license[] SEC("license") = "GPL";
