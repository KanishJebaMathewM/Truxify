/*
 * eBPF Kprobe Function Tracing & Latency Profiler
 * Attaches to sys_enter_epoll_wait and sys_exit_epoll_wait to log event loop blocks.
 */

#include <linux/bpf.h>
#include <bpf/bpf_helpers.h>

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);   // PID
    __type(value, __u64); // Entry timestamp nanoseconds
} enter_timestamp_map SEC(".maps");

SEC("kprobe/sys_enter_epoll_wait")
int kprobe_sys_enter_epoll_wait(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 ts = bpf_ktime_get_ns();

    bpf_map_update_elem(&enter_timestamp_map, &pid, &ts, BPF_ANY);
    return 0;
}

SEC("kretprobe/sys_exit_epoll_wait")
int kretprobe_sys_exit_epoll_wait(struct pt_regs *ctx) {
    __u64 pid_tgid = bpf_get_current_pid_tgid();
    __u32 pid = pid_tgid >> 32;
    __u64 exit_ts = bpf_ktime_get_ns();

    __u64 *entry_ts = bpf_map_lookup_elem(&enter_timestamp_map, &pid);
    if (entry_ts) {
        __u64 latency_ns = exit_ts - *entry_ts;
        if (latency_ns > 50000000) { // 50 milliseconds event loop block
            bpf_printk("EventLoopBlockDetected: PID=%d Latency=%lldns\n", pid, latency_ns);
        }
        bpf_map_delete_elem(&enter_timestamp_map, &pid);
    }
    return 0;
}

char _license[] SEC("license") = "GPL";
