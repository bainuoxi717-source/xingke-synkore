#ifndef CLASSROOM_RECORDER_TOUCH_UI_H
#define CLASSROOM_RECORDER_TOUCH_UI_H

#include <stddef.h>
#include <stdint.h>

typedef void (*TouchUiAction)(void);

bool touchUiBegin(TouchUiAction onStart, TouchUiAction onMark, TouchUiAction onStop);
void touchUiShowReady(const char* courseId);
void touchUiShowRecording(uint32_t durationMs, size_t markCount);
void touchUiShowSaving();
void touchUiShowSaved(const char* courseId, size_t markCount);
void touchUiShowError(const char* message);
void touchUiPrintStatus();
bool touchUiWake();
bool touchUiSleep();
bool touchUiIsOn();
void touchUiShowExporting(const char* courseId);

#endif
