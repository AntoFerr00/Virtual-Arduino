#ifndef ADAFRUIT_NEOPIXEL_H
#define ADAFRUIT_NEOPIXEL_H

// Mock of the Adafruit NeoPixel library. show() sends the strip's colours (with setBrightness
// applied) to the app, which lights a WS2812B strip whose DIN is wired to that pin.
#include "Arduino.h"

typedef uint16_t neoPixelType;

// Colour order and speed flags: only accepted, the app always receives RGB.
#define NEO_RGB ((0 << 6) | (0 << 4) | (1 << 2) | (2))
#define NEO_RBG ((0 << 6) | (0 << 4) | (2 << 2) | (1))
#define NEO_GRB ((1 << 6) | (1 << 4) | (0 << 2) | (2))
#define NEO_GBR ((2 << 6) | (2 << 4) | (0 << 2) | (1))
#define NEO_BRG ((1 << 6) | (1 << 4) | (2 << 2) | (0))
#define NEO_BGR ((2 << 6) | (2 << 4) | (1 << 2) | (0))
#define NEO_GRBW ((3 << 6) | (1 << 4) | (0 << 2) | (2))
#define NEO_RGBW ((3 << 6) | (0 << 4) | (1 << 2) | (2))
#define NEO_KHZ800 0x0000
#define NEO_KHZ400 0x0100

class Adafruit_NeoPixel {
public:
    Adafruit_NeoPixel(uint16_t n, int16_t pin = 6, neoPixelType type = NEO_GRB + NEO_KHZ800) : pixels(n, 0), pin(pin) {}
    Adafruit_NeoPixel() : pin(-1) {}

    void begin() {
        if (pin < 0) return;
        pinMode((uint8_t)pin, OUTPUT);
        digitalWrite((uint8_t)pin, LOW); // the data line idles low between frames
    }
    void updateLength(uint16_t n) { pixels.assign(n, 0); }
    void setPin(int16_t p) { pin = p; begin(); }
    int16_t getPin() const { return pin; }
    uint16_t numPixels() const { return (uint16_t)pixels.size(); }
    bool canShow() const { return true; }

    void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b) { if (n < pixels.size()) pixels[n] = Color(r, g, b); }
    void setPixelColor(uint16_t n, uint8_t r, uint8_t g, uint8_t b, uint8_t w) { setPixelColor(n, r, g, b); }
    void setPixelColor(uint16_t n, uint32_t c) { if (n < pixels.size()) pixels[n] = c & 0xFFFFFF; }
    uint32_t getPixelColor(uint16_t n) const { return n < pixels.size() ? pixels[n] : 0; }

    void fill(uint32_t c = 0, uint16_t first = 0, uint16_t count = 0) {
        uint16_t end = count ? (uint16_t)std::min<size_t>(pixels.size(), (size_t)first + count) : (uint16_t)pixels.size();
        for (uint16_t i = first; i < end; i++) pixels[i] = c & 0xFFFFFF;
    }
    void clear() { std::fill(pixels.begin(), pixels.end(), 0); }

    // As in the library: 0 (default) = full brightness, otherwise the stored value + 1 scales.
    void setBrightness(uint8_t b) { brightness = (uint8_t)(b + 1); }
    uint8_t getBrightness() const { return (uint8_t)(brightness - 1); }

    void show() {
        if (pin < 0) return;
        std::string json = "{\"action\":\"neopixel\",\"pin\":" + std::to_string(pin) + ",\"pixels\":[";
        for (size_t i = 0; i < pixels.size(); i++) {
            uint32_t c = pixels[i];
            if (brightness) {
                uint32_t r = ((c >> 16) & 0xFF) * brightness >> 8;
                uint32_t g = ((c >> 8) & 0xFF) * brightness >> 8;
                uint32_t b = (c & 0xFF) * brightness >> 8;
                c = (r << 16) | (g << 8) | b;
            }
            json += std::to_string(c);
            if (i + 1 < pixels.size()) json += ",";
        }
        json += "]}";
        mockEmitIpc(json);
    }

    static uint32_t Color(uint8_t r, uint8_t g, uint8_t b) { return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b; }
    static uint32_t Color(uint8_t r, uint8_t g, uint8_t b, uint8_t w) { return Color(r, g, b); }

    // hue 0-65535 around the colour wheel, as in the library.
    static uint32_t ColorHSV(uint16_t hue, uint8_t sat = 255, uint8_t val = 255) {
        double h = hue / 65536.0 * 6.0, s = sat / 255.0, v = val / 255.0;
        int i = (int)h;
        double f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
        double r, g, b;
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break;
            case 1: r = q; g = v; b = p; break;
            case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break;
            case 4: r = t; g = p; b = v; break;
            default: r = v; g = p; b = q; break;
        }
        return Color((uint8_t)std::lround(r * 255), (uint8_t)std::lround(g * 255), (uint8_t)std::lround(b * 255));
    }
    static uint32_t gamma32(uint32_t x) { return x; }

private:
    std::vector<uint32_t> pixels;
    int16_t pin;
    uint8_t brightness = 0;
};

#endif // ADAFRUIT_NEOPIXEL_H
