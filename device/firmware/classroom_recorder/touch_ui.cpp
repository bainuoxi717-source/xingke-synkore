#include "touch_ui.h"

#include <Arduino.h>
#include <stdio.h>
#include <string.h>

#include "lvgl.h"
#include "lv_vendor.h"
#include "lv_port_disp.h"
#include "lv_port_indev.h"
#include "tkl_gpio.h"

LV_FONT_DECLARE(lv_font_simsun_16_cjk);

namespace {
TouchUiAction startAction = nullptr;
TouchUiAction markAction = nullptr;
TouchUiAction stopAction = nullptr;
lv_obj_t* titleLabel = nullptr;
lv_obj_t* statusLabel = nullptr;
lv_obj_t* infoLabel = nullptr;
lv_obj_t* marksLabel = nullptr;
lv_obj_t* startButton = nullptr;
lv_obj_t* markButton = nullptr;
lv_obj_t* stopButton = nullptr;
lv_obj_t* startText = nullptr;
bool initialized = false;
bool screenOn = true;
uint32_t flushCount = 0;

void onDisplayFlushed(lv_event_t*) { ++flushCount; }

void wakeDisplayLocked() {
    lv_display_t* display = lv_display_get_default();
    disp_set_backlight(display, screenOn ? 100 : 0);
    if (screenOn) lv_display_trigger_activity(display);
}

void setTextFont(lv_obj_t* object, bool large = false) {
    lv_obj_set_style_text_font(object, large ? &lv_font_montserrat_24 : &lv_font_simsun_16_cjk, 0);
}

lv_obj_t* makeLabel(lv_obj_t* parent, const char* text, lv_coord_t y, bool large = false) {
    lv_obj_t* label = lv_label_create(parent);
    lv_label_set_text(label, text);
    lv_obj_set_style_text_color(label, lv_color_hex(0x17202A), 0);
    setTextFont(label, large);
    lv_obj_align(label, LV_ALIGN_TOP_MID, 0, y);
    return label;
}

lv_obj_t* makeButton(lv_obj_t* parent, const char* text, lv_coord_t x, lv_coord_t y,
                     lv_coord_t width, lv_coord_t height, uint32_t color, lv_event_cb_t callback,
                     lv_obj_t** labelOut) {
    lv_obj_t* button = lv_button_create(parent);
    lv_obj_set_size(button, width, height);
    lv_obj_align(button, LV_ALIGN_TOP_LEFT, x, y);
    lv_obj_set_style_bg_color(button, lv_color_hex(color), 0);
    lv_obj_set_style_radius(button, 14, 0);
    lv_obj_add_event_cb(button, callback, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* label = lv_label_create(button);
    lv_label_set_text(label, text);
    lv_obj_set_style_text_color(label, lv_color_white(), 0);
    setTextFont(label);
    lv_obj_center(label);
    *labelOut = label;
    return button;
}

void onStartClicked(lv_event_t*) {
    if (!screenOn) return;
    if (startAction) startAction();
}

void onMarkClicked(lv_event_t*) {
    if (!screenOn) return;
    if (markAction) markAction();
}

void onStopClicked(lv_event_t*) {
    if (!screenOn) return;
    if (stopAction) stopAction();
}

void hideActions() {
    lv_obj_add_flag(startButton, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(markButton, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(stopButton, LV_OBJ_FLAG_HIDDEN);
}

void formatDuration(char* output, size_t size, uint32_t durationMs) {
    const uint32_t seconds = durationMs / 1000;
    snprintf(output, size, "%02lu:%02lu", static_cast<unsigned long>(seconds / 60),
             static_cast<unsigned long>(seconds % 60));
}
}

bool touchUiBegin(TouchUiAction onStart, TouchUiAction onMark, TouchUiAction onStop) {
    startAction = onStart;
    markAction = onMark;
    stopAction = onStop;
    static char displayName[] = "display";
    lv_vendor_init(displayName);
    // lv_vendor_init returns void even if opening the display failed.
    // Check the resulting device before using the active screen.
    lv_display_t* display = lv_port_get_lv_disp_by_name(displayName);
    if (!display || !lv_screen_active()) {
        Serial.println("DISPLAY ERROR LVGL display open failed");
        return false;
    }
    if (!lv_port_get_lv_indev_by_name(displayName)) {
        Serial.println("TOUCH ERROR LVGL input device open failed");
        return false;
    }
    lv_vendor_disp_lock();
    if (lv_display_get_horizontal_resolution(display) != 320 ||
        lv_display_get_vertical_resolution(display) != 240) {
        lv_vendor_disp_unlock();
        Serial.println("DISPLAY ERROR expected landscape 320x240");
        return false;
    }
    lv_display_add_event_cb(display, onDisplayFlushed, LV_EVENT_FLUSH_FINISH, nullptr);
    wakeDisplayLocked();
    lv_obj_t* screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(0xF4F7FB), 0);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    titleLabel = makeLabel(screen, "知流课堂", 12);
    statusLabel = makeLabel(screen, "正在准备", 42);
    infoLabel = makeLabel(screen, "", 74);
    marksLabel = makeLabel(screen, "", 106);
    startButton = makeButton(screen, "开始录音", 16, 145, 288, 72, 0x2563EB, onStartClicked, &startText);
    lv_obj_t* markText = nullptr;
    lv_obj_t* stopText = nullptr;
    markButton = makeButton(screen, "标记不懂", 16, 145, 140, 72, 0xD97706, onMarkClicked, &markText);
    stopButton = makeButton(screen, "停止保存", 164, 145, 140, 72, 0xDC2626, onStopClicked, &stopText);
    hideActions();
    lv_vendor_disp_unlock();
    lv_vendor_start(5, 1024 * 10);
    Serial.println("DISPLAY LVGL READY 320x240 LANDSCAPE ROTATION=90");
    initialized = true;
    return true;
}

void touchUiPrintStatus() {
    if (!initialized) { Serial.println("DISPLAY INITIALIZED=0"); return; }
    TUYA_GPIO_LEVEL_E level = TUYA_GPIO_LEVEL_LOW;
    const OPERATE_RET readResult = tkl_gpio_read(TUYA_GPIO_NUM_9, &level);
    lv_vendor_disp_lock();
    const uint32_t inactiveMs = lv_display_get_inactive_time(lv_display_get_default());
    const uint32_t flushes = flushCount;
    const int width = lv_display_get_horizontal_resolution(lv_display_get_default());
    const int height = lv_display_get_vertical_resolution(lv_display_get_default());
    const int rotation = static_cast<int>(lv_display_get_rotation(lv_display_get_default()));
    lv_vendor_disp_unlock();
    Serial.print("DISPLAY INITIALIZED=1 BL_READ="); Serial.print(readResult);
    Serial.print(" ON="); Serial.print(screenOn ? 1 : 0);
    Serial.print(" BL_LEVEL="); Serial.print(static_cast<int>(level));
    Serial.print(" INACTIVE_MS="); Serial.print(inactiveMs);
    Serial.print(" FLUSHES="); Serial.println(flushes);
    Serial.print("DISPLAY SIZE="); Serial.print(width); Serial.print("x"); Serial.print(height);
    Serial.print(" ROTATION="); Serial.println(rotation);
}

bool touchUiWake() {
    if (!initialized) return false;
    lv_vendor_disp_lock();
    screenOn = true;
    wakeDisplayLocked();
    disp_enable_update(lv_display_get_default());
    lv_obj_invalidate(lv_screen_active());
    lv_vendor_disp_unlock();
    return true;
}

bool touchUiSleep() {
    if (!initialized) return false;
    lv_vendor_disp_lock();
    screenOn = false;
    disp_set_backlight(lv_display_get_default(), 0);
    lv_vendor_disp_unlock();
    return true;
}

bool touchUiIsOn() { return initialized && screenOn; }

void touchUiShowExporting(const char* courseId) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "正在回传");
    lv_label_set_text(infoLabel, courseId);
    lv_label_set_text(marksLabel, "请稍候");
    lv_vendor_disp_unlock();
}

void touchUiShowReady(const char* courseId) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "准备就绪");
    lv_label_set_text(infoLabel, courseId);
    lv_label_set_text(marksLabel, "点击开始，录下整节课");
    lv_label_set_text(startText, "开始录音");
    lv_obj_remove_flag(startButton, LV_OBJ_FLAG_HIDDEN);
    lv_vendor_disp_unlock();
}

void touchUiShowRecording(uint32_t durationMs, size_t markCount) {
    if (!initialized) return;
    char duration[16];
    char marks[48];
    formatDuration(duration, sizeof(duration), durationMs);
    snprintf(marks, sizeof(marks), "已标记 %u 个不懂点", static_cast<unsigned>(markCount));
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "正在录音");
    lv_label_set_text(infoLabel, duration);
    lv_label_set_text(marksLabel, marks);
    lv_obj_remove_flag(markButton, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(stopButton, LV_OBJ_FLAG_HIDDEN);
    lv_vendor_disp_unlock();
}

void touchUiShowSaving() {
    if (!initialized) return;
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "正在保存");
    lv_label_set_text(infoLabel, "请稍候");
    lv_label_set_text(marksLabel, "不要断电或拔出存储卡");
    lv_vendor_disp_unlock();
}

void touchUiShowSaved(const char* courseId, size_t markCount) {
    if (!initialized) return;
    char marks[48];
    snprintf(marks, sizeof(marks), "保存 %u 个不懂点", static_cast<unsigned>(markCount));
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "保存成功");
    lv_label_set_text(infoLabel, courseId);
    lv_label_set_text(marksLabel, marks);
    lv_label_set_text(startText, "再录一节");
    lv_obj_remove_flag(startButton, LV_OBJ_FLAG_HIDDEN);
    lv_vendor_disp_unlock();
}

void touchUiShowError(const char* message) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    wakeDisplayLocked();
    hideActions();
    lv_label_set_text(statusLabel, "操作失败");
    lv_label_set_text(infoLabel, message);
    lv_label_set_text(marksLabel, "请检查存储卡后重试");
    lv_label_set_text(startText, "重新尝试");
    lv_obj_remove_flag(startButton, LV_OBJ_FLAG_HIDDEN);
    lv_vendor_disp_unlock();
}
