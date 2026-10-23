// eBPF program for network tracing

#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

/*
 * TCP connect tracepoint context
 */
struct trace_event_raw_tcp_connect {
    __u16 common_type;
    __u8 common_flags;
    __u8 common_preempt_count;
    __s32 common_pid;

    __u64 skaddr;
    __u16 sport;
    __u16 dport;
    __u16 family;
    __u8 saddr[4];
    __u8 daddr[4];
};

/*
 * UDP send tracepoint context
 */
struct trace_event_raw_udp_sendmsg {
    __u16 common_type;
    __u8 common_flags;
    __u8 common_preempt_count;
    __s32 common_pid;

    __u64 skaddr;
    __u16 sport;
    __u16 dport;
    __u32 len;
};

/*
 * Stores total UDP bytes sent by source port.
 */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u16);
    __type(value, __u64);
} network_stats SEC(".maps");

/*
 * Stores the timestamp when a TCP connection was observed.
 */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u16);
    __type(value, __u64);
} connections SEC(".maps");

/*
 * Trace TCP connection attempts.
 */
SEC("tracepoint/tcp/tcp_connect")
int trace_tcp_connect(struct trace_event_raw_tcp_connect *args)
{
    __u16 sport = args->sport;
    __u16 dport = args->dport;
    __u64 timestamp = bpf_ktime_get_ns();

    bpf_printk(
        "TCP Connect: sport=%u, dport=%u\n",
        sport,
        dport
    );

    /*
     * Store the connection timestamp.
     */
    bpf_map_update_elem(
        &connections,
        &sport,
        &timestamp,
        BPF_ANY
    );

    return 0;
}

/*
 * Trace UDP send operations.
 */
SEC("tracepoint/udp/udp_sendmsg")
int trace_udp_send(struct trace_event_raw_udp_sendmsg *args)
{
    __u16 sport = args->sport;
    __u32 len = args->len;

    __u64 *bytes = bpf_map_lookup_elem(
        &network_stats,
        &sport
    );

    if (bytes) {
        *bytes += len;
    } else {
        __u64 initial_bytes = len;

        bpf_map_update_elem(
            &network_stats,
            &sport,
            &initial_bytes,
            BPF_ANY
        );
    }

    bpf_printk(
        "UDP Send: sport=%u, len=%u\n",
        sport,
        len
    );

    return 0;
}
