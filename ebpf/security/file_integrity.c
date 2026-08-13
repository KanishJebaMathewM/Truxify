// eBPF program for file integrity monitoring
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

// Substring match helper over a bounded stack buffer (replaces libc strstr,
// which is unavailable to the BPF verifier).
static __always_inline int str_contains(const char *str, int str_len, const char *sub, int sub_len)
{
    for (int i = 0; i <= str_len - sub_len; i++) {
        int match = 1;
        for (int j = 0; j < sub_len; j++) {
            if (str[i + j] != sub[j]) {
                match = 0;
                break;
            }
        }
        if (match) {
            return 1;
        }
    }
    return 0;
}

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
    char filename[256];
    // args->args[0] is a userspace pointer to the filename; it cannot be
    // dereferenced from kernel context. Probe it into a bounded stack buffer.
    if (bpf_probe_read_user_str(filename, sizeof(filename), (void *)(long)args->args[0]) < 0) {
        return 0;
    }
    
    // Check for suspicious file extensions
    struct {
        const char *ext;
        int len;
    } suspicious_extensions[] = {
        { ".exe", 4 }, { ".bat", 4 }, { ".sh", 3 }, { ".py", 3 },
        { ".js", 3 }, { ".vbs", 4 }, { ".ps1", 4 }, { ".cmd", 4 },
        { ".jar", 4 }, { ".dll", 4 }, { ".so", 3 }, { ".php", 4 }
    };
    
    for (int i = 0; i < 12; i++) {
        if (str_contains(filename, sizeof(filename), suspicious_extensions[i].ext, suspicious_extensions[i].len)) {
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
    char filename[256];
    // args->args[0] is a userspace pointer to the filename; it cannot be
    // dereferenced from kernel context. Probe it into a bounded stack buffer.
    if (bpf_probe_read_user_str(filename, sizeof(filename), (void *)(long)args->args[0]) < 0) {
        return 0;
    }
    bpf_printk("File deleted: %s\n", filename);
    
    return 0;
}

// Tracepoint for file permission change
SEC("tracepoint/syscalls/sys_enter_chmod")
int trace_file_chmod(struct trace_event_raw_sys_enter *args)
{
    char filename[256];
    // args->args[0] is a userspace pointer to the filename; it cannot be
    // dereferenced from kernel context. Probe it into a bounded stack buffer.
    if (bpf_probe_read_user_str(filename, sizeof(filename), (void *)(long)args->args[0]) < 0) {
        return 0;
    }
    __u32 mode = (__u32)args->args[1];
    
    bpf_printk("File permissions changed: %s (mode: %d)\n", filename, mode);
    
    return 0;
}