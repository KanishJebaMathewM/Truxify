#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdint.h>
#include <sgx_urts.h>
#include <sgx_trts.h>
#include "enclave_t.h"

// Enclave memory protection
#define ENCLAVE_HEAP_SIZE 1024 * 1024  // 1MB
#define ENCLAVE_STACK_SIZE 1024 * 1024 // 1MB

// Secure data structure
typedef struct {
    uint8_t data[256];
    uint32_t length;
    uint64_t timestamp;
} secure_data_t;

// Enclave global state
static secure_data_t secure_storage[100];
static uint32_t storage_count = 0;
static uint64_t enclave_counter = 0;

// SGX enclave entry point
sgx_status_t enclave_init(void) {
    enclave_counter = 0;
    storage_count = 0;
    memset(secure_storage, 0, sizeof(secure_storage));
    return SGX_SUCCESS;
}

// Secure data encryption (simplified)
void ecall_encrypt_data(
    const uint8_t* plaintext,
    uint32_t plaintext_len,
    uint8_t* ciphertext,
    uint32_t* ciphertext_len
) {
    // In production: use AES-GCM inside enclave
    // For demo: XOR encryption
    uint8_t key[32] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
    
    for (uint32_t i = 0; i < plaintext_len; i++) {
        ciphertext[i] = plaintext[i] ^ key[i % 32];
    }
    *ciphertext_len = plaintext_len;
}

// Secure data decryption (simplified)
void ecall_decrypt_data(
    const uint8_t* ciphertext,
    uint32_t ciphertext_len,
    uint8_t* plaintext,
    uint32_t* plaintext_len
) {
    uint8_t key[32] = {0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF};
    
    for (uint32_t i = 0; i < ciphertext_len; i++) {
        plaintext[i] = ciphertext[i] ^ key[i % 32];
    }
    *plaintext_len = ciphertext_len;
}

// Secure storage
sgx_status_t ecall_store_data(
    const uint8_t* data,
    uint32_t data_len
) {
    if (storage_count >= 100) {
        return SGX_ERROR_OUT_OF_MEMORY;
    }
    
    if (data_len > 256) {
        return SGX_ERROR_INVALID_PARAMETER;
    }
    
    memcpy(secure_storage[storage_count].data, data, data_len);
    secure_storage[storage_count].length = data_len;
    secure_storage[storage_count].timestamp = sgx_read_rand();
    storage_count++;
    
    return SGX_SUCCESS;
}

sgx_status_t ecall_retrieve_data(
    uint32_t index,
    uint8_t* data,
    uint32_t* data_len
) {
    if (index >= storage_count) {
        return SGX_ERROR_INVALID_PARAMETER;
    }
    
    memcpy(data, secure_storage[index].data, secure_storage[index].length);
    *data_len = secure_storage[index].length;
    
    return SGX_SUCCESS;
}

// Secure counter
uint64_t ecall_get_secure_counter(void) {
    enclave_counter++;
    return enclave_counter;
}

// Attestation quote generation
sgx_status_t ecall_get_quote(
    uint8_t* quote,
    uint32_t* quote_len
) {
    // In production: generate SGX quote
    // For demo: return dummy quote
    uint8_t dummy_quote[64] = {0};
    memcpy(quote, dummy_quote, 64);
    *quote_len = 64;
    return SGX_SUCCESS;
}

// Secure computation
int ecall_secure_compute(
    int a,
    int b,
    char operation
) {
    int result = 0;
    switch (operation) {
        case '+':
            result = a + b;
            break;
        case '-':
            result = a - b;
            break;
        case '*':
            result = a * b;
            break;
        case '/':
            if (b != 0) {
                result = a / b;
            }
            break;
    }
    return result;
}

// Secure random number generation
uint32_t ecall_secure_random(void) {
    uint32_t random;
    sgx_read_rand((unsigned char*)&random, sizeof(random));
    return random;
}