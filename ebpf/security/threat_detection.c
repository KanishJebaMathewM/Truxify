// eBPF program for threat detection
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

#ifndef AF_INET
#define AF_INET 2
#endif
#ifndef AF_INET6
#define AF_INET6 10
#endif

// Prefix match helper. str is a bounded stack buffer filled by
// bpf_probe_read_user_str; prefix_len is a small compile-time constant, so the
// loop is fully unrolled and verifier-safe.
static __always_inline int str_has_prefix(const char *str, const char *prefix, int prefix_len)
{
    for (int i = 0; i < prefix_len; i++) {
        if (str[i] != prefix[i]) {
            return 0;
        }
    }
    return 1;
}

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

// Map for threat events
struct {
    __uint(type, BPF_MAP_TYPE_PERF_EVENT_ARRAY);
    __uint(key_size, sizeof(__u32));
    __uint(value_size, sizeof(__u32));
} threat_events SEC(".maps");

// Map for suspicious IPs
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // IP address
    __type(value, __u64);    // timestamp
} suspicious_ips SEC(".maps");

// Map for file integrity
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);      // file descriptor
    __type(value, __u64);    // file hash
} file_hashes SEC(".maps");

// Tracepoint for sensitive file access
SEC("tracepoint/syscalls/sys_enter_openat")
int trace_file_access(struct trace_event_raw_sys_enter *args)
{
    char filename[256];
    // args->args[1] is a userspace pointer to the filename; it cannot be
    // dereferenced from kernel context. Probe it into a bounded stack buffer.
    if (bpf_probe_read_user_str(filename, sizeof(filename), (void *)(long)args->args[1]) < 0) {
        return 0;
    }
    
    // Check for sensitive files
    struct {
        const char *path;
        int len;
    } sensitive_files[] = {
        { "/etc/passwd", 11 },
        { "/etc/shadow", 11 },
        { "/etc/sudoers", 12 },
        { "/root/.ssh/id_rsa", 17 },
        { "/etc/ssl/private/", 17 }
    };
    
    for (int i = 0; i < 5; i++) {
        if (str_has_prefix(filename, sensitive_files[i].path, sensitive_files[i].len)) {
            bpf_printk("Sensitive file access: %s\n", filename);
        }
    }
    
    return 0;
}

// Tracepoint for process execution
SEC("tracepoint/syscalls/sys_enter_execve")
int trace_process_exec(struct trace_event_raw_sys_enter *args)
{
    char filename[256];
    // args->args[0] is a userspace pointer to the executable path; probe it
    // into a bounded stack buffer before any string matching.
    if (bpf_probe_read_user_str(filename, sizeof(filename), (void *)(long)args->args[0]) < 0) {
        return 0;
    }
    
    // Check for suspicious processes
    struct {
        const char *name;
        int len;
    } suspicious_processes[] = {
        { "nc", 2 }, { "netcat", 6 }, { "ncat", 4 },
        { "telnet", 6 }, { "ftp", 3 }, { "sshpass", 7 },
        { "curl", 4 }, { "wget", 4 },
        { "python -c", 9 }, { "perl -e", 7 },
        { "bash -i", 7 }, { "sh -i", 5 }
    };
    
    for (int i = 0; i < 12; i++) {
        if (str_contains(filename, sizeof(filename), suspicious_processes[i].name, suspicious_processes[i].len)) {
            bpf_printk("Suspicious process: %s\n", filename);
        }
    }
    
    return 0;
}

// Tracepoint for network connections
SEC("tracepoint/syscalls/sys_enter_connect")
int trace_network_connect(struct trace_event_raw_sys_enter *args)
{
    __u32 port = 0;
    __u16 family = 0;
    __u16 sin_port = 0;
    char *sockaddr = (char *)(long)args->args[1];

    // args->args[1] is a pointer to a userspace struct sockaddr, not the
    // port. Reading the pointer value as the port never matches real ports;
    // probe the sockaddr first and inspect sa_family.
    if (bpf_probe_read_user(&family, sizeof(family), sockaddr) != 0) {
        return 0;
    }

    // sin_port / sin6_port is a __u16 at offset 2 of both sockaddr_in and
    // sockaddr_in6, in network byte order.
    if (family == AF_INET || family == AF_INET6) {
        if (bpf_probe_read_user(&sin_port, sizeof(sin_port), sockaddr + 2) != 0) {
            return 0;
        }
        port = bpf_ntohs(sin_port);
    } else {
        return 0;
    }
    
    // Check for suspicious ports
    const __u32 suspicious_ports[] = {
        22,  // SSH
        23,  // Telnet
        21,  // FTP
        25,  // SMTP
        445, // SMB
        3389, // RDP
        5900, // VNC
        6667, // IRC
        1337  // Common backdoor port
    };
    
    for (int i = 0; i < 9; i++) {
        if (port == suspicious_ports[i]) {
            bpf_printk("Suspicious connection attempt on port: %d\n", port);
        }
    }
    
    return 0;
}

// Tracepoint for privilege escalation
SEC("tracepoint/syscalls/sys_enter_setuid")
int trace_setuid(struct trace_event_raw_sys_enter *args)
{
    __u32 uid = (__u32)args->args[0];
    
    // Check for root escalation
    if (uid == 0) {
        bpf_printk("Potential privilege escalation to root\n");
    }
    
    return 0;
}

// Tracepoint for file modification
SEC("tracepoint/syscalls/sys_enter_rename")
int trace_file_rename(struct trace_event_raw_sys_enter *args)
{
    char oldpath[256];
    char newpath[256];
    // args->args[0] and args->args[1] are userspace pointers to the path
    // names; they cannot be dereferenced from kernel context. Probe them into
    // bounded stack buffers before any use.
    if (bpf_probe_read_user_str(oldpath, sizeof(oldpath), (void *)(long)args->args[0]) < 0) {
        return 0;
    }
    if (bpf_probe_read_user_str(newpath, sizeof(newpath), (void *)(long)args->args[1]) < 0) {
        return 0;
    }

    bpf_printk("File renamed: %s -> %s\n", oldpath, newpath);
    
    return 0;
}

// Tracepoint for process exit (detect crashes)
SEC("tracepoint/sched/sched_process_exit")
int trace_process_exit(struct trace_event_raw_sched_process_exit *args)
{
    __u32 pid = args->pid;
    __u32 exit_code = args->exit_code;
    
    if (exit_code != 0) {
        bpf_printk("Process %d exited with code %d\n", pid, exit_code);
    }
    
    return 0;
}