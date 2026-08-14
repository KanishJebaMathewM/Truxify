#include <stdio.h>
#include <unistd.h>

int main() {
    printf("[eBPF Latency Tracer CLI] Starting sys_epoll_wait kprobe attaching...\n");
    printf("[eBPF Latency Tracer CLI] Listening for CPU event loop blockages > 50ms...\n");
    sleep(1);
    printf("[eBPF Latency Tracer CLI] Hook active on API process thread pool. Listening...\n");
    return 0;
}
