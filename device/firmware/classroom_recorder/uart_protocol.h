#ifndef CLASSROOM_RECORDER_UART_PROTOCOL_H
#define CLASSROOM_RECORDER_UART_PROTOCOL_H

#include <Arduino.h>

enum Scf1FrameType : uint8_t {
    SCF1_FILE_BEGIN = 1,
    SCF1_FILE_DATA = 2,
    SCF1_FILE_END = 3,
    SCF1_ACK = 4,
    SCF1_ERROR = 5,
    SCF1_PROGRESS = 6,
};

enum Scf1InputType : uint8_t {
    SCF1_INPUT_NONE = 0,
    SCF1_INPUT_TEXT_LINE,
    SCF1_INPUT_ACK,
    SCF1_INPUT_OTHER_FRAME,
    SCF1_INPUT_BAD_FRAME,
    SCF1_INPUT_BAD_COMMAND,
};

struct Scf1InputEvent {
    Scf1InputType type;
    uint8_t frameType;
    uint32_t sequence;
    char text[96];
};

class Scf1Protocol {
public:
    explicit Scf1Protocol(Stream& stream);

    bool sendFrame(uint8_t type, const uint8_t* payload, uint32_t length);
    bool sendError(const char* message);
    Scf1InputEvent poll();

private:
    enum RxState : uint8_t {
        RX_MAGIC,
        RX_HEADER,
        RX_PAYLOAD,
        RX_CRC,
        RX_DISCARD,
    };

    static constexpr size_t kMaxIncomingPayload = 16;

    Scf1InputEvent consumeTextByte(uint8_t value);
    Scf1InputEvent completeFrame();
    void resetRx();
    bool writeAll(const uint8_t* data, size_t length);

    Stream& stream_;
    RxState rxState_;
    size_t magicIndex_;
    uint8_t header_[5];
    size_t headerIndex_;
    uint8_t payload_[kMaxIncomingPayload];
    uint32_t payloadLength_;
    uint32_t payloadIndex_;
    uint8_t receivedCrc_[4];
    size_t crcIndex_;
    uint32_t discardRemaining_;
    uint32_t lastRxMs_;
    char line_[96];
    size_t lineLength_;
    bool lineOverflow_;
};

#endif
