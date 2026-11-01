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
enum Mood : uint8_t {
    CALM, HAPPY, SHY, SURPRISE, SLEEPY, LOVE, CURIOUS, GRUMPY,
    WINK, SAD, EXCITED, PROUD, THINKING, HUNGRY, CHEER, COOL, MOOD_COUNT
};
const char* const kMoodNames[] = {
    "CALM", "HAPPY", "SHY", "SURPRISE", "SLEEPY", "LOVE", "CURIOUS", "GRUMPY",
    "WINK", "SAD", "EXCITED", "PROUD", "THINKING", "HUNGRY", "CHEER", "COOL"
};
const char* const kMoodLabels[] = {
    "陪着你", "开心", "害羞", "惊讶", "困困", "喜欢你", "好奇", "小傲娇",
    "眨眨眼", "委屈", "兴奋", "得意", "想一想", "饿啦", "加油", "酷酷"
};
constexpr uint8_t kLinesPerMood = 3;
const char* const kDialogue[MOOD_COUNT][kLinesPerMood] = {
    {"不用说话，我也在。", "你忙你的，我在旁边。", "发一会儿呆，也挺好。"},
    {"见到你就很开心！", "今天又攒到一点快乐。", "你的出现，就是好消息。"},
    {"被你发现我在偷笑了。", "夸我的话，我会害羞的。", "别盯太久，我要脸红啦。"},
    {"哇，发生什么好事啦？", "这个消息，我得认真听听。", "你一出现，我就精神啦。"},
    {"我眯一会儿，你忙你的。", "困困的，也想陪在你旁边。", "要不要一起歇两分钟？"},
    {"想给你一个小小的拥抱。", "再摸摸头嘛。", "我的小世界，给你留了位置。"},
    {"让我看看你在忙什么。", "今天有没有遇到新鲜事？", "这个问题，我也想知道。"},
    {"哼，摸摸头就原谅你。", "我才没有一直等你呢。", "嘴上不说，还是想陪你。"},
    {"悄悄给你一个眨眼。", "这是我们的小小暗号。", "今天的好运，分你一半。"},
    {"今天有点累，也没关系。", "难过的时候，可以靠近一点。", "不用急着好起来，我陪你。"},
    {"好耶！给今天加一点惊喜。", "这件小事也值得庆祝！", "快乐满格，准备起飞！"},
    {"不错嘛，我都替你得意。", "这一小步，也算数。", "你刚刚做得很棒。"},
    {"让我想一想，慢慢来。", "先歇一口气，答案不急。", "一步一步，事情会变清楚。"},
    {"肚子咕噜，是想吃点东西。", "忙归忙，也别忘了吃饭。", "想和你分享一口小点心。"},
    {"再走一小步，我给你加油。", "累了就歇歇，别丢下自己。", "今天已经很努力啦。"},
    {"小幽灵上线，陪伴到位。", "事情慢慢办，心情稳稳放。", "保持一点酷，也留一点温柔。"}
};
constexpr uint32_t BG = 0x192C28, PANEL = 0x263D36, TEXT = 0xEEEFE4;
constexpr uint32_t MUTED = 0xA9BCAF, ACCENT = 0xB7D6AC, INK = 0x34443F;
constexpr uint32_t BODY = 0xF2F0E7, FACE = 0xE4E7DF, BLUSH = 0xE9B3A7;
constexpr uint32_t kIdleSleepMs = 10UL * 60UL * 1000UL;
constexpr uint32_t kFrameMs = 50;
// Optical compensation for the enclosure's asymmetric opening: keep a
// 256-pixel content column on the native 320-pixel landscape canvas.
constexpr int kContentWidth = 256;
constexpr int kSidePadding = 12;
constexpr int kButtonGap = 8;
constexpr int kRecordButtonWidth = (kContentWidth - 2 * kSidePadding - kButtonGap) / 2;

lv_obj_t *character = nullptr, *caption = nullptr, *moodLabel = nullptr;
lv_obj_t* bubble = nullptr;
lv_obj_t *petPage = nullptr, *recPage = nullptr;
lv_obj_t *classPage = nullptr, *classCharacter = nullptr, *classCard = nullptr;
uint8_t classBitmap[256 * 160 / 8] = {};
uint32_t classFrameId = 0, classFrames = 0;
lv_obj_t *recStatus = nullptr, *recInfo = nullptr, *recDetail = nullptr;
lv_obj_t *recStart = nullptr, *recStartText = nullptr, *recMark = nullptr, *recStop = nullptr, *recBack = nullptr;
lv_obj_t* recCharacter = nullptr;
GhostUiAction openRecorderAction = nullptr, returnPetAction = nullptr;
GhostUiAction startRecordAction = nullptr, markRecordAction = nullptr, stopRecordAction = nullptr;
bool inRecorder = false, inClassroom = false;
RecorderView recorderView = DUAL_READY;
lv_display_t* display = nullptr;
lv_timer_t* animationTimer = nullptr;
bool initialized = false, screenOn = true;
Mood mood = CALM;
uint32_t moodUntil = 0, lastInteractionMs = 0, nextIdleMs = 0;
uint32_t blinkStart = 0, nextBlink = 1800, hugUntil = 0;
uint32_t frames = 0, flushes = 0, touches = 0, actions = 0;
uint32_t petFrames = 0, recFrames = 0, lastRecFrame = 0;
int drawOriginX = 0, drawOriginY = 0, drawScale = 256;
lv_point_t currentPoint = {0, 0};
bool pressing = false, wakeOnly = false;
uint8_t dialogueVariants[MOOD_COUNT] = {}, lastDialogueVariant = 0;
uint32_t reactionPulseUntil = 0, reactions = 0;
float phase = 0, blink = 1;
int gazeX = 0, gazeY = 0;
uint32_t rng = 0x138AD325;
struct ActionEvent { const char* source; Mood value; uint32_t count; };
ActionEvent actionQueue[8];
uint8_t queueRead = 0, queueWrite = 0;
bool snapshotRequested = false;
lv_draw_buf_t* snapshotResult = nullptr;
struct ButtonFeedback {
    lv_obj_t* button;
    lv_obj_t* text;
    uint32_t baseTextColor;
    uint32_t until;
    bool pressed, active, temporaryText;
    char restoreText[32];
};
ButtonFeedback feedbackButtons[12];
uint8_t feedbackCount = 0;
struct TouchTrace { const char* target; int16_t x, y; uint32_t at; };
TouchTrace touchQueue[16];
uint8_t touchRead = 0, touchWrite = 0;

bool due(uint32_t now, uint32_t deadline) { return static_cast<int32_t>(now - deadline) >= 0; }

void applyFeedback(ButtonFeedback& f, uint32_t now) {
    const bool active = f.pressed || (f.until != 0 && !due(now, f.until));
    if (active != f.active) {
        f.active = active;
        if (active) lv_obj_add_state(f.button, LV_STATE_USER_1);
        else lv_obj_remove_state(f.button, LV_STATE_USER_1);
        lv_obj_set_style_text_color(f.text, lv_color_hex(active ? INK : f.baseTextColor), 0);
    }
    if (!active && f.temporaryText) {
        lv_label_set_text(f.text, f.restoreText);
        f.temporaryText = false;
    }
}

void pulseButton(lv_obj_t* button, const char* temporaryText = nullptr) {
    for (uint8_t i = 0; i < feedbackCount; ++i) {
        ButtonFeedback& f = feedbackButtons[i];
        if (f.button != button) continue;
        f.until = millis() + 700;
        if (temporaryText) {
            if (!f.temporaryText) snprintf(f.restoreText, sizeof(f.restoreText), "%s", lv_label_get_text(f.text));
            f.temporaryText = true;
            lv_label_set_text(f.text, temporaryText);
        }
        applyFeedback(f, millis());
        return;
    }
}

void onButtonFeedback(lv_event_t* e) {
    ButtonFeedback& f = *static_cast<ButtonFeedback*>(lv_event_get_user_data(e));
    const lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_PRESSED) { f.pressed = true; f.until = 0; }
    else if (code == LV_EVENT_RELEASED) { f.pressed = false; f.until = millis() + 120; }
    else if (code == LV_EVENT_CLICKED) { pulseButton(f.button); return; }
    else if (code == LV_EVENT_PRESS_LOST) { f.pressed = false; f.until = 0; }
    else return;
    applyFeedback(f, millis());
}

void bindButtonFeedback(lv_obj_t* button, lv_obj_t* text, uint32_t baseTextColor) {
    if (feedbackCount >= sizeof(feedbackButtons) / sizeof(feedbackButtons[0])) return;
    ButtonFeedback& f = feedbackButtons[feedbackCount++];
    memset(&f, 0, sizeof(f));
    f.button = button; f.text = text; f.baseTextColor = baseTextColor;
    // A clear press and a 700 ms release flash remain visible after a quick tap.
    lv_obj_set_style_bg_color(button, lv_color_hex(0xDCEFD2), LV_STATE_USER_1);
    lv_obj_set_style_bg_color(button, lv_color_white(), LV_STATE_USER_1 | LV_STATE_PRESSED);
    lv_obj_set_style_border_color(button, lv_color_white(), LV_STATE_USER_1);
    lv_obj_set_style_border_width(button, 2, LV_STATE_USER_1);
    lv_obj_add_event_cb(button, onButtonFeedback, LV_EVENT_ALL, &f);
}

void traceTouch(const char* target) {
    lv_indev_t* input = lv_indev_active();
    if (!input) return;
    lv_point_t point;
    lv_indev_get_point(input, &point);
    const uint8_t next = (touchWrite + 1) % 16;
    if (next == touchRead) touchRead = (touchRead + 1) % 16;
    touchQueue[touchWrite] = {target, static_cast<int16_t>(point.x), static_cast<int16_t>(point.y), millis()};
    touchWrite = next;
}
uint32_t randomBelow(uint32_t maximum) {
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return maximum ? rng % maximum : 0;
}

void rect(lv_layer_t* layer, int x, int y, int w, int h, int radius, uint32_t color,
          lv_opa_t opacity = LV_OPA_COVER, int border = 0, uint32_t borderColor = INK) {
    x = drawOriginX + x * drawScale / 256; y = drawOriginY + y * drawScale / 256;
    w = (w * drawScale + 128) / 256; h = (h * drawScale + 128) / 256;
    if (w < 1) w = 1; if (h < 1) h = 1;
    if (radius != LV_RADIUS_CIRCLE) radius = (radius * drawScale + 128) / 256;
    if (border) { border = (border * drawScale + 128) / 256; if (border < 1) border = 1; }
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
    x1 = drawOriginX + x1 * drawScale / 256; y1 = drawOriginY + y1 * drawScale / 256;
    x2 = drawOriginX + x2 * drawScale / 256; y2 = drawOriginY + y2 * drawScale / 256;
    width = (width * drawScale + 128) / 256; if (width < 1) width = 1;
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
    d.p[0].x = drawOriginX + x * drawScale / 256; d.p[0].y = drawOriginY + (y + r / 2) * drawScale / 256;
    d.p[1].x = drawOriginX + (x + size) * drawScale / 256; d.p[1].y = d.p[0].y;
    d.p[2].x = drawOriginX + (x + r) * drawScale / 256; d.p[2].y = drawOriginY + (y + size) * drawScale / 256;
    lv_draw_triangle(layer, &d);
}

void sparkle(lv_layer_t* layer, int x, int y, int size, uint32_t color) {
    line(layer, x - size, y, x + size, y, 2, color);
    line(layer, x, y - size, x, y + size, 2, color);
}

void drawGhost(lv_event_t* e) {
    lv_layer_t* layer = lv_event_get_layer(e);
    lv_area_t a;
    lv_obj_t* target = lv_event_get_target_obj(e);
    lv_obj_get_coords(target, &a);
    drawOriginX = a.x1; drawOriginY = a.y1;
    drawScale = target == recCharacter ? 176 : (target == classCharacter ? 80 : 288);
    a.x1 = 0; a.y1 = 0;
    const uint32_t now = millis();
    const bool hugging = hugUntil != 0 && !due(now, hugUntil);
    int bob = static_cast<int>(sinf(phase) * (mood == SLEEPY ? 2.0f : 3.0f));
    int sway = mood == HAPPY ? static_cast<int>(sinf(phase * 2) * 3) : 0;
    int x = a.x1 + 28 + sway, y = a.y1 + 6 + bob;
    if (hugging) y -= static_cast<int>(fabsf(sinf(phase * 3)) * 4);
    if (mood == EXCITED) y -= static_cast<int>(fabsf(sinf(phase * 3)) * 3);
    if (target == character && reactionPulseUntil && !due(now, reactionPulseUntil)) {
        const float progress = 1.0f - static_cast<float>(reactionPulseUntil - now) / 450.0f;
        y -= static_cast<int>(sinf(progress * 3.1415927f) * 5);
    }
    // Fixed shadow, rounded shoulders and four scallops echo the supplied ghost.
    rect(layer, a.x1 + 51, a.y1 + 126, 94, 7, LV_RADIUS_CIRCLE, 0x081B17, 150);
    const int handLift = hugging || mood == HAPPY || mood == EXCITED || mood == CHEER ? 8 : 0;
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
    } else if (mood == WINK) {
        rect(layer, lx - 6, ey - eh / 2, 13, eh, LV_RADIUS_CIRCLE, INK);
        curve(layer, rx - 9, ey + 3, 18, -5, 3, INK);
    } else if (mood == COOL) {
        rect(layer, lx - 16, ey - 11, 32, 22, 6, INK);
        rect(layer, rx - 16, ey - 11, 32, 22, 6, INK);
        line(layer, lx + 15, ey - 6, rx - 15, ey - 6, 4, INK);
        line(layer, lx - 10, ey - 5, lx - 3, ey - 8, 2, FACE);
        line(layer, rx - 10, ey - 5, rx - 3, ey - 8, 2, FACE);
    } else if (mood == CHEER) {
        line(layer, lx - 8, ey - 8, lx + 4, ey, 3, INK);
        line(layer, lx + 4, ey, lx - 8, ey + 8, 3, INK);
        line(layer, rx + 8, ey - 8, rx - 4, ey, 3, INK);
        line(layer, rx - 4, ey, rx + 8, ey + 8, 3, INK);
    } else if (mood == SAD) {
        rect(layer, lx - 6, ey - 3, 13, 15, 6, INK);
        rect(layer, rx - 6, ey - 3, 13, 15, 6, INK);
        line(layer, lx - 9, ey - 9, lx + 8, ey - 14, 2, INK);
        line(layer, rx - 8, ey - 14, rx + 9, ey - 9, 2, INK);
        rect(layer, rx + 8, ey + 8, 6, 12, LV_RADIUS_CIRCLE, 0x7FAFCA);
    } else if (mood == PROUD) {
        curve(layer, lx - 9, ey, 18, 3, 3, INK);
        curve(layer, rx - 9, ey, 18, 3, 3, INK);
        line(layer, lx - 9, ey - 11, lx + 8, ey - 13, 2, INK);
        line(layer, rx - 8, ey - 13, rx + 9, ey - 11, 2, INK);
    } else {
        if (mood == SHY) { lx += 2; rx += 2; ey += 3; }
        if (mood == THINKING) { lx += 3; rx += 3; ey -= 4; }
        if (mood == CURIOUS) {
            rect(layer, lx - 6, ey - eh / 2 + 3, 13, eh * 3 / 4, LV_RADIUS_CIRCLE, INK);
            rect(layer, rx - 7, ey - eh / 2 - 3, 15, eh, LV_RADIUS_CIRCLE, INK);
            line(layer, rx - 10, y + 29, rx + 8, y + 26, 2, INK);
        } else {
            const int ew = mood == SURPRISE || mood == EXCITED ? 17 : 13;
            if (mood == GRUMPY) eh = 9;
            rect(layer, lx - ew / 2, ey - eh / 2, ew, eh, LV_RADIUS_CIRCLE, INK);
            rect(layer, rx - ew / 2, ey - eh / 2, ew, eh, LV_RADIUS_CIRCLE, INK);
            if (mood == GRUMPY) {
                line(layer, lx - 9, ey - 11, lx + 8, ey - 7, 3, INK);
                line(layer, rx - 8, ey - 7, rx + 9, ey - 11, 3, INK);
            }
            if (mood == EXCITED) {
                rect(layer, lx - 4, ey - 6, 4, 5, 2, BODY);
                rect(layer, rx - 4, ey - 6, 4, 5, 2, BODY);
            }
            if (mood == THINKING) line(layer, rx - 9, ey - 16, rx + 8, ey - 19, 2, INK);
        }
    }
    if (mood == SURPRISE) rect(layer, x + 68, y + 67, 13, 16, 8, INK);
    else if (mood == SLEEPY) curve(layer, x + 68, y + 73, 12, 2, 2, INK);
    else if (mood == GRUMPY) curve(layer, x + 64, y + 78, 22, -3, 3, INK);
    else if (mood == SAD) curve(layer, x + 65, y + 79, 20, -5, 3, INK);
    else if (mood == EXCITED || mood == CHEER || mood == HUNGRY) {
        const int w = mood == HUNGRY ? 17 : 25;
        rect(layer, x + 75 - w / 2, y + 68, w, 16, 8, INK);
        rect(layer, x + 70, y + 78, 10, 4, 2, BLUSH);
    } else if (mood == THINKING) {
        for (int i = 0; i < 3; ++i) rect(layer, x + 66 + i * 8, y + 74, 3, 3, 2, INK);
    } else if (mood == PROUD || mood == COOL) curve(layer, x + 67, y + 73, 23, 5, 3, INK);
    else curve(layer, x + 61, y + 71, 27, mood == HAPPY || hugging ? 9 : 6, 3, INK);
    for (int i = 0; i < 3; ++i) rect(layer, x + 63 + i * 11, y + 101, 3, 3, 2, 0xA0A69B);
    if (hugging || mood == LOVE) {
        heart(layer, x - 15, y + 22 - static_cast<int>(sinf(phase * 2) * 3), 13, BLUSH);
        heart(layer, x + 155, y + 12 + static_cast<int>(sinf(phase * 2) * 3), 10, ACCENT);
    } else if (mood == HAPPY || mood == SURPRISE || mood == EXCITED || mood == CHEER || mood == WINK) {
        sparkle(layer, x - 11, y + 30, 5, ACCENT);
        sparkle(layer, x + 159, y + 15, 4, BLUSH);
    } else if (mood == THINKING) {
        curve(layer, x + 151, y + 13, 14, -5, 2, ACCENT);
        line(layer, x + 165, y + 13, x + 158, y + 21, 2, ACCENT);
        line(layer, x + 158, y + 21, x + 158, y + 25, 2, ACCENT);
        rect(layer, x + 157, y + 29, 3, 3, 2, ACCENT);
    } else if (mood == HUNGRY) {
        curve(layer, x + 148, y + 36, 12, -4, 2, BLUSH);
        curve(layer, x + 152, y + 44, 12, -4, 2, BLUSH);
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
    moodUntil = millis() + 15000;
    if (user) interaction();
    lv_label_set_text(moodLabel, kMoodLabels[mood]);
    lv_label_set_text(caption, text ? text : kDialogue[mood][0]);
    lastDialogueVariant = 0;
    lv_obj_center(caption);
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

void nextReaction() {
    const Mood value = static_cast<Mood>((static_cast<int>(mood) + 1) % MOOD_COUNT);
    const uint8_t variant = dialogueVariants[value];
    dialogueVariants[value] = (variant + 1) % kLinesPerMood;
    showMood(value, kDialogue[value][variant]);
    lastDialogueVariant = variant;
    reactionPulseUntil = millis() + 450;
    ++reactions;
    logAction("REACTION");
}

void onCharacter(lv_event_t* e) {
    const lv_event_code_t code = lv_event_get_code(e);
    lv_indev_t* input = lv_indev_active();
    if (code == LV_EVENT_PRESSED) {
        if (!input) return;
        traceTouch("PET_BODY");
        pressing = true;
        wakeOnly = wakeForTouch(false);
    } else if (code == LV_EVENT_PRESSING && pressing && input) {
        lv_indev_get_point(input, &currentPoint);
        gazeX = (currentPoint.x - kContentWidth / 2) / 22; gazeY = (currentPoint.y - 100) / 32;
        if (gazeX < -4) gazeX = -4; if (gazeX > 4) gazeX = 4;
        if (gazeY < -2) gazeY = -2; if (gazeY > 2) gazeY = 2;
    } else if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        pressing = false;
        gazeX = 0; gazeY = 0;
        if (code == LV_EVENT_PRESS_LOST) wakeOnly = true;
    } else if (code == LV_EVENT_CLICKED && !wakeOnly) {
        // One release produces one paired expression/line, including a long
        // press. No swipe or long-press action competes with a normal tap.
        nextReaction();
    }
}

void onBackground(lv_event_t*) {
    if (inRecorder) return;
    traceTouch("PET_BACKGROUND");
    if (!wakeForTouch(false)) nextReaction();
}

bool wakeRecorderTouch() {
    ++touches;
    if (screenOn) return false;
    displayLocked(true);
    logAction("TOUCH_WAKE");
    return true;
}

void onOpenRecorder(lv_event_t*) {
    traceTouch("MODE_RECORDER");
    if (wakeForTouch(false)) return;
    if (openRecorderAction) openRecorderAction();
}

void onRecorderButton(lv_event_t* e) {
    if (wakeRecorderTouch()) return;
    const uintptr_t which = reinterpret_cast<uintptr_t>(lv_event_get_user_data(e));
    const char* targets[] = {"RECORD_START", "RECORD_MARK", "RECORD_STOP", "MODE_PET"};
    if (which < 4) traceTouch(targets[which]);
    if (which == 0 && recorderView != DUAL_RECORDING && recorderView != DUAL_SAVING && recorderView != DUAL_EXPORTING) {
        if (startRecordAction) startRecordAction();
    } else if (which == 1 && recorderView == DUAL_RECORDING) {
        if (markRecordAction) markRecordAction();
    } else if (which == 2 && recorderView == DUAL_RECORDING) {
        if (stopRecordAction) stopRecordAction();
    } else if (which == 3 && recorderView != DUAL_RECORDING && recorderView != DUAL_SAVING && recorderView != DUAL_EXPORTING) {
        if (returnPetAction) returnPetAction();
    }
}

void onRecorderBackground(lv_event_t*) { traceTouch("REC_BACKGROUND"); wakeRecorderTouch(); }
void onClassroomBackground(lv_event_t*) { traceTouch("CLASS_BACKGROUND"); wakeRecorderTouch(); }

void drawClassCard(lv_event_t* e) {
    lv_area_t area;
    lv_obj_get_coords(lv_event_get_target_obj(e), &area);
    drawOriginX = area.x1; drawOriginY = area.y1; drawScale = 256;
    lv_layer_t* layer = lv_event_get_layer(e);
    // Render horizontal runs only when a card changes. The small ghost's
    // animation has its own dirty region and does not redraw this bitmap.
    for (int y = 0; y < 160; ++y) {
        int start = -1;
        for (int x = 0; x <= 256; ++x) {
            const bool set = x < 256 && (classBitmap[y * 32 + x / 8] & (0x80 >> (x & 7)));
            if (set && start < 0) start = x;
            else if (!set && start >= 0) { rect(layer, start, y, x - start, 1, 0, TEXT); start = -1; }
        }
    }
}

void onFlush(lv_event_t*) { ++flushes; }

void animate(lv_timer_t*) {
    const uint32_t feedbackNow = millis();
    for (uint8_t i = 0; i < feedbackCount; ++i) applyFeedback(feedbackButtons[i], feedbackNow);
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
    const uint32_t blinkDuration = inRecorder || inClassroom ? 360 : 180;
    blink = elapsed < blinkDuration ? fabsf(1.0f - static_cast<float>(elapsed) * 2.0f / blinkDuration) : 1.0f;
    if (!inRecorder && !inClassroom && mood != SLEEPY) {
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
    if (inClassroom) {
        if (now - lastRecFrame < 200) return;
        lastRecFrame = now;
        lv_obj_invalidate(classCharacter);
        ++classFrames;
    } else if (inRecorder) {
        if (now - lastRecFrame < 200) return;
        lastRecFrame = now;
        lv_obj_invalidate(recCharacter);
        ++recFrames;
    } else { lv_obj_invalidate(character); ++petFrames; }
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

lv_obj_t* actionButton(lv_obj_t* parent, const char* text, int x, int y, int w, int h,
                       uint32_t color, uint32_t textColor, lv_event_cb_t cb, uintptr_t index,
                       lv_obj_t** textOut = nullptr) {
    lv_obj_t* b = lv_button_create(parent);
    lv_obj_remove_style_all(b);
    lv_obj_set_pos(b, x, y); lv_obj_set_size(b, w, h);
    lv_obj_set_style_radius(b, h < 40 ? 9 : 14, 0);
    lv_obj_set_style_bg_color(b, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(b, lv_color_hex(0x45604E), LV_STATE_PRESSED);
    lv_obj_set_style_opa(b, LV_OPA_40, LV_STATE_DISABLED);
    lv_obj_remove_flag(b, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, reinterpret_cast<void*>(index));
    lv_obj_t* t = label(b, text, 0, 0, textColor);
    lv_obj_center(t);
    bindButtonFeedback(b, t, textColor);
    if (textOut) *textOut = t;
    return b;
}

lv_obj_t* centeredLabel(lv_obj_t* parent, int y, uint32_t color) {
    lv_obj_t* t = label(parent, "", 8, y, color);
    lv_obj_set_width(t, kContentWidth - 16);
    lv_obj_set_style_text_align(t, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(t, LV_LABEL_LONG_CLIP);
    return t;
}

lv_obj_t* makePage(lv_obj_t* root) {
    lv_obj_t* page = lv_obj_create(root);
    lv_obj_remove_style_all(page);
    lv_obj_set_pos(page, 0, 0); lv_obj_set_size(page, 320, 240);
    lv_obj_set_style_bg_color(page, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(page, LV_OPA_COVER, 0);
    lv_obj_remove_flag(page, LV_OBJ_FLAG_SCROLLABLE);
    return page;
}

void createRecorder(lv_obj_t* root) {
    recPage = makePage(root);
    lv_obj_add_event_cb(recPage, onRecorderBackground, LV_EVENT_CLICKED, nullptr);
    label(recPage, "知流录音", (kContentWidth - 64) / 2, 9, TEXT);
    recBack = actionButton(recPage, "桌宠", 12, 4, 72, 30, PANEL, ACCENT, onRecorderButton, 3);
    recCharacter = lv_obj_create(recPage);
    lv_obj_remove_style_all(recCharacter);
    lv_obj_set_pos(recCharacter, 2, 35); lv_obj_set_size(recCharacter, 126, 100);
    lv_obj_remove_flag(recCharacter, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(recCharacter, drawGhost, LV_EVENT_DRAW_MAIN, nullptr);
    recStatus = centeredLabel(recPage, 47, ACCENT);
    recInfo = centeredLabel(recPage, 79, TEXT);
    lv_obj_set_pos(recStatus, 128, 47); lv_obj_set_width(recStatus, kContentWidth - 136);
    lv_obj_set_pos(recInfo, 128, 76); lv_obj_set_size(recInfo, kContentWidth - 136, 48);
    lv_label_set_long_mode(recInfo, LV_LABEL_LONG_WRAP);
    recDetail = centeredLabel(recPage, 128, MUTED);
    recStart = actionButton(recPage, "开始录音", kSidePadding, 154, kContentWidth - 2 * kSidePadding, 72, ACCENT, INK, onRecorderButton, 0, &recStartText);
    recMark = actionButton(recPage, "标记不懂", kSidePadding, 154, kRecordButtonWidth, 72, 0x35564B, TEXT, onRecorderButton, 1);
    recStop = actionButton(recPage, "停止保存", kSidePadding + kRecordButtonWidth + kButtonGap, 154, kRecordButtonWidth, 72, 0x8B514A, TEXT, onRecorderButton, 2);
    lv_obj_add_flag(recPage, LV_OBJ_FLAG_HIDDEN);
}

void createClassroom(lv_obj_t* root) {
    classPage = makePage(root);
    lv_obj_add_event_cb(classPage, onClassroomBackground, LV_EVENT_CLICKED, nullptr);
    label(classPage, "回放陪学", 96, 9, TEXT);
    actionButton(classPage, "桌宠", 12, 4, 72, 30, PANEL, ACCENT, onRecorderButton, 3);
    label(classPage, "跟着课堂一起想", 12, 47, MUTED);
    classCharacter = lv_obj_create(classPage);
    lv_obj_remove_style_all(classCharacter);
    lv_obj_set_pos(classCharacter, 184, 31); lv_obj_set_size(classCharacter, 64, 44);
    lv_obj_remove_flag(classCharacter, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(classCharacter, drawGhost, LV_EVENT_DRAW_MAIN, nullptr);
    classCard = lv_obj_create(classPage);
    lv_obj_remove_style_all(classCard);
    lv_obj_set_pos(classCard, 0, 76); lv_obj_set_size(classCard, 256, 160);
    lv_obj_set_style_bg_color(classCard, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(classCard, LV_OPA_COVER, 0);
    lv_obj_remove_flag(classCard, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_event_cb(classCard, drawClassCard, LV_EVENT_DRAW_MAIN, nullptr);
    lv_obj_add_flag(classPage, LV_OBJ_FLAG_HIDDEN);
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
    lv_obj_t* screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_hex(BG), 0);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    petPage = makePage(screen);
    lv_obj_t* root = petPage;
    lv_obj_set_style_bg_color(root, lv_color_hex(BG), 0);
    lv_obj_set_style_bg_opa(root, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(root, 0, 0);
    lv_obj_remove_flag(root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(root, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(root, onBackground, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* dot = lv_obj_create(root);
    lv_obj_remove_style_all(dot); lv_obj_set_size(dot, 6, 6); lv_obj_set_pos(dot, (kContentWidth - 48) / 2 - 13, 16);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(dot, lv_color_hex(ACCENT), 0); lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    label(root, "小幽灵", (kContentWidth - 48) / 2, 9, TEXT);
    moodLabel = label(root, kMoodLabels[CALM], kContentWidth - kSidePadding - 72, 9, MUTED);
    lv_obj_set_width(moodLabel, 72);
    lv_obj_set_style_text_align(moodLabel, LV_TEXT_ALIGN_RIGHT, 0);
    lv_obj_t* modeButton = actionButton(root, "录音", 12, 4, 72, 30, PANEL, ACCENT, onOpenRecorder, 0);
    character = lv_obj_create(root);
    lv_obj_remove_style_all(character);
    lv_obj_set_pos(character, (kContentWidth - 230) / 2, 36); lv_obj_set_size(character, 230, 154);
    lv_obj_remove_flag(character, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(character, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(character, drawGhost, LV_EVENT_DRAW_MAIN, nullptr);
    lv_obj_add_event_cb(character, onCharacter, LV_EVENT_ALL, nullptr);
    bubble = lv_obj_create(root);
    lv_obj_remove_style_all(bubble);
    lv_obj_set_pos(bubble, 8, 192); lv_obj_set_size(bubble, kContentWidth - 16, 40);
    lv_obj_remove_flag(bubble, LV_OBJ_FLAG_SCROLLABLE | LV_OBJ_FLAG_CLICKABLE);
    caption = label(bubble, "点点我，换个表情聊两句。", 0, 0, TEXT);
    lv_obj_set_width(caption, kContentWidth - 16);
    lv_obj_set_style_text_align(caption, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(caption, LV_LABEL_LONG_WRAP);
    lv_obj_center(caption);
    // Keep navigation above the generous character/background touch area.
    lv_obj_move_to_index(modeButton, lv_obj_get_child_count(root) - 1);
    createRecorder(screen);
    createClassroom(screen);
    rng ^= millis();
    interaction();
    nextBlink = millis() + 1800;
    animationTimer = lv_timer_create(animate, kFrameMs, nullptr);
    if (!animationTimer) { lv_vendor_disp_unlock(); return false; }
    initialized = true;
    displayLocked(true);
    lv_vendor_disp_unlock();
    lv_vendor_start(5, 1024 * 12);
    Serial.println("DISPLAY LVGL READY 320x240 ROTATION=90 FRAME_MS=50 MOODS=16 LINES=48 BODY_TAP=1 SHARED_UI=1");
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
    for (unsigned i = 0; i < 8; ++i) {
        lv_vendor_disp_lock();
        if (touchRead == touchWrite) { lv_vendor_disp_unlock(); break; }
        const TouchTrace event = touchQueue[touchRead];
        touchRead = (touchRead + 1) % 16;
        lv_vendor_disp_unlock();
        Serial.print("TOUCH TARGET="); Serial.print(event.target);
        Serial.print(" X="); Serial.print(event.x); Serial.print(" Y="); Serial.print(event.y);
        Serial.print(" AT_MS="); Serial.println(event.at);
    }
}

void ghostUiStatus() {
    if (!initialized) { Serial.println("DISPLAY INITIALIZED=0"); return; }
    lv_vendor_disp_lock();
    char data[384], captionText[160];
    snprintf(captionText, sizeof(captionText), "%s", lv_label_get_text(caption));
#if defined(ENABLE_EXT_RAM) && (ENABLE_EXT_RAM == 1)
    const int psram = tal_psram_get_free_heap_size();
#else
    const int psram = -1;
#endif
    snprintf(data, sizeof(data),
             "GHOST MODE=%s MOOD=%s ON=%u FRAMES=%lu FLUSHES=%lu TOUCHES=%lu ACTIONS=%lu SIZE=320x240 HEAP=%lu PSRAM=%d PET_FRAMES=%lu REC_FRAMES=%lu MOODS=16 LINES=48 REACTIONS=%lu VARIANT=%u SCREEN_FRAME=%lu CLASS_FRAMES=%lu",
             inRecorder ? "RECORDER" : (inClassroom ? "CLASSROOM" : "PET"), kMoodNames[mood], screenOn ? 1 : 0, static_cast<unsigned long>(frames),
             static_cast<unsigned long>(flushes), static_cast<unsigned long>(touches),
             static_cast<unsigned long>(actions), static_cast<unsigned long>(tal_system_get_free_heap_size()), psram,
             static_cast<unsigned long>(petFrames), static_cast<unsigned long>(recFrames),
             static_cast<unsigned long>(reactions), lastDialogueVariant,
             static_cast<unsigned long>(classFrameId), static_cast<unsigned long>(classFrames));
    lv_vendor_disp_unlock();
    Serial.println(data);
    Serial.print("CAPTION "); Serial.println(captionText);
}

void ghostUiCommand(const char* command) {
    if (!initialized) return;
    if (inRecorder || inClassroom) { Serial.println("ERROR PET COMMAND REQUIRES PET MODE"); return; }
    lv_vendor_disp_lock();
    bool known = true;
    if (!strcmp(command, "NEXT")) { displayLocked(true); nextReaction(); }
    else if (!strcmp(command, "PET")) { displayLocked(true); pet(); }
    else if (!strcmp(command, "TALK")) { displayLocked(true); nextReaction(); }
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
        Serial.println("COMMANDS PING STATUS NEXT PET TALK SLEEP WAKE MOOD <CALM|HAPPY|SHY|SURPRISE|SLEEPY|LOVE|CURIOUS|GRUMPY|WINK|SAD|EXCITED|PROUD|THINKING|HUNGRY|CHEER|COOL> DISPLAY <ON|OFF|REDRAW> SNAPSHOT");
    } else known = false;
    if (!known) Serial.println("ERROR UNKNOWN COMMAND");
    lv_vendor_disp_unlock();
}

void ghostUiSetModeActions(GhostUiAction openRecorder, GhostUiAction returnPet) {
    openRecorderAction = openRecorder; returnPetAction = returnPet;
}

void ghostUiSetRecorderActions(GhostUiAction start, GhostUiAction mark, GhostUiAction stop) {
    startRecordAction = start; markRecordAction = mark; stopRecordAction = stop;
}

bool ghostUiInRecorder() { return initialized && inRecorder; }
bool ghostUiInClassroom() { return initialized && inClassroom; }

bool ghostUiShowClassroomCard(const uint8_t* bitmap, uint32_t frameId) {
    if (!initialized || !bitmap || !classPage) return false;
    lv_vendor_disp_lock();
    const bool first = !inClassroom;
    inClassroom = true; inRecorder = false; pressing = false; wakeOnly = true;
    gazeX = gazeY = 0;
    if (first) showMood(CALM);
    memcpy(classBitmap, bitmap, sizeof(classBitmap));
    classFrameId = frameId;
    lv_obj_add_flag(petPage, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(recPage, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(classPage, LV_OBJ_FLAG_HIDDEN);
    lv_obj_invalidate(classCard);
    if (first) displayLocked(true);
    lv_vendor_disp_unlock();
    return true;
}

void ghostUiShowPet(const char* text) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    const bool wasClassroom = inClassroom;
    inClassroom = false;
    inRecorder = false;
    pressing = false; wakeOnly = true; gazeX = gazeY = 0;
    lv_obj_add_flag(recPage, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(classPage, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(petPage, LV_OBJ_FLAG_HIDDEN);
    showMood(CALM, text ? text : "回来啦，继续陪着你。");
    displayLocked(true);
    lv_vendor_disp_unlock();
    if (wasClassroom) Serial.println("CLASSROOM CLOSED");
}

void ghostUiRecorderShow(RecorderView view, const char* info, const char* detail) {
    if (!initialized) return;
    lv_vendor_disp_lock();
    if (!inRecorder) {
        inRecorder = true; inClassroom = false; pressing = false;
        showMood(CALM);
        lv_obj_add_flag(petPage, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(classPage, LV_OBJ_FLAG_HIDDEN);
        lv_obj_remove_flag(recPage, LV_OBJ_FLAG_HIDDEN);
        displayLocked(true);
    }
    recorderView = view;
    const char* status = "准备就绪";
    if (view == DUAL_RECORDING) status = "正在录音";
    else if (view == DUAL_SAVING) status = "正在保存";
    else if (view == DUAL_SAVED) status = "保存成功";
    else if (view == DUAL_ERROR) status = "暂时无法录音";
    else if (view == DUAL_PREPARING) status = "正在准备";
    else if (view == DUAL_EXPORTING) status = "正在回传";
    lv_label_set_text(recStatus, status);
    lv_label_set_text(recInfo, info ? info : "");
    lv_obj_set_style_text_font(recInfo, view == DUAL_RECORDING ? &lv_font_montserrat_24 : &lv_font_ghost_16, 0);
    lv_label_set_text(recDetail, detail ? detail : "");
    lv_obj_add_flag(recStart, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(recMark, LV_OBJ_FLAG_HIDDEN);
    lv_obj_add_flag(recStop, LV_OBJ_FLAG_HIDDEN);
    const bool busy = view == DUAL_RECORDING || view == DUAL_SAVING || view == DUAL_EXPORTING || view == DUAL_PREPARING;
    if (busy) lv_obj_add_state(recBack, LV_STATE_DISABLED);
    else lv_obj_remove_state(recBack, LV_STATE_DISABLED);
    if (view == DUAL_RECORDING) {
        lv_obj_remove_flag(recMark, LV_OBJ_FLAG_HIDDEN); lv_obj_remove_flag(recStop, LV_OBJ_FLAG_HIDDEN);
    } else if (view == DUAL_READY || view == DUAL_SAVED || view == DUAL_ERROR) {
        lv_label_set_text(recStartText, view == DUAL_SAVED ? "再录一节" : (view == DUAL_ERROR ? "重新尝试" : "开始录音"));
        lv_obj_remove_flag(recStart, LV_OBJ_FLAG_HIDDEN);
    }
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
