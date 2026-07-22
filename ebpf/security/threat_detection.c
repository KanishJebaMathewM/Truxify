// eBPF program for threat detection
#include <linux/bpf.h>
#include <linux/ptrace.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_tracing.h>

char LICENSE[] SEC("license") = "GPL";

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

// Tracepoint for failed login attempts
SEC("tracepoint/syscalls/sys_enter_openat")
int trace_file_access(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[1];
    
    // Check for sensitive files
    const char *sensitive_files[] = {
        "/etc/passwd",
        "/etc/shadow",
        "/etc/sudoers",
        "/root/.ssh/id_rsa",
        "/etc/ssl/private/"
    };
    
    for (int i = 0; i < 5; i++) {
        if (strncmp(filename, sensitive_files[i], strlen(sensitive_files[i])) == 0) {
            bpf_printk("Sensitive file access: %s\n", filename);
        }
    }
    
    return 0;
}

// Tracepoint for failed login attempts
SEC("tracepoint/syscalls/sys_enter_execve")
int trace_process_exec(struct trace_event_raw_sys_enter *args)
{
    const char *filename = (const char *)args->args[0];
    
    // Check for suspicious processes
    const char *suspicious_processes[] = {
        "nc", "netcat", "ncat",
        "telnet", "ftp", "sshpass",
        "curl", "wget",
        "python -c", "perl -e",
        "bash -i", "sh -i"
    };
    
    for (int i = 0; i < 11; i++) {
        if (strstr(filename, suspicious_processes[i]) != NULL) {
            bpf_printk("Suspicious process: %s\n", filename);
        }
    }
    
    return 0;
}

// Tracepoint for network connections
SEC("tracepoint/syscalls/sys_enter_connect")
int trace_network_connect(struct trace_event_raw_sys_enter *args)
{
    __u32 port = (__u32)args->args[1];
    
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
    const char *oldpath = (const char *)args->args[0];
    const char *newpath = (const char *)args->args[1];
    
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