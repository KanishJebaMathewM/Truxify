// eBPF program for tracing system calls
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

// Map to store system call counts
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // syscall ID
    __type(value, __u64);    // count
} syscall_counts SEC(".maps");

// Map to store process events
struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} events SEC(".maps");

// Tracepoint for system call entry
SEC("tracepoint/syscalls/sys_enter")
int trace_sys_enter(struct trace_event_raw_sys_enter *args)
{
    __u32 syscall_id = args->id;
    __u64 *count = bpf_map_lookup_elem(&syscall_counts, &syscall_id);
    
    if (count) {
        (*count)++;
    } else {
        __u64 init_val = 1;
        bpf_map_update_elem(&syscall_counts, &syscall_id, &init_val, BPF_ANY);
    }
    
    return 0;
}

// Tracepoint for process creation
SEC("tracepoint/sched/sched_process_fork")
int trace_process_fork(struct trace_event_raw_sched_process_fork *args)
{
    __u32 pid = args->parent_pid;
    __u32 child_pid = args->child_pid;
    
    bpf_printk("Process forked: parent=%d, child=%d\n", pid, child_pid);
    
    return 0;
}

// Tracepoint for file open
SEC("tracepoint/syscalls/sys_enter_openat")
int trace_openat(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[1];
    bpf_printk("Opening file: %s\n", filename);
    
    return 0;
}

// Tracepoint for network events
SEC("tracepoint/net/netif_receive_skb")
int trace_network(struct trace_event_raw_netif_receive_skb *args)
{
    __u16 protocol = args->protocol;
    bpf_printk("Network packet received: protocol=%d\n", protocol);
    
    return 0;
}

// Tracepoint for memory events
SEC("tracepoint/mm/mm_page_alloc")
int trace_memory(struct trace_event_raw_mm_page_alloc *args)
{
    __u64 order = args->order;
    bpf_printk("Memory allocated: order=%llu\n", order);
    
    return 0;
}