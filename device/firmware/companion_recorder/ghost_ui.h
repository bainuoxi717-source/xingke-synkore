#pragma once
#include <stdint.h>

using GhostUiAction = void (*)(void);
enum RecorderView { DUAL_READY, DUAL_RECORDING, DUAL_SAVING, DUAL_SAVED, DUAL_ERROR, DUAL_PREPARING, DUAL_EXPORTING };

bool ghostUiBegin();
void ghostUiPoll();
void ghostUiCommand(const char* command);
void ghostUiStatus();
bool ghostUiSetDisplay(bool on);
bool ghostUiDisplayIsOn();
void ghostUiSnapshot();
void ghostUiSetModeActions(GhostUiAction openRecorder, GhostUiAction returnPet);
void ghostUiSetRecorderActions(GhostUiAction start, GhostUiAction mark, GhostUiAction stop);
void ghostUiRecorderShow(RecorderView view, const char* info, const char* detail);
void ghostUiShowPet(const char* text = nullptr);
bool ghostUiInRecorder();
bool ghostUiInClassroom();
bool ghostUiShowClassroomCard(const uint8_t* bitmap, uint32_t frameId);
