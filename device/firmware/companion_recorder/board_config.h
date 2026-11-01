#ifndef CLASSROOM_RECORDER_BOARD_CONFIG_H
#define CLASSROOM_RECORDER_BOARD_CONFIG_H

#include <Arduino.h>

namespace BoardConfig {

constexpr uint32_t kSerialBaud = 921600;
// NiceMCU V1.2 BOOT/user button; the other button resets the whole board.
constexpr uint8_t kScreenButtonPin = 8;
constexpr uint32_t kButtonDebounceMs = 40;
constexpr uint32_t kScreenRedrawHoldMs = 1500;

// Course numbers are allocated automatically. Existing files are never overwritten.
constexpr char kCourseId[] = "course_001";
constexpr char kCourseRoot[] = "/courses";

constexpr uint32_t kSampleRate = 16000;
constexpr uint8_t kBitsPerSample = 16;
constexpr uint8_t kChannels = 1;
constexpr uint8_t kMicVolume = 70;

// 128 KiB holds about four seconds of 16 kHz, 16-bit, mono PCM.
constexpr uint32_t kMicRingBufferBytes = 128UL * 1024UL;
constexpr size_t kAudioIoBufferBytes = 2048;
constexpr size_t kMaxMarks = 128;

constexpr size_t kExportChunkBytes = 512;
constexpr uint32_t kMaxRecordMs = 60UL * 60UL * 1000UL;
constexpr uint32_t kAckTimeoutMs = 2000;
constexpr uint8_t kMaxFrameAttempts = 3;

}  // namespace BoardConfig

#endif
