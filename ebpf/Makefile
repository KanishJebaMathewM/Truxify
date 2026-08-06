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
