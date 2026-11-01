#include <Arduino.h>
#include "Audio.h"
#include "File.h"
#include "Log.h"
#include "wav_encode.h"
#include "board_config.h"
#include "uart_protocol.h"
#include "exporter.h"
#include "touch_ui.h"
#include "nicemcu_display.h"

// T5 SDK capture otherwise suppresses silent frames, breaking the recording timeline.
extern "C" void tkl_ai_disable_vendor_vad(void);

Audio audio;
// Mount the card after the runtime and board peripherals have initialized.
VFSFILE& storage() {
    static VFSFILE card(SDCARD);
    return card;
}
Scf1Protocol protocol(Serial);

enum RecorderState { IDLE, RECORDING, SAVING };
static RecorderState state = IDLE;
static bool hardwareReady = false;
static TUYA_FILE pcmFile = NULL;
static uint32_t recordStartedMs = 0;
static uint32_t recordedDurationMs = 0;
static bool storageError = false;
static uint32_t recordedBytes = 0;
static volatile uint32_t micCallbackBytes = 0;
static uint32_t markTimes[BoardConfig::kMaxMarks];
static size_t markCount = 0;
static char currentCourseId[32] = "course_001";
static volatile uint8_t pendingTouchAction = 0;  // 1=start, 2=mark, 3=stop
static volatile bool exporting = false;

void makePath(char* output, size_t size, const char* name) {
    snprintf(output, size, "%s/%s/%s", BoardConfig::kCourseRoot, currentCourseId, name);
}

bool writeChecked(const char* data, int count, TUYA_FILE file) {
    const int written = storage().write(data, count, file);
    if (written != count) {
        Serial.print("IO WRITE wanted="); Serial.print(count); Serial.print(" actual="); Serial.println(written);
        storageError = true; return false;
    }
    return true;
}

bool courseHasData() {
    char path[128];
    const char* names[] = {"audio.wav", "audio.pcm", "marks.json", "meta.json"};
    for (const char* name : names) {
        makePath(path, sizeof(path), name);
        if (storage().exist(path) > 0) return true;
    }
    return false;
}

void drainAudioToFile() {
    if (!pcmFile) return;
    uint8_t buffer[BoardConfig::kAudioIoBufferBytes];
    uint32_t available = audio.getRecordedDataLen();
    while (available && pcmFile) {
        const uint32_t wanted = available > sizeof(buffer) ? sizeof(buffer) : available;
        const uint32_t count = audio.readRecordedData(buffer, wanted);
        if (!count) break;
        if (!writeChecked(reinterpret_cast<const char*>(buffer), count, pcmFile)) break;
        recordedBytes += count;
        available = audio.getRecordedDataLen();
    }
}

bool createWavFromPcm() {
    char pcmPath[128], wavPath[128];
    makePath(pcmPath, sizeof(pcmPath), "audio.pcm");
    makePath(wavPath, sizeof(wavPath), "audio.wav");
    const int pcmSize = storage().filesize(pcmPath);
    Serial.print("WAV PCM_SIZE="); Serial.print(pcmSize);
    Serial.print(" RECORDED="); Serial.print(recordedBytes);
    Serial.print(" CALLBACK="); Serial.println(micCallbackBytes);
    if (pcmSize <= 0) return false;
    TUYA_FILE pcm = storage().open(pcmPath, "r");
    TUYA_FILE wav = storage().open(wavPath, "w");
    if (!pcm || !wav) {
        Serial.println("WAV OPEN FAILED");
        if (pcm) storage().close(pcm);
        if (wav) storage().close(wav);
        return false;
    }
    uint8_t header[WAV_HEAD_LEN];
    app_get_wav_head(pcmSize, BoardConfig::kChannels, BoardConfig::kSampleRate,
                     BoardConfig::kBitsPerSample, 1, header);
    bool ok = writeChecked(reinterpret_cast<const char*>(header), WAV_HEAD_LEN, wav);
    uint8_t buffer[1024];
    int copied = 0;
    while (ok && copied < pcmSize) {
        int count = storage().read(reinterpret_cast<char*>(buffer), sizeof(buffer), pcm);
        if (count <= 0) { ok = false; break; }
        ok = writeChecked(reinterpret_cast<const char*>(buffer), count, wav);
        copied += count;
        delay(1);  // WAV finalization must not starve the display task.
    }
    storage().flush(wav);
    storage().close(pcm);
    const int closeResult = storage().close(wav);
    if (closeResult != 0) ok = false;
    const int wavSize = storage().filesize(wavPath);
    Serial.print("WAV COPIED="); Serial.print(copied); Serial.print(" SIZE="); Serial.print(wavSize);
    Serial.print(" CLOSE="); Serial.print(closeResult); Serial.print(" OK="); Serial.println(ok ? 1 : 0);
    return ok && copied == pcmSize && wavSize == pcmSize + WAV_HEAD_LEN;
}

bool writeJsonFiles(uint32_t durationMs) {
    char path[128];
    makePath(path, sizeof(path), "marks.json");
    TUYA_FILE file = storage().open(path, "w");
    if (file) {
        char buffer[160];
        int offset = snprintf(buffer, sizeof(buffer), "{\"marks\":[");
        writeChecked(buffer, offset, file);
        for (size_t i = 0; i < markCount; ++i) {
            offset = snprintf(buffer, sizeof(buffer), "%s{\"time_ms\":%lu,\"type\":\"confused\"}",
                              i ? "," : "", static_cast<unsigned long>(markTimes[i]));
            writeChecked(buffer, offset, file);
        }
        writeChecked("]}", 2, file);
        storage().flush(file);
        if (storage().close(file) != 0) storageError = true;
    } else return false;
    makePath(path, sizeof(path), "meta.json");
    file = storage().open(path, "w");
    if (file) {
        char buffer[256];
        int length = snprintf(buffer, sizeof(buffer),
            "{\"title\":\"%s\",\"audio_duration_ms\":%lu,\"sample_rate\":%lu,\"channels\":%u}",
            currentCourseId, static_cast<unsigned long>(durationMs),
            static_cast<unsigned long>(BoardConfig::kSampleRate), BoardConfig::kChannels);
        writeChecked(buffer, length, file);
        storage().flush(file);
        if (storage().close(file) != 0) storageError = true;
    } else return false;
    return !storageError;
}

void startRecording() {
    if (!hardwareReady) {
        protocol.sendError("Hardware not ready; check boot diagnostics and restart");
        return;
    }
    if (state != IDLE) return;
    char path[128];
    makePath(path, sizeof(path), "audio.wav");
    uint32_t courseNumber = 1;
    while (courseHasData() && courseNumber < 999) {
        ++courseNumber;
        snprintf(currentCourseId, sizeof(currentCourseId), "course_%03lu",
                 static_cast<unsigned long>(courseNumber));
        makePath(path, sizeof(path), "audio.wav");
    }
    if (courseHasData()) {
        protocol.sendError("No free course number");
        touchUiShowError("课程编号已满");
        return;
    }
    char courseDir[128];
    snprintf(courseDir, sizeof(courseDir), "%s/%s", BoardConfig::kCourseRoot, currentCourseId);
    if (!storage().exist(courseDir)) storage().mkdir(courseDir);
    storageError = false;
    recordedBytes = 0;
    micCallbackBytes = 0;
    makePath(path, sizeof(path), "audio.pcm");
    pcmFile = storage().open(path, "w");
    if (!pcmFile) {
        protocol.sendError("Cannot open audio.pcm");
        touchUiShowError("无法创建录音文件");
        return;
    }
    markCount = 0;
    recordStartedMs = millis();
    audio.clearRecordedData();
    if (audio.startRecord() != OPRT_OK) {
        storage().close(pcmFile);
        pcmFile = NULL;
        protocol.sendError("Microphone failed to start");
        touchUiShowError("麦克风启动失败");
        return;
    }
    state = RECORDING;
    touchUiShowRecording(0, 0);
    Serial.print("STATE RECORDING ");
    Serial.println(currentCourseId);
    PR_NOTICE("Recording %s", currentCourseId);
}

void stopRecording() {
    if (state != RECORDING) return;
    audio.stopRecord();
    recordedDurationMs = millis() - recordStartedMs;
    state = SAVING;
    touchUiShowSaving();
    Serial.print("STATE SAVING\n");
}

void markConfused() {
    if (state != RECORDING || markCount >= BoardConfig::kMaxMarks) return;
    markTimes[markCount++] = millis() - recordStartedMs;
    Serial.print("MARK ");
    Serial.print(markCount);
    Serial.print(" ");
    Serial.println(static_cast<unsigned long>(markTimes[markCount - 1]));
}

void requestStart() { if (!exporting) pendingTouchAction = 1; }
void requestMark() { if (!exporting) pendingTouchAction = 2; }
void requestStop() { if (!exporting) pendingTouchAction = 3; }

void pollScreenButton() {
    static bool rawDown = false;
    static bool down = false;
    static bool armed = false;
    static bool longHandled = false;
    static uint32_t rawChangedMs = 0;
    static uint32_t pressedMs = 0;
    const uint32_t now = millis();
    const bool pressed = digitalRead(BoardConfig::kScreenButtonPin) == LOW;
    if (pressed != rawDown) { rawDown = pressed; rawChangedMs = now; }
    if (now - rawChangedMs < BoardConfig::kButtonDebounceMs) return;
    // Require a release after power-up so a held boot strap is never an action.
    if (!armed) { if (!pressed) armed = true; return; }
    if (pressed != down) {
        down = pressed;
        if (down) { pressedMs = now; longHandled = false; }
        else if (!longHandled) {
            if (touchUiIsOn()) { touchUiSleep(); Serial.println("BUTTON DISPLAY OFF"); }
            else { touchUiWake(); Serial.println("BUTTON DISPLAY ON"); }
        }
    }
    if (down && !longHandled && now - pressedMs >= BoardConfig::kScreenRedrawHoldMs) {
        longHandled = true;
        touchUiWake();
        Serial.println("BUTTON DISPLAY REDRAW");
    }
}

void finishRecording() {
    drainAudioToFile();
    if (pcmFile) {
        storage().flush(pcmFile);
        const int closeResult = storage().close(pcmFile);
        Serial.print("PCM CLOSE="); Serial.print(closeResult); Serial.print(" BYTES="); Serial.println(recordedBytes);
        if (closeResult != 0) storageError = true;
        pcmFile = NULL;
    }
    const uint32_t duration = recordedDurationMs;
    if (!storageError && createWavFromPcm() && writeJsonFiles(duration)) {
        touchUiShowSaved(currentCourseId, markCount);
        Serial.print("STATE SAVED ");
        Serial.print(currentCourseId);
        Serial.print(" MARKS ");
        Serial.println(markCount);
        char pcmPath[128];
        makePath(pcmPath, sizeof(pcmPath), "audio.pcm");
        storage().remove(pcmPath);
        PR_NOTICE("Saved course with %u marks", markCount);
    } else {
        protocol.sendError("Failed to finalize WAV");
        touchUiShowError("录音保存失败");
    }
    audio.clearRecordedData();
    state = IDLE;
}

void handleTextCommand(const char* command) {
    if (strcmp(command, "PING") == 0) {
        Serial.print("PONG\n");
    } else if (strcmp(command, "STATUS") == 0) {
        Serial.print("STATUS READY=");
        Serial.print(hardwareReady ? 1 : 0);
        Serial.print(" STATE=");
        Serial.print(state == RECORDING ? "RECORDING" : (state == SAVING ? "SAVING" : "IDLE"));
        Serial.print(" COURSE=");
        Serial.print(currentCourseId);
        Serial.print(" MARKS=");
        Serial.print(markCount);
        Serial.print(" PCM_BYTES="); Serial.print(recordedBytes);
        Serial.print(" MIC_CALLBACK_BYTES="); Serial.println(micCallbackBytes);
        Serial.print("UPTIME_MS="); Serial.println(millis());
        touchUiPrintStatus();
    } else if (strcmp(command, "DISPLAY ON") == 0) {
        Serial.println(touchUiWake() ? "DISPLAY ON" : "DISPLAY NOT READY");
    } else if (strcmp(command, "DISPLAY OFF") == 0) {
        Serial.println(touchUiSleep() ? "DISPLAY OFF" : "DISPLAY NOT READY");
    } else if (strcmp(command, "DISPLAY REDRAW") == 0) {
        Serial.println(touchUiWake() ? "DISPLAY REDRAW" : "DISPLAY NOT READY");
    } else if (strcmp(command, "START") == 0) {
        startRecording();
    } else if (strcmp(command, "MARK") == 0) {
        markConfused();
    } else if (strcmp(command, "STOP") == 0) {
        stopRecording();
    } else if (strcmp(command, "LIST") == 0) {
        Serial.print("COURSE ");
        Serial.println(currentCourseId);
    } else {
        if (strncmp(command, "EXPORT ", 7) == 0) {
            const char* courseId = command + 7;
            bool valid = strlen(courseId) == 10 && strncmp(courseId, "course_", 7) == 0;
            for (size_t i = 7; valid && i < 10; ++i) valid = courseId[i] >= '0' && courseId[i] <= '9';
            if (!valid) { protocol.sendError("Invalid course id"); return; }
            if (state != IDLE) protocol.sendError("Stop recording before export");
            else if (!hardwareReady) protocol.sendError("Hardware not ready");
            else {
                exporting = true;
                pendingTouchAction = 0;
                touchUiShowExporting(courseId);
                exportCoursePackage(storage(), protocol, courseId);
                exporting = false;
                char wavPath[128];
                makePath(wavPath, sizeof(wavPath), "audio.wav");
                if (storage().exist(wavPath)) touchUiShowSaved(currentCourseId, markCount);
                else touchUiShowReady(currentCourseId);
            }
        } else {
            protocol.sendError("Unknown command");
        }
    }
}

void onAudioFrame(uint8_t*, uint32_t length) { micCallbackBytes += length; }

void setup() {
    Serial.begin(BoardConfig::kSerialBaud);
    Log.begin();
    pinMode(BoardConfig::kScreenButtonPin, INPUT_PULLUP);
    Serial.print("BOOT ZHILIU_T5_REPRO_20261101_LANDSCAPE\n");
    if (OPRT_OK != board_register_hardware()) {
        protocol.sendError("Board hardware registration failed");
        return;
    }
    if (!nicemcuDisplayRegister()) {
        protocol.sendError("Display or touch registration failed");
        return;
    }
    Serial.print("BOOT DISPLAY_REGISTERED\n");
    if (!touchUiBegin(requestStart, requestMark, requestStop)) {
        protocol.sendError("Touch UI initialization failed");
        return;
    }
    Serial.print("BOOT UI_STARTED\n");

    AudioConfig config;
    config.micBufferSize = BoardConfig::kMicRingBufferBytes;
    config.volume = BoardConfig::kMicVolume;
    tkl_ai_disable_vendor_vad();
    if (audio.begin(&config) != 0) {
        protocol.sendError("Audio initialization failed");
        touchUiShowError("麦克风初始化失败");
        return;
    }
    Serial.print("BOOT AUDIO_READY\n");
    audio.setAudioFrameCallback(onAudioFrame);
    if (!nicemcuStorageConfigure()) {
        protocol.sendError("SDIO pin configuration failed");
        touchUiShowError("存储卡初始化失败");
        return;
    }
    Serial.print("BOOT SD_MOUNT_BEGIN\n");
    if (!storage().exist("/")) {
        protocol.sendError("SD card not mounted");
        touchUiShowError("未检测到存储卡");
        return;
    }
    if (!storage().exist(BoardConfig::kCourseRoot)) storage().mkdir(BoardConfig::kCourseRoot);
    char courseDir[128];
    snprintf(courseDir, sizeof(courseDir), "%s/%s", BoardConfig::kCourseRoot, currentCourseId);
    if (!storage().exist(courseDir)) storage().mkdir(courseDir);
    if (storage().exist(courseDir) <= 0) {
        protocol.sendError("SD card directory creation failed");
        touchUiShowError("存储卡目录创建失败");
        return;
    }
    hardwareReady = true;
    touchUiShowReady(currentCourseId);
    Serial.print("READY ZHILIU_T5_REPRO_20261101\n");
    PR_NOTICE("Ready: touch start/mark/stop; EXPORT via UART");
}

void loop() {
    pollScreenButton();
    if (pendingTouchAction) {
        const uint8_t action = pendingTouchAction;
        pendingTouchAction = 0;
        if (action == 1) startRecording();
        else if (action == 2) markConfused();
        else if (action == 3) stopRecording();
    }
    if (state == RECORDING) {
        drainAudioToFile();
        if (storageError) { stopRecording(); return; }
        static uint32_t lastUiUpdate = 0;
        if (millis() - lastUiUpdate >= 250) {
            lastUiUpdate = millis();
            touchUiShowRecording(millis() - recordStartedMs, markCount);
        }
        if (millis() - recordStartedMs >= BoardConfig::kMaxRecordMs) stopRecording();
    } else if (state == SAVING) {
        finishRecording();
    }
    Scf1InputEvent event = protocol.poll();
    if (event.type == SCF1_INPUT_TEXT_LINE) handleTextCommand(event.text);
    delay(5);
}
