CXX ?= g++
CXXFLAGS := -O2 -fPIC -Wall

TARGET := libenclave_kyc.so
SRC := enclave_driver_kyc.cpp

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -shared -o $@ $<

clean:
	rm -f $(TARGET)

.PHONY: all clean
