#pragma once

// Fixed-size monochrome cards. Main-thread receiver; LVGL commits atomically.
bool classroomScreenCommand(const char* command);
bool classroomScreenReceiving();
