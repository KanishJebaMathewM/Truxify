// eBPF program for file integrity monitoring
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

// Map for file integrity
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // file descriptor
    __type(value, __u64);    // file hash
} file_integrity SEC(".maps");

// Map for suspicious files
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // file descriptor
    __type(value, __u64);    // timestamp
} suspicious_files SEC(".maps");

// Tracepoint for file open
SEC("tracepoint/syscalls/sys_enter_open")
int trace_file_open(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[0];
    
    // Check for suspicious file extensions
    const char *suspicious_extensions[] = {
        ".exe", ".bat", ".sh", ".py",
        ".js", ".vbs", ".ps1", ".cmd",
        ".jar", ".dll", ".so", ".php"
    };
    
    for (int i = 0; i < 12; i++) {
        if (strstr(filename, suspicious_extensions[i]) != NULL) {
            bpf_printk("Suspicious file opened: %s\n", filename);
        }
    }
    
    return 0;
}

// Tracepoint for file write
SEC("tracepoint/syscalls/sys_enter_write")
int trace_file_write(struct trace_event_raw_sys_enter *args)
{
    __u32 fd = (__u32)args->args[0];
    
    // Check if file is in integrity map
    __u64 *hash = bpf_map_lookup_elem(&file_integrity, &fd);
    
    if (hash) {
        bpf_printk("File modified: fd=%d\n", fd);
    }
    
    return 0;
}

// Tracepoint for file delete
SEC("tracepoint/syscalls/sys_enter_unlink")
int trace_file_delete(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[0];
    bpf_printk("File deleted: %s\n", filename);
    
    return 0;
}

// Tracepoint for file permission change
SEC("tracepoint/syscalls/sys_enter_chmod")
int trace_file_chmod(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[0];
    __u32 mode = (__u32)args->args[1];
    
    bpf_printk("File permissions changed: %s (mode: %d)\n", filename, mode);
    
    return 0;
}