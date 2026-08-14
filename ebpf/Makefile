<<<<<<< HEAD
CLANG ?= clang
LLC ?= llc
BPFTOOL ?= bpftool

TARGET := telemetry_filter
SRC := $(TARGET).c
OBJ := $(TARGET).o

CFLAGS := -O2 -target bpf -D__KERNEL__

all: $(OBJ)

$(OBJ): $(SRC)
	$(CLANG) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJ)

.PHONY: all clean
=======
# Makefile for Truxify eBPF tools compilation
CC := clang
CFLAGS := -O2 -target bpf -Wall -g

all: xdp_anti_replay.o socket_buffer_filter.o

xdp_anti_replay.o: xdp_anti_replay.c
	$(CC) $(CFLAGS) -c xdp_anti_replay.c -o xdp_anti_replay.o

socket_buffer_filter.o: socket_buffer_filter.c
	$(CC) $(CFLAGS) -c socket_buffer_filter.c -o socket_buffer_filter.o

clean:
	rm -f *.o
>>>>>>> upstream/main
