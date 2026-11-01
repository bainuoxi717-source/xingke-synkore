#include "uart_protocol.h"
#include "crc32.h"
#include <string.h>

namespace {
constexpr uint8_t kMagic[4] = {'S', 'C', 'F', '1'};

uint32_t readU32(const uint8_t* data) {
    return static_cast<uint32_t>(data[0]) |
           (static_cast<uint32_t>(data[1]) << 8) |
           (static_cast<uint32_t>(data[2]) << 16) |
           (static_cast<uint32_t>(data[3]) << 24);
}

void writeU32(uint8_t* output, uint32_t value) {
    output[0] = value & 0xFF;
    output[1] = (value >> 8) & 0xFF;
    output[2] = (value >> 16) & 0xFF;
    output[3] = (value >> 24) & 0xFF;
}
}

Scf1Protocol::Scf1Protocol(Stream& stream) : stream_(stream) {
    resetRx();
    lastRxMs_ = millis();
    lineLength_ = 0;
    lineOverflow_ = false;
}

void Scf1Protocol::resetRx() {
    rxState_ = RX_MAGIC;
    magicIndex_ = 0;
    headerIndex_ = 0;
    payloadLength_ = 0;
    payloadIndex_ = 0;
    crcIndex_ = 0;
    discardRemaining_ = 0;
}

bool Scf1Protocol::writeAll(const uint8_t* data, size_t length) {
    size_t offset = 0;
    while (offset < length) {
        size_t written = stream_.write(data + offset, length - offset);
        if (!written) return false;
        offset += written;
    }
    return true;
}

bool Scf1Protocol::sendFrame(uint8_t type, const uint8_t* payload, uint32_t length) {
    uint8_t header[5] = {type, 0, 0, 0, 0};
    writeU32(header + 1, length);
    uint32_t crc = Scf1Crc32::update(Scf1Crc32::begin(), header, sizeof(header));
    if (length) crc = Scf1Crc32::update(crc, payload, length);
    uint8_t encodedCrc[4];
    writeU32(encodedCrc, Scf1Crc32::end(crc));
    return writeAll(kMagic, sizeof(kMagic)) && writeAll(header, sizeof(header)) &&
           (!length || writeAll(payload, length)) && writeAll(encodedCrc, sizeof(encodedCrc));
}

bool Scf1Protocol::sendError(const char* message) {
    return sendFrame(SCF1_ERROR, reinterpret_cast<const uint8_t*>(message), strlen(message));
}

Scf1InputEvent Scf1Protocol::consumeTextByte(uint8_t value) {
    Scf1InputEvent event = {};
    event.type = SCF1_INPUT_NONE;
    if (value == '\r') return event;
    if (value == '\n') {
        if (lineOverflow_) {
            lineOverflow_ = false;
            lineLength_ = 0;
            event.type = SCF1_INPUT_BAD_COMMAND;
            return event;
        }
        if (lineLength_) {
            line_[lineLength_] = '\0';
            strncpy(event.text, line_, sizeof(event.text) - 1);
            event.text[sizeof(event.text) - 1] = '\0';
            lineLength_ = 0;
            event.type = SCF1_INPUT_TEXT_LINE;
        }
        return event;
    }
    if (lineLength_ + 1 >= sizeof(line_)) {
        lineOverflow_ = true;
        lineLength_ = 0;
        return event;
    }
    if (!lineOverflow_) line_[lineLength_++] = static_cast<char>(value);
    return event;
}

Scf1InputEvent Scf1Protocol::completeFrame() {
    Scf1InputEvent event = {};
    event.type = SCF1_INPUT_OTHER_FRAME;
    event.frameType = header_[0];
    // Oversized frames were drained without storing their payload. Never use
    // their advertised length to read the fixed-size receive buffer.
    if (payloadLength_ > kMaxIncomingPayload) {
        event.type = SCF1_INPUT_BAD_FRAME;
        resetRx();
        return event;
    }
    uint32_t crc = Scf1Crc32::update(Scf1Crc32::begin(), header_, sizeof(header_));
    if (payloadLength_) crc = Scf1Crc32::update(crc, payload_, payloadLength_);
    const uint32_t actual = Scf1Crc32::end(crc);
    if (readU32(receivedCrc_) != actual) {
        event.type = SCF1_INPUT_BAD_FRAME;
    } else if (header_[0] == SCF1_ACK && payloadLength_ == 4) {
        event.type = SCF1_INPUT_ACK;
        event.sequence = readU32(payload_);
    }
    resetRx();
    return event;
}

Scf1InputEvent Scf1Protocol::poll() {
    Scf1InputEvent event = {};
    event.type = SCF1_INPUT_NONE;
    if (!stream_.available()) {
        if (rxState_ != RX_MAGIC && millis() - lastRxMs_ > 1000) resetRx();
        return event;
    }
    const uint8_t value = static_cast<uint8_t>(stream_.read());
    lastRxMs_ = millis();
    switch (rxState_) {
        case RX_MAGIC:
            if (value == kMagic[magicIndex_]) {
                if (++magicIndex_ == sizeof(kMagic)) {
                    rxState_ = RX_HEADER;
                    headerIndex_ = 0;
                }
                return event;
            }
            // A tentative magic prefix may instead be the start of a command
            // (START, STATUS, STOP, ...). Put every held byte back into the
            // text parser before consuming the byte that did not match.
            for (size_t i = 0; i < magicIndex_; ++i) consumeTextByte(kMagic[i]);
            magicIndex_ = 0;
            // Preserve an overlapping prefix, e.g. the second S in SSCF1.
            if (value == kMagic[0]) {
                magicIndex_ = 1;
                return event;
            }
            return consumeTextByte(value);
        case RX_HEADER:
            header_[headerIndex_++] = value;
            if (headerIndex_ == sizeof(header_)) {
                payloadLength_ = readU32(header_ + 1);
                payloadIndex_ = 0;
                if (payloadLength_ > kMaxIncomingPayload) {
                    discardRemaining_ = payloadLength_;
                    rxState_ = RX_DISCARD;
                } else {
                    rxState_ = payloadLength_ ? RX_PAYLOAD : RX_CRC;
                }
                crcIndex_ = 0;
            }
            break;
        case RX_PAYLOAD:
            payload_[payloadIndex_++] = value;
            if (payloadIndex_ == payloadLength_) rxState_ = RX_CRC;
            break;
        case RX_CRC:
            receivedCrc_[crcIndex_++] = value;
            if (crcIndex_ == sizeof(receivedCrc_)) return completeFrame();
            break;
        case RX_DISCARD:
            if (--discardRemaining_ == 0) rxState_ = RX_CRC;
            break;
    }
    return event;
}
