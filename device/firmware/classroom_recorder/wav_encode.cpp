// Copied from the official TuyaOpen Audio2SDcard example.
#include "wav_encode.h"
#include "tal_log.h"

typedef unsigned char ID[4];
typedef struct {
    ID RIFF;
    uint8_t size[4];
    ID CDDA;
    ID fmt;
    uint8_t chunkSize[4];
    uint8_t wFormatTag[2];
    uint8_t wChannels[2];
    uint8_t dwSamplesPerSec[4];
    uint8_t dwAvgBytesPerSec[4];
    uint8_t wBlockAlign[2];
    uint8_t wBitsPerSample[2];
    uint8_t dataID[4];
    uint8_t dataSize[4];
} __attribute__((packed)) WAVE_HEAD_FMT;

OPERATE_RET app_get_wav_head(uint32_t pcm_len, uint8_t cd_format, uint32_t sample_rate, uint16_t bit_depth,
                             uint16_t channel, uint8_t head[]) {
    if (NULL == head || 0 == pcm_len) return OPRT_INVALID_PARM;
    if (cd_format != 1) return OPRT_INVALID_PARM;
    const uint32_t total_len = pcm_len + 36;
    const uint32_t byte_rate = sample_rate * channel * bit_depth / 8;
    const uint32_t block_align = channel * bit_depth / 8;
    WAVE_HEAD_FMT *wav_head = (WAVE_HEAD_FMT *)head;
    memcpy(wav_head->RIFF, "RIFF", 4);
    for (uint8_t i = 0; i < 4; ++i) wav_head->size[i] = (total_len >> (8 * i)) & 0xff;
    memcpy(wav_head->CDDA, "WAVE", 4);
    memcpy(wav_head->fmt, "fmt ", 4);
    wav_head->chunkSize[0] = 16;
    wav_head->chunkSize[1] = wav_head->chunkSize[2] = wav_head->chunkSize[3] = 0;
    wav_head->wFormatTag[0] = cd_format;
    wav_head->wFormatTag[1] = 0;
    wav_head->wChannels[0] = channel;
    wav_head->wChannels[1] = 0;
    for (uint8_t i = 0; i < 4; ++i) {
        wav_head->dwSamplesPerSec[i] = (sample_rate >> (8 * i)) & 0xff;
        wav_head->dwAvgBytesPerSec[i] = (byte_rate >> (8 * i)) & 0xff;
        wav_head->dataSize[i] = (pcm_len >> (8 * i)) & 0xff;
    }
    wav_head->wBlockAlign[0] = block_align;
    wav_head->wBlockAlign[1] = (block_align >> 8) & 0xff;
    wav_head->wBitsPerSample[0] = bit_depth;
    wav_head->wBitsPerSample[1] = (bit_depth >> 8) & 0xff;
    memcpy(wav_head->dataID, "data", 4);
    return OPRT_OK;
}
