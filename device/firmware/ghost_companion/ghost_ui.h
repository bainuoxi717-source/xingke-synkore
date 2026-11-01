#pragma once

bool ghostUiBegin();
void ghostUiPoll();
void ghostUiCommand(const char* command);
void ghostUiStatus();
bool ghostUiSetDisplay(bool on);
bool ghostUiDisplayIsOn();
void ghostUiSnapshot();
