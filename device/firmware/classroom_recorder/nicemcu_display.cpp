#include "nicemcu_display.h"

#include <Arduino.h>
#include <string.h>

#include "tdd_disp_st7789.h"
#include "tdd_tp_cst816x.h"
#include "tkl_pinmux.h"

bool nicemcuStorageConfigure() {
    // NiceMCU V1.2 TF socket uses the SDIO alternate group, not GPIO2..5.
    const bool ok =
        tkl_io_pinmux_config(TUYA_IO_PIN_14, TUYA_SDIO_HOST_CLK) == OPRT_OK &&
        tkl_io_pinmux_config(TUYA_IO_PIN_15, TUYA_SDIO_HOST_CMD) == OPRT_OK &&
        tkl_io_pinmux_config(TUYA_IO_PIN_16, TUYA_SDIO_HOST_D0) == OPRT_OK &&
        tkl_io_pinmux_config(TUYA_IO_PIN_17, TUYA_SDIO_HOST_D1) == OPRT_OK &&
        tkl_io_pinmux_config(TUYA_IO_PIN_18, TUYA_SDIO_HOST_D2) == OPRT_OK &&
        tkl_io_pinmux_config(TUYA_IO_PIN_19, TUYA_SDIO_HOST_D3) == OPRT_OK;
    Serial.println(ok ? "SDIO CLK=14 CMD=15 D0=16 D1=17 D2=18 D3=19" : "SDIO ERROR pinmux");
    return ok;
}

bool nicemcuDisplayRegister() {
    static char displayName[] = "display";
    // NiceMCU routes SPI0 to its alternate 44..47 group. Without this complete
    // pinmux group the T5 SDK uses 14..17, which are wired to the TF card.
    // This matches TuyaOpen's NICEMCU_T5_2_8ISP board registration; CS/DC are
    // also supplied to the display driver below for GPIO control.
    if (tkl_io_pinmux_config(TUYA_IO_PIN_44, TUYA_SPI0_CLK) != OPRT_OK ||
        tkl_io_pinmux_config(TUYA_IO_PIN_45, TUYA_SPI0_CS) != OPRT_OK ||
        tkl_io_pinmux_config(TUYA_IO_PIN_46, TUYA_SPI0_MOSI) != OPRT_OK ||
        tkl_io_pinmux_config(TUYA_IO_PIN_47, TUYA_SPI0_MISO) != OPRT_OK) {
        Serial.println("DISPLAY ERROR SPI0 pinmux");
        return false;
    }
    Serial.println("DISPLAY SPI0 CLK=44 CS=45 MOSI=46 DC=47 BL=9");
    DISP_SPI_DEVICE_CFG_T display;
    memset(&display, 0, sizeof(display));
    display.width = 240;
    display.height = 320;
    display.pixel_fmt = TUYA_PIXEL_FMT_RGB565;
    // Keep the panel's native 240x320 geometry. LVGL rotates both pixels and
    // native touch coordinates once, exposing a logical 320x240 landscape UI.
    display.rotation = TUYA_DISPLAY_ROTATION_90;
    display.port = TUYA_SPI_NUM_0;
    display.spi_clk = 24000000;
    display.cs_pin = TUYA_GPIO_NUM_45;
    display.dc_pin = TUYA_GPIO_NUM_47;
    display.rst_pin = TUYA_GPIO_NUM_MAX;  // Connected to the board reset circuit.
    display.bl.type = TUYA_DISP_BL_TP_GPIO;
    display.bl.gpio.pin = TUYA_GPIO_NUM_9;
    display.bl.gpio.active_level = TUYA_GPIO_LEVEL_HIGH;
    display.power.pin = TUYA_GPIO_NUM_MAX;
    const OPERATE_RET displayResult = tdd_disp_spi_st7789_register(displayName, &display);
    if (displayResult != OPRT_OK) {
        Serial.print("DISPLAY ERROR register ");
        Serial.println(displayResult);
        return false;
    }

    TDD_TP_CST816X_INFO_T touch;
    memset(&touch, 0, sizeof(touch));
    touch.rst_pin = TUYA_GPIO_NUM_MAX;
    touch.intr_pin = TUYA_GPIO_NUM_22;
    touch.i2c_cfg.port = TUYA_I2C_NUM_0;
    touch.i2c_cfg.scl_pin = TUYA_GPIO_NUM_20;
    touch.i2c_cfg.sda_pin = TUYA_GPIO_NUM_21;
    touch.tp_cfg.x_max = 240;
    touch.tp_cfg.y_max = 320;
    touch.tp_cfg.flags.mirror_x = 0;
    touch.tp_cfg.flags.mirror_y = 0;
    touch.tp_cfg.flags.swap_xy = 0;
    const OPERATE_RET touchResult = tdd_tp_i2c_cst816x_register(displayName, &touch);
    if (touchResult != OPRT_OK) {
        Serial.print("TOUCH ERROR register ");
        Serial.println(touchResult);
        return false;
    }
    return true;
}
