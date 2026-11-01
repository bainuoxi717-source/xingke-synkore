#include "exporter.h"
#include "board_config.h"
#include "sha256.h"
#include "tal_memory.h"
#include <stdio.h>
#include <string.h>

namespace {
bool waitAck(Scf1Protocol& protocol, uint32_t sequence) {
    const uint32_t started = millis();
    while (millis() - started < BoardConfig::kAckTimeoutMs) {
        // An ACK is 17 bytes. Drain a small batch before yielding rather than
        // sleeping for a millisecond after every individual byte.
        for (uint8_t i = 0; i < 32; ++i) {
            Scf1InputEvent event = protocol.poll();
            if (event.type == SCF1_INPUT_ACK && event.sequence == sequence) return true;
            if (event.type == SCF1_INPUT_BAD_FRAME) return false;
        }
        delay(1);
    }
    return false;
}

bool sendFile(VFSFILE& fs, Scf1Protocol& protocol, const char* courseId,
              const char* fullPath, const char* shortName) {
    const int size = fs.filesize(fullPath);
    if (size < 0) return false;
    TUYA_FILE file = fs.open(fullPath, "r");
    if (!file) return false;

    Sha256 sha;
    uint8_t buffer[BoardConfig::kExportChunkBytes];
    // Use PSRAM rather than the 4 KiB Arduino task stack for sector-sized reads.
    uint8_t* hashBuffer = static_cast<uint8_t*>(tal_psram_malloc(8192));
    uint8_t* hashData = hashBuffer ? hashBuffer : buffer;
    const int hashCapacity = hashBuffer ? 8192 : sizeof(buffer);
    int hashed = 0;
    uint32_t lastProgressMs = millis();
    char progress[160];
    int progressLength = snprintf(progress, sizeof(progress),
        "{\"path\":\"%s\",\"hashed\":0,\"size\":%d}", shortName, size);
    bool hashOk = protocol.sendFrame(SCF1_PROGRESS, reinterpret_cast<uint8_t*>(progress), progressLength);
    while (hashOk && hashed < size) {
        const int remaining = size - hashed;
        const int wanted = remaining < hashCapacity ? remaining : hashCapacity;
        const int count = fs.read(reinterpret_cast<char*>(hashData), wanted, file);
        if (count <= 0) { hashOk = false; break; }
        sha.update(hashData, count);
        hashed += count;
        if (millis() - lastProgressMs >= 1000) {
            lastProgressMs = millis();
            progressLength = snprintf(progress, sizeof(progress),
                "{\"path\":\"%s\",\"hashed\":%d,\"size\":%d}", shortName, hashed, size);
            hashOk = protocol.sendFrame(SCF1_PROGRESS, reinterpret_cast<uint8_t*>(progress), progressLength);
        }
        delay(1);  // Keep the display and touch workers responsive during hashing.
    }
    if (hashBuffer) tal_psram_free(hashBuffer);
    fs.close(file);
    if (!hashOk || hashed != size) return false;
    uint8_t digest[32];
    char hex[65];
    sha.final(digest);
    Sha256::toHex(digest, hex);

    char begin[320];
    snprintf(begin, sizeof(begin),
             "{\"course_id\":\"%s\",\"path\":\"%s\",\"size\":%d,\"sha256\":\"%s\"}",
             courseId, shortName, size, hex);
    if (!protocol.sendFrame(SCF1_FILE_BEGIN, reinterpret_cast<uint8_t*>(begin), strlen(begin))) return false;

    file = fs.open(fullPath, "r");
    if (!file) return false;
    uint32_t sequence = 0;
    bool ok = true;
    while (!fs.feof(file)) {
        int count = fs.read(reinterpret_cast<char*>(buffer + 4), sizeof(buffer) - 4, file);
        if (count <= 0) break;
        buffer[0] = sequence & 0xFF;
        buffer[1] = (sequence >> 8) & 0xFF;
        buffer[2] = (sequence >> 16) & 0xFF;
        buffer[3] = (sequence >> 24) & 0xFF;
        bool acknowledged = false;
        for (uint8_t attempt = 0; attempt < BoardConfig::kMaxFrameAttempts && !acknowledged; ++attempt) {
            if (!protocol.sendFrame(SCF1_FILE_DATA, buffer, count + 4)) break;
            acknowledged = waitAck(protocol, sequence);
        }
        if (!acknowledged) {
            ok = false;
            break;
        }
        ++sequence;
        delay(1);
    }
    fs.close(file);
    if (!ok) return false;

    char end[256];
    snprintf(end, sizeof(end), "{\"course_id\":\"%s\",\"path\":\"%s\",\"sha256\":\"%s\"}",
             courseId, shortName, hex);
    return protocol.sendFrame(SCF1_FILE_END, reinterpret_cast<uint8_t*>(end), strlen(end));
}
}

bool exportCoursePackage(VFSFILE& fs, Scf1Protocol& protocol, const char* courseId) {
    const char* names[] = {"marks.json", "meta.json", "audio.wav"};
    for (const char* name : names) {
        char path[128];
        snprintf(path, sizeof(path), "%s/%s/%s", BoardConfig::kCourseRoot, courseId, name);
        if (!fs.exist(path) || !sendFile(fs, protocol, courseId, path, name)) {
            char message[96];
            snprintf(message, sizeof(message), "Export failed: %s", name);
            protocol.sendError(message);
            return false;
        }
    }
    return true;
}
