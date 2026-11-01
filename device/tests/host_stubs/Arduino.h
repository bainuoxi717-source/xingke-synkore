#ifndef ZHILIU_HOST_ARDUINO_H
#define ZHILIU_HOST_ARDUINO_H

#include <stddef.h>
#include <stdint.h>

// Minimal host boundary: tests exercise the actual firmware parser and CRC.
class Stream {
public:
    virtual ~Stream() = default;
    virtual int available() = 0;
    virtual int read() = 0;
    virtual size_t write(const uint8_t* data, size_t length) = 0;
};

uint32_t millis();

#endif
