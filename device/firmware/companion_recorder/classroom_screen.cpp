#include "classroom_screen.h"
#include "ghost_ui.h"
#include "crc32.h"
#include <Arduino.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <stdio.h>

namespace {
constexpr size_t kBytes = 256 * 160 / 8;
uint8_t staging[kBytes];
uint32_t frameId = 0, expectedCrc = 0, received = 0, lastByteMs = 0;
bool receiving = false;
bool compressed = false;
uint32_t wireBytes = kBytes, decodedBytes = 0;
uint8_t runRemaining = 0, decodeState = 0;
uint8_t previousChunk[32];
uint32_t previousOffset = 0;
size_t previousLength = 0;

bool number(const char*& p, uint32_t& value, int base = 10) {
    while (*p == ' ') ++p;
    if (!*p || *p == '-' || *p == '+') return false;
    char* end = nullptr;
    errno = 0;
    const unsigned long n = strtoul(p, &end, base);
    if (errno == ERANGE || end == p || (*end && *end != ' ')) return false;
    value = static_cast<uint32_t>(n); p = end;
    return true;
}
bool endOf(const char* p) { while (*p == ' ') ++p; return *p == 0; }
int hex(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
void line(const char* text) { Serial.write(reinterpret_cast<const uint8_t*>(text), strlen(text)); }
void error(const char* reason) { char text[64]; snprintf(text, sizeof(text), "SCREEN ERROR %s\n", reason); line(text); }
void ack() { char text[64]; snprintf(text, sizeof(text), "SCREEN ACK %lu %lu\n", static_cast<unsigned long>(frameId), static_cast<unsigned long>(received)); line(text); }

bool decode(uint8_t value) {
    if (!compressed) {
        if (decodedBytes >= kBytes) return false;
        staging[decodedBytes++] = value; return true;
    }
    if (decodeState == 0) {
        runRemaining = (value & 127) + 1;
        decodeState = value & 128 ? 2 : 1;
    } else if (decodeState == 2) {
        if (runRemaining > kBytes - decodedBytes) return false;
        memset(staging + decodedBytes, value, runRemaining);
        decodedBytes += runRemaining; decodeState = 0;
    } else {
        if (decodedBytes >= kBytes) return false;
        staging[decodedBytes++] = value;
        if (--runRemaining == 0) decodeState = 0;
    }
    return true;
}
}

bool classroomScreenReceiving() {
    if (receiving && millis() - lastByteMs > 10000) receiving = false;
    return receiving;
}

bool classroomScreenCommand(const char* command) {
    if (strncmp(command, "SCREEN ", 7)) return false;
    if (!strcmp(command, "SCREEN CLOSE")) {
        receiving = false;
        if (ghostUiInClassroom()) ghostUiShowPet();
        Serial.println("SCREEN CLOSED");
        return true;
    }
    if (!strncmp(command, "SCREEN BEGIN ", 13)) {
        const char* p = command + 13;
        uint32_t id, crc;
        if (!number(p, id) || !id || !number(p, crc, 16)) { error("BEGIN"); return true; }
        compressed = false; wireBytes = kBytes;
        if (!endOf(p)) {
            if (strncmp(p, " RLE ", 5)) { error("BEGIN"); return true; }
            p += 5;
            if (!number(p, wireBytes) || !wireBytes || wireBytes > 8192 || !endOf(p)) { error("SIZE"); return true; }
            compressed = true;
        }
        frameId = id; expectedCrc = crc; received = decodedBytes = 0; decodeState = 0; previousLength = 0;
        lastByteMs = millis(); receiving = true;
        char text[64]; snprintf(text, sizeof(text), "SCREEN READY %lu WINDOW=%u\n", static_cast<unsigned long>(frameId), compressed ? 2 : 1); line(text);
        return true;
    }
    if (!receiving || millis() - lastByteMs > 10000) { receiving = false; error("NO_FRAME"); return true; }
    if (!strncmp(command, "SCREEN DATA ", 12)) {
        const char* p = command + 12;
        uint32_t id, offset;
        if (!number(p, id) || !number(p, offset)) { error("DATA"); return true; }
        while (*p == ' ') ++p;
        const size_t chars = strlen(p), bytes = chars / 2;
        if (id != frameId || !chars || (chars & 1) || bytes > 32 || offset > wireBytes || bytes > wireBytes - offset) { error("RANGE"); return true; }
        uint8_t decoded[32];
        for (size_t i = 0; i < bytes; ++i) {
            const int hi = hex(p[i * 2]), lo = hex(p[i * 2 + 1]);
            if (hi < 0 || lo < 0) { error("HEX"); return true; }
            decoded[i] = (hi << 4) | lo;
        }
        if (previousLength == bytes && offset == previousOffset && !memcmp(previousChunk, decoded, bytes)) {
            lastByteMs = millis(); ack(); return true;
        }
        if (offset != received) { error("OFFSET"); return true; }
        for (size_t i = 0; i < bytes; ++i) if (!decode(decoded[i])) { receiving = false; error("DECODE"); return true; }
        memcpy(previousChunk, decoded, bytes); previousLength = bytes; previousOffset = offset;
        received += bytes; lastByteMs = millis();
        if (!compressed || received % 64 == 0 || received == wireBytes) ack();
        return true;
    }
    if (!strncmp(command, "SCREEN END ", 11)) {
        const char* p = command + 11;
        uint32_t id;
        if (!number(p, id) || !endOf(p) || id != frameId || received != wireBytes || decodedBytes != kBytes || decodeState) { error("INCOMPLETE"); return true; }
        const uint32_t actual = Scf1Crc32::end(Scf1Crc32::update(Scf1Crc32::begin(), staging, kBytes));
        receiving = false;
        if (actual != expectedCrc) { error("CRC"); return true; }
        if (!ghostUiShowClassroomCard(staging, frameId)) { error("DISPLAY"); return true; }
        char text[80]; snprintf(text, sizeof(text), "SCREEN SHOWN %lu CRC=%08lX\n", static_cast<unsigned long>(frameId), static_cast<unsigned long>(actual)); line(text);
        return true;
    }
    error("COMMAND");
    return true;
}
