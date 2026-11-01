#include "../firmware/classroom_recorder/uart_protocol.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>
#include <vector>

static uint32_t clockMs = 0;
uint32_t millis() { return clockMs; }

static void require(bool value, const char* message) {
    if (!value) {
        std::fprintf(stderr, "FAIL: %s\n", message);
        std::exit(1);
    }
}

class MemoryStream : public Stream {
public:
    std::deque<uint8_t> input;
    std::vector<uint8_t> output;
    size_t maxWrite = 2;
    int available() override { return static_cast<int>(input.size()); }
    int read() override {
        if (input.empty()) return -1;
        uint8_t value = input.front();
        input.pop_front();
        return value;
    }
    size_t write(const uint8_t* data, size_t length) override {
        size_t count = std::min(length, maxWrite);
        output.insert(output.end(), data, data + count);
        return count;
    }
    void feed(const std::vector<uint8_t>& bytes) {
        input.insert(input.end(), bytes.begin(), bytes.end());
    }
    void feed(const std::string& text) {
        input.insert(input.end(), text.begin(), text.end());
    }
};

static std::vector<Scf1InputEvent> drain(MemoryStream& stream, Scf1Protocol& protocol) {
    std::vector<Scf1InputEvent> events;
    while (stream.available()) {
        auto event = protocol.poll();
        if (event.type != SCF1_INPUT_NONE) events.push_back(event);
    }
    return events;
}

// Fixed vector independently generated with Python zlib.crc32 for ACK seq=42.
static const std::vector<uint8_t> ack42 = {
    0x53, 0x43, 0x46, 0x31, 0x04, 0x04, 0x00, 0x00, 0x00,
    0x2a, 0x00, 0x00, 0x00, 0x02, 0x04, 0x20, 0xf0
};

static void commandTests() {
    MemoryStream stream;
    Scf1Protocol parser(stream);
    const char* commands[] = {
        "PING", "START", "STOP", "STATUS", "LIST", "MARK", "EXPORT course_123",
        "S", "SC", "SCF", "SS", "SCS", "SCFS", "SCOURSE", "CLASS", "ABSC"
    };
    for (const char* command : commands) {
        stream.feed(std::string(command) + "\r\n");
        auto events = drain(stream, parser);
        require(events.size() == 1, "one command event");
        require(events[0].type == SCF1_INPUT_TEXT_LINE, "text command event");
        require(std::strcmp(events[0].text, command) == 0, "command preserves S/SC/SCF prefixes");
    }
    stream.feed(std::string(120, 'S') + "\nPING\n");
    auto events = drain(stream, parser);
    require(events.size() == 2, "overflow and following command both reported");
    require(events[0].type == SCF1_INPUT_BAD_COMMAND, "oversized command rejected");
    require(events[1].type == SCF1_INPUT_TEXT_LINE && std::strcmp(events[1].text, "PING") == 0,
            "command recovery after overflow");
}

static void frameTests() {
    MemoryStream stream;
    Scf1Protocol parser(stream);
    // Deliberately fragment every byte across separate poll cycles.
    for (size_t i = 0; i < ack42.size(); ++i) {
        stream.input.push_back(ack42[i]);
        auto event = parser.poll();
        if (i + 1 == ack42.size())
            require(event.type == SCF1_INPUT_ACK && event.sequence == 42, "known ACK CRC vector");
        else
            require(event.type == SCF1_INPUT_NONE, "partial frame must not emit event");
        require(parser.poll().type == SCF1_INPUT_NONE, "empty poll while receiving");
    }
    auto corrupt = ack42;
    corrupt.back() ^= 1;
    stream.feed(corrupt);
    stream.feed(ack42);
    stream.feed(std::string("STATUS\n"));
    auto events = drain(stream, parser);
    require(events.size() == 3, "bad CRC recovery event count");
    require(events[0].type == SCF1_INPUT_BAD_FRAME, "corrupt CRC rejected");
    require(events[1].type == SCF1_INPUT_ACK && events[1].sequence == 42, "ACK after bad CRC");
    require(std::strcmp(events[2].text, "STATUS") == 0, "command after binary ACK");

    // A stray S must not prevent recognizing the following complete magic.
    stream.feed(std::string("S"));
    stream.feed(ack42);
    stream.feed(std::string("\n"));
    events = drain(stream, parser);
    require(events.size() == 2 && events[0].type == SCF1_INPUT_ACK, "overlapping magic recovery");
    require(events[1].type == SCF1_INPUT_TEXT_LINE && std::strcmp(events[1].text, "S") == 0,
            "stray prefix preserved as text");

    // Incomplete binary payload should time out without poisoning next command.
    stream.feed(std::vector<uint8_t>(ack42.begin(), ack42.begin() + 11));
    require(drain(stream, parser).empty(), "truncated ACK pending");
    clockMs += 1001;
    require(parser.poll().type == SCF1_INPUT_NONE, "timeout resets incomplete frame");
    stream.feed(std::string("START\n"));
    events = drain(stream, parser);
    require(events.size() == 1 && std::strcmp(events[0].text, "START") == 0, "command after timeout");
}

static void oversizedFrameTests() {
    for (uint32_t length : {17u, 65536u, 1024u * 1024u}) {
        MemoryStream stream;
        Scf1Protocol parser(stream);
        std::vector<uint8_t> frame = {'S', 'C', 'F', '1', SCF1_ACK};
        for (int shift = 0; shift < 32; shift += 8) frame.push_back((length >> shift) & 0xff);
        frame.insert(frame.end(), length, 0x53);
        frame.insert(frame.end(), 4, 0);
        stream.feed(frame);
        stream.feed(ack42);
        auto events = drain(stream, parser);
        require(events.size() == 2, "oversized frame drained exactly once");
        require(events[0].type == SCF1_INPUT_BAD_FRAME, "oversized payload rejected");
        require(events[1].type == SCF1_INPUT_ACK && events[1].sequence == 42, "ACK after oversized payload");
    }
}

static void sendTests() {
    MemoryStream stream;
    Scf1Protocol parser(stream);
    const uint8_t sequence[4] = {42, 0, 0, 0};
    require(parser.sendFrame(SCF1_ACK, sequence, 4), "partial writes handled");
    require(stream.output == ack42, "serialized ACK matches independent CRC vector");
    stream.maxWrite = 0;
    require(!parser.sendError("failed"), "zero-length write fails without spinning");
}

int main() {
    commandTests();
    frameTests();
    oversizedFrameTests();
    sendTests();
    std::puts("UART protocol host tests passed (commands, ACK/CRC, fragmentation, overflow, timeout, oversized frames, writes)");
}
