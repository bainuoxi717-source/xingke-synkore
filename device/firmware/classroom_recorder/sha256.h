#ifndef CLASSROOM_RECORDER_SHA256_H
#define CLASSROOM_RECORDER_SHA256_H

#include <stddef.h>
#include <stdint.h>

class Sha256 {
public:
    Sha256();

    void reset();
    void update(const uint8_t* data, size_t length);
    void final(uint8_t digest[32]);

    static void toHex(const uint8_t digest[32], char output[65]);

private:
    void transform(const uint8_t block[64]);

    uint32_t state_[8];
    uint64_t totalBytes_;
    uint8_t block_[64];
    size_t blockLength_;
};

#endif
