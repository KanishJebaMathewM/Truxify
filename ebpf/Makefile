# Makefile for Truxify eBPF tools compilation
CC := clang
CFLAGS := -O2 -target bpf -Wall -g

all: xdp_anti_replay.o socket_buffer_filter.o tc_bandwidth_shaper.o kprobe_latency_tracer.o

xdp_anti_replay.o: xdp_anti_replay.c
	$(CC) $(CFLAGS) -c xdp_anti_replay.c -o xdp_anti_replay.o

socket_buffer_filter.o: socket_buffer_filter.c
	$(CC) $(CFLAGS) -c socket_buffer_filter.c -o socket_buffer_filter.o

tc_bandwidth_shaper.o: tc_bandwidth_shaper.c
	$(CC) $(CFLAGS) -c tc_bandwidth_shaper.c -o tc_bandwidth_shaper.o

kprobe_latency_tracer.o: kprobe_latency_tracer.c
	$(CC) $(CFLAGS) -c kprobe_latency_tracer.c -o kprobe_latency_tracer.o

clean:
	rm -f *.o
