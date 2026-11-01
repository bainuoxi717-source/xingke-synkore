// Recorder views share the pet's one LVGL instance, screen and backlight.
#include "touch_ui.h"
#include "ghost_ui.h"
#include <stdio.h>

namespace {
uint32_t lastSeconds = 0xFFFFFFFFUL;
size_t lastMarks = static_cast<size_t>(-1);
bool showingRecording = false;
}

bool touchUiBegin(TouchUiAction start, TouchUiAction mark, TouchUiAction stop) {
    ghostUiSetRecorderActions(start, mark, stop);
    return ghostUiBegin();
}

void touchUiShowReady(const char* courseId) {
    showingRecording = false;
    ghostUiRecorderShow(DUAL_READY, courseId, "点击开始，录下整节课");
}

void touchUiShowRecording(uint32_t durationMs, size_t markCount) {
    const uint32_t seconds = durationMs / 1000;
    if (showingRecording && seconds == lastSeconds && markCount == lastMarks) return;
    char duration[20], marks[64];
    snprintf(duration, sizeof(duration), "%02lu:%02lu", static_cast<unsigned long>(seconds / 60), static_cast<unsigned long>(seconds % 60));
    snprintf(marks, sizeof(marks), "已标记 %u 个不懂点", static_cast<unsigned>(markCount));
    ghostUiRecorderShow(DUAL_RECORDING, duration, marks);
    lastSeconds = seconds; lastMarks = markCount; showingRecording = true;
}

void touchUiShowSaving() {
    showingRecording = false;
    ghostUiRecorderShow(DUAL_SAVING, "整理录音文件", "请勿断电或拔出存储卡");
}

void touchUiShowSaved(const char* courseId, size_t markCount) {
    showingRecording = false;
    char marks[64];
    snprintf(marks, sizeof(marks), "已保存 %u 个不懂点", static_cast<unsigned>(markCount));
    ghostUiRecorderShow(DUAL_SAVED, courseId, marks);
}

void touchUiShowSavingProgress(uint32_t copiedBytes, uint32_t totalBytes) {
    char text[48];
    const unsigned percent = totalBytes ? static_cast<unsigned>(static_cast<uint64_t>(copiedBytes) * 100 / totalBytes) : 0;
    snprintf(text, sizeof(text), "进度 %u%%", percent);
    ghostUiRecorderShow(DUAL_SAVING, text, "请勿断电或拔出存储卡");
}

void touchUiShowError(const char* message) {
    showingRecording = false;
    ghostUiRecorderShow(DUAL_ERROR, message, "检查后重试，或返回桌宠");
}

void touchUiShowExporting(const char* courseId) {
    showingRecording = false;
    ghostUiRecorderShow(DUAL_EXPORTING, courseId, "请稍候，回传后可切换");
}

void touchUiPrintStatus() { ghostUiStatus(); }
bool touchUiWake() { return ghostUiSetDisplay(true); }
bool touchUiSleep() { return ghostUiSetDisplay(false); }
bool touchUiIsOn() { return ghostUiDisplayIsOn(); }
