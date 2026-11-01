#include <Arduino.h>
#include "Log.h"
#include "board_com_api.h"
#include "nicemcu_display.h"
#include "ghost_ui.h"

namespace {
constexpr uint8_t kButton = 8;  // BOOT/user button; RST still resets the board.
constexpr uint32_t kBaud = 921600;
bool ready = false;
char command[80];
size_t commandLength = 0;
bool commandOverflow = false;

void screenButton() {
    static bool rawDown = false, down = false, armed = false, longHandled = false;
    static uint32_t changedMs = 0, pressedMs = 0;
    const uint32_t now = millis();
    const bool pressed = digitalRead(kButton) == LOW;
    if (pressed != rawDown) { rawDown = pressed; changedMs = now; }
    if (now - changedMs < 40) return;
    if (!armed) { if (!pressed) armed = true; return; }
    if (pressed != down) {
        down = pressed;
        if (down) { pressedMs = now; longHandled = false; }
        else if (!longHandled) {
            ghostUiSetDisplay(!ghostUiDisplayIsOn());
            Serial.println(ghostUiDisplayIsOn() ? "BUTTON DISPLAY ON" : "BUTTON DISPLAY OFF");
        }
    }
    if (down && !longHandled && now - pressedMs >= 1500) {
        longHandled = true;
        ghostUiSetDisplay(true);
        Serial.println("BUTTON DISPLAY REDRAW");
    }
}

void dispatch(const char* text) {
    if (!strcmp(text, "PING")) Serial.println("PONG GHOST_T5_V1");
    else if (!strcmp(text, "STATUS")) {
        Serial.print("STATUS READY="); Serial.print(ready ? 1 : 0);
        Serial.print(" APP=GHOST_T5_V1 UPTIME_MS="); Serial.println(millis());
        ghostUiStatus();
    } else if (!ready) Serial.println("ERROR DISPLAY NOT READY");
    else if (!strcmp(text, "SNAPSHOT")) ghostUiSnapshot();
    else ghostUiCommand(text);
}
}

void setup() {
    Serial.begin(kBaud);
    Log.begin();
    pinMode(kButton, INPUT_PULLUP);
    Serial.println("BOOT GHOST_T5_V1 OFFLINE LANDSCAPE");
    // This application never mounts or writes the TF card, and never opens audio
    // or network services. The existing course files remain on the card.
    if (board_register_hardware() != OPRT_OK || !nicemcuDisplayRegister()) {
        Serial.println("ERROR BOARD REGISTRATION");
        return;
    }
    ready = ghostUiBegin();
    Serial.println(ready ? "READY GHOST_T5_V1 320x240" : "ERROR GHOST UI");
}

void loop() {
    if (ready) { screenButton(); ghostUiPoll(); }
    // Bound each iteration so a noisy serial host cannot starve button polling.
    for (unsigned i = 0; i < 96 && Serial.available(); ++i) {
        const char ch = static_cast<char>(Serial.read());
        if (ch == '\r') continue;
        if (ch == '\n') {
            if (commandOverflow) Serial.println("ERROR COMMAND TOO LONG");
            else if (commandLength) { command[commandLength] = 0; dispatch(command); }
            commandLength = 0;
            commandOverflow = false;
        } else if (commandLength + 1 < sizeof(command)) command[commandLength++] = ch;
        else commandOverflow = true;
    }
    delay(5);
}
