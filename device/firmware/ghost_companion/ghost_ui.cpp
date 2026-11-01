#include "ghost_ui.h"

#include <Arduino.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "lvgl.h"
#include "lv_vendor.h"
#include "lv_port_disp.h"
#include "lv_port_indev.h"
#include "tal_system.h"
#include "tal_memory.h"

LV_FONT_DECLARE(lv_font_ghost_16);

namespace {
enum Mood : uint8_t { CALM, HAPPY, SHY, SURPRISE, SLEEPY, LOVE, CURIOUS, GRUMPY, MOOD_COUNT };
const char* const kMoodNames[] = {"CALM", "HAPPY", "SHY", "SURPRISE", "SLEEPY", "LOVE", "CURIOUS", "GRUMPY"};
const char* const kMoodLabels[] = {"陪着你", "开心", "害羞", "惊讶", "困困", "喜欢你", "好奇", "小傲娇"};
const char* const kMoodPhrases[] = {
    "不用说话，我也在。", "见到你就很开心！", "被你发现我在偷笑了。", "哇，发生什么好事啦？",
    "我眯一会儿，你忙你的。", "再摸摸头嘛。", "让我看看你在忙什么。", "哼，摸摸头就原谅你。"
};
const char* const kPhrases[] = {
    "今天也很高兴见到你。", "慢慢来，我陪着你。", "喝口水，休息一下吧。", "不用一直很厉害。",
    "你忙你的，我在这里。", "做完一小步也值得开心。", "伸个懒腰，放松一下。", "今天已经很努力啦。",
    "有什么小事让你开心？", "想发呆的话，一起呀。", "给你一个小小的拥抱。", "记得照顾好自己。"
};
constexpr uint32_t BG = 0x192C28, PANEL = 0x263D36, TEXT = 0xEEEFE4;
constexpr uint32_t MUTED = 0xA9BCAF, ACCENT = 0xB7D6AC, INK = 0x34443F;
constexpr uint32_t BODY = 0xF2F0E7, FACE = 0xE4E7DF, BLUSH = 0xE9B3A7;
constexpr uint32_t kIdleSleepMs = 10UL * 60UL * 1000UL;
constexpr uint32_t kFrameMs = 50;

lv_obj_t *character = nullptr, *caption = nullptr, *moodLabel = nullptr, *sleepLabel = nullptr;
lv_obj_t* bubble = nullptr;
lv_display_t* display = nullptr;
lv_timer_t* animationTimer = nullptr;
bool initialized = false, screenOn = true;
Mood mood = CALM;
uint32_t moodUntil = 0, lastInteractionMs = 0, nextIdleMs = 0;
uint32_t blinkStart = 0, nextBlink = 1800, hugUntil = 0;
uint32_t frames = 0, flushes = 0, touches = 0, actions = 0;
uint32_t pressedMs = 0;
lv_point_t pressPoint = {0, 0}, currentPoint = {0, 0};
bool pressing = false, holdHandled = false, wakeOnly = false;
uint8_t phraseIndex = 0;
float phase = 0, blink = 1;
int gazeX = 0, gazeY = 0;
uint32_t rng = 0x138AD325;
struct ActionEvent { const char* source; Mood value; uint32_t count; };
ActionEvent actionQueue[8];
uint8_t queueRead = 0, queueWrite = 0;
bool snapshotRequested = false;
lv_draw_buf_t* snapshotResult = nullptr;

bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }
uint32_t randomBelow(uint32_t maximum) {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return maximum ? rng % maximum : 0;
}

void rect(lv_layer_t* layer, int x, int y, int w, int h, int radius, uint32_t color,
          lv_opa_t opacity = LV_OPA_COVER, int border = 0, uint32_t borderColor = INK) {
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = lv_color_hex(color); d.bg_opa = opacity; d.radius = radius;
    d.border_width = border; d.border_color = lv_color_hex(borderColor);
    d.border_opa = opacity;
    lv_area_t a = {x, y, x + w - 1, y + h - 1};
    lv_draw_rect(layer, &d, &a);
}

void line(lv_layer_t* layer, int x1, int y1, int x2, int y2, int width, uint32_t color,
          lv_opa_t opacity = LV_OPA_COVER) {
    lv_draw_line_dsc_t d;
    lv_draw_line_dsc_init(&d);
    d.p1.x = x1; d.p1.y = y1; d.p2.x = x2; d.p2.y = y2;
    d.width = width; d.color = lv_color_hex(color); d.opa = opacity;
    d.round_start = 1; d.round_end = 1;
    lv_draw_line(layer, &d);
}

void curve(lv_layer_t* layer, int x, int y, int width, int depth, int stroke, uint32_t color) {
    int px = x, py = y;
    for (int i = 1; i <= 8; ++i) {
        const int nx = x + width * i / 8;
        const int ny = y + depth * i * (8 - i) / 16;
        line(layer, px, py, nx, ny, stroke, color);
        px = nx; py = ny;
    }
}

void heart(lv_layer_t* layer, int x, int y, int size, uint32_t color) {
    const int r = size / 2;
    rect(layer, x, y, r + 1, r + 1, r, color);
    rect(layer, x + r - 1, y, r + 1, r + 1, r, color);
    lv_draw_triangle_dsc_t d;
    lv_draw_triangle_dsc_init(&d);
    d.bg_color = lv_color_hex(color); d.bg_opa = LV_OPA_COVER;
    d.p[0].x = x; d.p[0].y = y + r / 2;
    d.p[1].x = x + size; d.p[1].y = y + r / 2;
    d.p[2].x = x + r; d.p[2].y = y + size;
    lv_draw_triangle(layer, &d);
}

void sparkle(lv_layer_t* layer, int x, int y, int size, uint32_t color) {
    line(layer, x - size, y, x + size, y, 2, color);
    line(layer, x, y - size, x, y + size, 2, color);
}

void drawGhost(lv_event_t* e) {
    lv_layer_t* layer = lv_event_get_layer(e);
    lv_area_t a;
    lv_obj_get_coords(character, &a);
    const bool hugging = !due(millis(), hugUntil);
    int bob = static_cast<int>(sinf(phase) * (mood == SLEEPY ? 2.0f : 3.0f));
    int sway = mood == HAPPY ? static_cast<int>(sinf(phase * 2) * 3) : 0;
    int x = a.x1 + 28 + sway, y = a.y1 + 6 + bob;
    if (hugging) y -= static_cast<int>(fabsf(sinf(phase * 3)) * 4);
    // Fixed shadow, rounded shoulders and four scallops echo the supplied ghost.
    rect(layer, a.x1 + 51, a.y1 + 126, 94, 7, LV_RADIUS_CIRCLE, 0x081B17, 150);
    const int handLift = hugging || mood == HAPPY ? 8 : 0;
    rect(layer, x - 3, y + 66 - handLift, 22, 30, 11, BODY);
    rect(layer, x + 129, y + 66 - handLift, 22, 30, 11, BODY);
    rect(layer, x + 6, y, 136, 112, 60, BODY);
    rect(layer, x + 6, y + 60, 136, 46, 0, BODY);
    for (int i = 0; i < 4; ++i) rect(layer, x + 6 + i * 34, y + 91, 34, 31, 17, BODY);
    // Dark frame and matte face, matching the character's reference image.
    rect(layer, x + 18, y + 20, 112, 72, 25, FACE, LV_OPA_COVER, 3, INK);
    int lx = x + 51 + gazeX, rx = x + 97 + gazeX, ey = y + 47 + gazeY;
    int eh = static_cast<int>(24 * blink); if (eh < 3) eh = 3;
    if (mood == SHY || mood == LOVE || hugging) {
        rect(layer, x + 30, y + 67, 16, 7, 4, BLUSH, 200);
        rect(layer, x + 103, y + 67, 16, 7, 4, BLUSH, 200);
    }
    if (mood == HAPPY || hugging) {
        curve(layer, lx - 9, ey + 4, 18, -8, 3, INK);
        curve(layer, rx - 9, ey + 4, 18, -8, 3, INK);
    } else if (mood == SLEEPY) {
        curve(layer, lx - 9, ey + 4, 18, 3, 3, INK);
        curve(layer, rx - 9, ey + 4, 18, 3, 3, INK);
    } else if (mood == LOVE) {
        heart(layer, lx - 8, ey - 9, 16, 0xC27C78);
        heart(layer, rx - 8, ey - 9, 16, 0xC27C78);
    } else {
        if (mood == SHY) { lx += 2; rx += 2; ey += 3; }
        if (mood == CURIOUS) {
            rect(layer, lx - 6, ey - eh / 2 + 3, 13, eh * 3 / 4, LV_RADIUS_CIRCLE, INK);
            rect(layer, rx - 7, ey - eh / 2 - 3, 15, eh, LV_RADIUS_CIRCLE, INK);
            line(layer, rx - 10, y + 29, rx + 8, y + 26, 2, INK);
        } else {
            const int ew = mood == SURPRISE ? 17 : 13;
            if (mood == GRUMPY) eh = 9;
            rect(layer, lx - ew / 2, ey - eh / 2, ew, eh, LV_RADIUS_CIRCLE, INK);
            rect(layer, rx - ew / 2, ey - eh / 2, ew, eh, LV_RADIUS_CIRCLE, INK);
            if (mood == GRUMPY) {
                line(layer, lx - 9, ey - 11, lx + 8, ey - 7, 3, INK);
                line(layer, rx - 8, ey - 7, rx + 9, ey - 11, 3, INK);
            }
        }
    }
    if (mood == SURPRISE) rect(layer, x + 68, y + 67, 13, 16, 8, INK);
    else if (mood == SLEEPY) curve(layer, x + 68, y + 73, 12, 2, 2, INK);
    else if (mood == GRUMPY) curve(layer, x + 64, y + 78, 22, -3, 3, INK);
    else curve(layer, x + 61, y + 71, 27, mood == HAPPY || hugging ? 9 : 6, 3, INK);
    for (int i = 0; i < 3; ++i) rect(layer, x + 63 + i * 11, y + 101, 3, 3, 2, 0xA0A69B);
    if (hugging || mood == LOVE) {
        heart(layer, x - 15, y + 22 - static_cast<int>(sinf(phase * 2) * 3), 13, BLUSH);
        heart(layer, x + 155, y + 12 + static_cast<int>(sinf(phase * 2) * 3), 10, ACCENT);
    } else if (mood == HAPPY || mood == SURPRISE) {
        sparkle(layer, x - 11, y + 30, 5, ACCENT);
        sparkle(layer, x + 159, y + 15, 4, BLUSH);
    } else if (mood == SLEEPY) {
        // Tiny ascending sleep marks; no extra glyph/font assets are needed.
        const int z = static_cast<int>(sinf(phase) * 2);
        line(layer, x + 152, y + 16 + z, x + 159, y + 16 + z, 2, MUTED);
        line(layer, x + 159, y + 16 + z, x + 152, y + 23 + z, 2, MUTED);
        line(layer, x + 152, y + 23 + z, x + 159, y + 23 + z, 2, MUTED);
    }
}

void logAction(const char* source) {
    ++actions;
    // Only the Arduino thread writes Serial. Touch callbacks run in LVGL's
    // thread and must not interleave log bytes with binary snapshot pixels.
    const uint8_t next = (queueWrite + 1) % 8;
    if (next == queueRead) queueRead = (queueRead + 1) % 8;
    actionQueue[queueWrite] = {source, mood, actions};
    queueWrite = next;
}

void interaction() {
    lastInteractionMs = millis();
    nextIdleMs = lastInteractionMs + 18000 + randomBelow(12000);
}

void showMood(Mood value, const char* text = nullptr, bool user = true) {
    mood = value;
    if (value != LOVE) hugUntil = 0;
    moodUntil = millis() + 8000;
    if (user) interaction();
    lv_label_set_text(moodLabel, kMoodLabels[mood]);
    lv_label_set_text(caption, text ? text : kMoodPhrases[mood]);
    lv_label_set_text(sleepLabel, mood == SLEEPY ? "醒一醒" : "打个盹");
    lv_obj_invalidate(character);
}

void displayLocked(bool on) {
    screenOn = on;
    disp_set_backlight(display, on ? 100 : 0);
    if (on) {
        interaction();
        lv_display_trigger_activity(display);
        disp_enable_update(display);
        lv_obj_invalidate(lv_screen_active());
    }
}

// Returns true when this gesture was consumed by waking the screen or pet.
bool wakeForTouch(bool wakePet = true) {
    ++touches;
    if (!screenOn) {
        displayLocked(true);
        showMood(CALM, "我在，刚刚眯了一会儿。");
        logAction("TOUCH_WAKE");
        return true;
    }
    if (wakePet && mood == SLEEPY) {
        showMood(HAPPY, "睡醒啦，继续陪着你。");
        logAction("PET_WAKE");
        return true;
    }
    return false;
}

void pet() {
    hugUntil = millis() + 2600;
    showMood(LOVE, "摸摸头，今天也辛苦啦。");
    logAction("PET");
}

void nextMood(int direction) {
    int value = (static_cast<int>(mood) + direction + MOOD_COUNT) % MOOD_COUNT;
    showMood(static_cast<Mood>(value));
    logAction(direction > 0 ? "NEXT" : "PREVIOUS");
}

void talk() {
    showMood(CURIOUS, kPhrases[phraseIndex]);
    phraseIndex = (phraseIndex + 1) % (sizeof(kPhrases) / sizeof(kPhrases[0]));
    logAction("TALK");
}

void onCharacter(lv_event_t* e) {
    const lv_event_code_t code = lv_event_get_code(e);
    lv_indev_t* input = lv_indev_active();
    if (code == LV_EVENT_PRESSED) {
        if (!input) return;
        lv_indev_get_point(input, &pressPoint); currentPoint = pressPoint;
        pressedMs = millis(); pressing = true; holdHandled = false;
        wakeOnly = wakeForTouch();
    } else if (code == LV_EVENT_PRESSING && pressing && input) {
        lv_indev_get_point(input, &currentPoint);
        gazeX = (currentPoint.x - 160) / 22; gazeY = (currentPoint.y - 100) / 32;
        if (gazeX < -4) gazeX = -4; if (gazeX > 4) gazeX = 4;
        if (gazeY < -2) gazeY = -2; if (gazeY > 2) gazeY = 2;
        if (!wakeOnly && !holdHandled && millis() - pressedMs >= 600 &&
            abs(currentPoint.x - pressPoint.x) < 20 && abs(currentPoint.y - pressPoint.y) < 20) {
            holdHandled = true; pet();
        }
    } else if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        if (!pressing) return;
        pressing = false;
        gazeX = 0; gazeY = 0;
        if (wakeOnly || holdHandled) return;
        const int dx = currentPoint.x - pressPoint.x;
        if (abs(dx) > 35) nextMood(dx < 0 ? 1 : -1);
        else if (code == LV_EVENT_RELEASED) pet();
    }
}

void onButton(lv_event_t* e) {
    const uintptr_t which = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
    // Cycling out of SLEEPY must still reach LOVE/CURIOUS/GRUMPY; only the
    // dedicated sleep/wake button consumes that tap as a pet wake gesture.
    if (wakeForTouch(which == 2)) return;
    if (which == 0) nextMood(1);
    else if (which == 1) talk();
    else { showMood(SLEEPY); logAction("SLEEP"); }
}

void onBackground(lv_event_t*) {
    if (!wakeForTouch()) { interaction(); pet(); }
}

void onFlush(lv_event_t*) { ++flushes; }

void animate(lv_timer_t*) {
    if (snapshotRequested) {
        // Render on the 12 KiB LVGL stack, not Arduino's small loop stack.
        snapshotResult = lv_snapshot_take(lv_screen_active(), LV_COLOR_FORMAT_RGB565);
        snapshotRequested = false;
    }
    if (!screenOn) return;
    const uint32_t now = millis();
    phase += mood == SLEEPY ? 0.045f : 0.070f;
    if (phase > 6.2831853f) phase -= 6.2831853f;
    if (due(now, nextBlink)) {
        blinkStart = now;
        nextBlink = now + 2400 + randomBelow(3000);
    }
    const uint32_t elapsed = now - blinkStart;
    blink = elapsed < 180 ? fabsf(1.0f - static_cast<float>(elapsed) / 90.0f) : 1.0f;
    if (mood != SLEEPY) {
        if (now - lastInteractionMs >= kIdleSleepMs) showMood(SLEEPY, nullptr, false);
        else if (mood != CALM && due(now, moodUntil)) showMood(CALM, nullptr, false);
        else if (!pressing && due(now, nextIdleMs)) {
            const Mood idle[] = {CALM, HAPPY, SHY, CURIOUS};
            showMood(idle[randomBelow(4)], nullptr, false);
            nextIdleMs = now + 18000 + randomBelow(12000);
        }
    }
    // Only this bounded area is redrawn. Objects and animation frames are never
    // allocated per tick, so long sessions don't accumulate image buffers.
    lv_obj_invalidate(character);
    ++frames;
}

lv_obj_t* label(lv_obj_t* parent, const char* text, int x, int y, uint32_t color) {
    lv_obj_t* o = lv_label_create(parent);
    lv_label_set_text(o, text);
    lv_obj_set_style_text_font(o, &lv_font_ghost_16, 0);
    lv_obj_set_style_text_color(o, lv_color_hex(color), 0);
    lv_obj_set_pos(o, x, y);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
    return o;
}

void button(lv_obj_t* parent, const char* text, int x, uintptr_t index) {
    lv_obj_t* b = lv_button_create(parent);
    lv_obj_remove_style_all(b);
    lv_obj_set_pos(b, x, 202); lv_obj_set_size(b, 94, 30);
    lv_obj_set_style_radius(b, 10, 0);
    lv_obj_set_style_bg_color(b, lv_color_hex(PANEL), 0);
    lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(b, lv_color_hex(0x45604E), LV_STATE_PRESSED);
    lv_obj_set_style_pad_all(b, 0, 0);
    lv_obj_remove_flag(b, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(b, onButton, LV_EVENT_CLICKED, reinterpret_cast<void*>(index));
    lv_obj_t* t = label(b, text, 0, 0, index == 0 ? ACCENT : TEXT);
    lv_obj_center(t);
    if (index == 2) sleepLabel = t;
}
}

bool ghostUiBegin() {
    static char name[] = "display";
    lv_vendor_init(name);
    display = lv_port_get_lv_disp_by_name(name);
    if (!display || !lv_screen_active() || !lv_port_get_lv_indev_by_name(name)) return false;
    lv_vendor_disp_lock();
    if (lv_display_get_horizontal_resolution(display) != 320 ||
        lv_display_get_vertical_resolution(display) != 240) {
        lv_vendor_disp_unlock(); return false;
    }
    lv_display_add_event_cb(display, onFlush, LV_EVENT_FLUSH_FINISH, nullptr);
    lv_obj_t* root = lv_screen_active();
    lv_obj_set_style_bg_color(root, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(root, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(root, 0, 0);
    lv_obj_remove_flag(root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(root, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(root, onBackground, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* dot = lv_obj_create(root);
    lv_obj_remove_style_all(dot); lv_obj_set_size(dot, 6, 6); lv_obj_set_pos(dot, 12, 16);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(dot, lv_color_hex(ACCENT), 0); lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    label(root, "小幽灵", 25, 9, TEXT);
    moodLabel = label(root, kMoodLabels[CALM], 241, 9, MUTED);
    character = lv_obj_create(root);
    lv_obj_remove_style_all(character);
    lv_obj_set_pos(character, 58, 28); lv_obj_set_size(character, 204, 140);
    lv_obj_remove_flag(character, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(character, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(character, drawGhost, LV_EVENT_DRAW_MAIN, nullptr);
    lv_obj_add_event_cb(character, onCharacter, LV_EVENT_ALL, nullptr);
    bubble = lv_obj_create(root);
    lv_obj_remove_style_all(bubble);
    lv_obj_set_pos(bubble, 8, 170); lv_obj_set_size(bubble, 304, 25);
    lv_obj_remove_flag(bubble, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    caption = label(bubble, "你好呀，我来陪你啦。", 0, 0, TEXT);
    lv_obj_set_width(caption, 304);
    lv_obj_set_style_text_align(caption, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(caption, LV_LABEL_LONG_CLIP);
    lv_obj_center(caption);
    button(root, "换表情", 12, 0); button(root, "说句话", 113, 1); button(root, "打个盹", 214, 2);
    rng ^= millis();
    interaction();
    nextBlink = millis() + 1800;
    animationTimer = lv_timer_create(animate, kFrameMs, nullptr);
    if (!animationTimer) { lv_vendor_disp_unlock(); return false; }
    initialized = true;
    displayLocked(true);
    lv_vendor_disp_unlock();
    lv_vendor_start(5, 1024 * 12);
    Serial.println("DISPLAY LVGL READY 320x240 ROTATION=90 FRAME_MS=50 MOODS=8");
    return true;
}

bool ghostUiSetDisplay(bool on) {
    if (!initialized) return false;
    lv_vendor_disp_lock(); displayLocked(on); lv_vendor_disp_unlock();
    return true;
}

bool ghostUiDisplayIsOn() { return initialized && screenOn; }

void ghostUiPoll() {
    if (!initialized) return;
    for (unsigned i = 0; i < 8; ++i) {
        lv_vendor_disp_lock();
        if (queueRead == queueWrite) { lv_vendor_disp_unlock(); break; }
        const ActionEvent event = actionQueue[queueRead];
        queueRead = (queueRead + 1) % 8;
        lv_vendor_disp_unlock();
        Serial.print("ACTION "); Serial.print(event.source);
        Serial.print(" MOOD="); Serial.print(kMoodNames[event.value]);
        Serial.print(" COUNT="); Serial.println(event.count);
    }
}

void ghostUiStatus() {
    if (!initialized) { Serial.println("DISPLAY INITIALIZED=0"); return; }
    lv_vendor_disp_lock();
    char data[256];
#if defined(ENABLE_EXT_RAM) && (ENABLE_EXT_RAM == 1)
    const int psram = tal_psram_get_free_heap_size();
#else
    const int psram = -1;
#endif
    snprintf(data, sizeof(data),
             "GHOST MOOD=%s ON=%u FRAMES=%lu FLUSHES=%lu TOUCHES=%lu ACTIONS=%lu SIZE=320x240 HEAP=%lu PSRAM=%d",
             kMoodNames[mood], screenOn ? 1 : 0, static_cast<unsigned long>(frames),
             static_cast<unsigned long>(flushes), static_cast<unsigned long>(touches),
             static_cast<unsigned long>(actions), static_cast<unsigned long>(tal_system_get_free_heap_size()), psram);
    lv_vendor_disp_unlock();
    Serial.println(data);
}

void ghostUiCommand(const char* command) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    bool known = true;
    if (!strcmp(command, "NEXT")) { displayLocked(true); nextMood(1); }
    else if (!strcmp(command, "PET")) { displayLocked(true); pet(); }
    else if (!strcmp(command, "TALK")) { displayLocked(true); talk(); }
    else if (!strcmp(command, "SLEEP")) { displayLocked(true); showMood(SLEEPY); logAction("SLEEP"); }
    else if (!strcmp(command, "WAKE")) { displayLocked(true); showMood(HAPPY, "睡醒啦，继续陪着你。"); logAction("WAKE"); }
    else if (!strcmp(command, "DISPLAY OFF")) { displayLocked(false); Serial.println("DISPLAY OFF"); }
    else if (!strcmp(command, "DISPLAY ON") || !strcmp(command, "DISPLAY REDRAW")) {
        displayLocked(true); Serial.println("DISPLAY ON");
    } else if (!strncmp(command, "MOOD ", 5)) {
        known = false;
        for (uint8_t i = 0; i < MOOD_COUNT; ++i) if (!strcmp(command + 5, kMoodNames[i])) {
            displayLocked(true); showMood(static_cast<Mood>(i)); logAction("MOOD"); known = true; break;
        }
    } else if (!strcmp(command, "HELP")) {
        Serial.println("COMMANDS PING STATUS NEXT PET TALK SLEEP WAKE MOOD <CALM|HAPPY|SHY|SURPRISE|SLEEPY|LOVE|CURIOUS|GRUMPY> DISPLAY <ON|OFF|REDRAW> SNAPSHOT");
    } else known = false;
    if (!known) Serial.println("ERROR UNKNOWN COMMAND");
    lv_vendor_disp_unlock();
}

void ghostUiSnapshot() {
    if (!initialized) return;
    lv_vendor_disp_lock();
    snapshotRequested = true;
    snapshotResult = nullptr;
    lv_vendor_disp_unlock();
    lv_draw_buf_t* image = nullptr;
    const uint32_t started = millis();
    while (millis() - started < 5000) {
        lv_vendor_disp_lock();
        const bool pending = snapshotRequested;
        if (!pending) { image = snapshotResult; snapshotResult = nullptr; }
        lv_vendor_disp_unlock();
        if (!pending) break;
        delay(5);
    }
    lv_vendor_disp_lock();
    snapshotRequested = false;
    if (!image && snapshotResult) { image = snapshotResult; snapshotResult = nullptr; }
    lv_vendor_disp_unlock();
    if (!image) { Serial.println("ERROR SNAPSHOT MEMORY"); return; }
    const uint32_t bytes = image->header.stride * image->header.h;
    uint32_t crc = 0xFFFFFFFFUL;
    for (uint32_t i = 0; i < bytes; ++i) {
        crc ^= image->data[i];
        for (uint8_t bit = 0; bit < 8; ++bit) crc = (crc >> 1) ^ (0xEDB88320UL & (0UL - (crc & 1UL)));
        if ((i & 4095) == 0) delay(1);
    }
    crc ^= 0xFFFFFFFFUL;
    Serial.print("SNAPSHOT RGB565 "); Serial.print(image->header.w); Serial.print(' ');
    Serial.print(image->header.h); Serial.print(" STRIDE="); Serial.print(image->header.stride);
    Serial.print(" BYTES="); Serial.print(bytes); Serial.print(" CRC32="); Serial.println(crc, HEX);
    uint32_t offset = 0;
    const uint32_t transferStart = millis();
    while (offset < bytes && millis() - transferStart < 10000) {
        const uint32_t count = bytes - offset > 128 ? 128 : bytes - offset;
        const size_t sent = Serial.write(image->data + offset, count);
        if (sent > count) break;  // A negative driver error is returned as size_t.
        offset += sent;
        delay(2);  // Leave time for UART service while LCD DMA is also active.
    }
    Serial.println(offset == bytes ? "\nSNAPSHOT END" : "\nERROR SNAPSHOT TRANSFER");
    lv_vendor_disp_lock(); lv_draw_buf_destroy(image); lv_vendor_disp_unlock();
}
