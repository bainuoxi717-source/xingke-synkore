#ifndef CLASSROOM_RECORDER_CRC32_H
#define CLASSROOM_RECORDER_CRC32_H

#include <stddef.h>
#include <stdint.h>

namespace Scf1Crc32 {

inline uint32_t begin() {
    return 0xFFFFFFFFUL;
}

inline uint32_t update(uint32_t crc, const uint8_t* data, size_t length) {
    for (size_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (uint8_t bit = 0; bit < 8; ++bit) {
            const uint32_t mask = static_cast<uint32_t>(
                -static_cast<int32_t>(crc & 1UL));
            crc = (crc >> 1) ^ (0xEDB88320UL & mask);
        }
    }
    return crc;
}

inline uint32_t end(uint32_t crc) {
    return crc ^ 0xFFFFFFFFUL;
}

}  // namespace Scf1Crc32

#endif
