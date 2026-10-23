#include "Arduino.h"

SerialMock Serial;
static auto startTime = std::chrono::steady_clock::now();

std::map<uint8_t, int> pinStates;
std::map<uint8_t, int> analogMilliVolts;
std::mutex pinMutex;

// ---------------------------------------------------------------------------
// Output: Serial text and IPC_MSG lines share stdout. Both the sketch and interrupt
// handlers (input thread) write to it, so writes are serialised, and an IPC line always
// starts on a fresh line even if the sketch printed text without a newline.
// ---------------------------------------------------------------------------

static std::mutex outMutex;
static bool atLineStart = true;

static void writeOut(const std::string& text) {
    if (text.empty()) return;
    std::lock_guard<std::mutex> lock(outMutex);
    std::cout << text;
    std::cout.flush();
    atLineStart = text.back() == '\n';
}

static void emitIpc(const std::string& json) {
    std::lock_guard<std::mutex> lock(outMutex);
    if (!atLineStart) std::cout << "\n";
    std::cout << "IPC_MSG:" << json << std::endl;
    atLineStart = true;
}

size_t SerialMock::print(const char* s) {
    std::string text(s ? s : "");
    writeOut(text);
    return text.size();
}

size_t SerialMock::printf(const char* format, ...) {
    char buf[1024];
    va_list args;
    va_start(args, format);
    int n = vsnprintf(buf, sizeof(buf), format, args);
    va_end(args);
    writeOut(buf);
    return n > 0 ? (size_t)n : 0;
}

std::string String::toBase(long v, int base) {
    if (base == DEC) return std::to_string(v);
    unsigned long u = (unsigned long)v;
    if (u == 0) return "0";
    std::string out;
    while (u) { int d = (int)(u % base); out.insert(out.begin(), (char)(d < 10 ? '0' + d : 'A' + d - 10)); u /= base; }
    return out;
}

std::string String::fixed(double v, int decimals) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%.*f", decimals, v);
    return buf;
}

// ---------------------------------------------------------------------------
// Inputs from the circuit simulation:
// {"pin": X, "val": <digital level>, "analog": <millivolts at the pin>}
// ---------------------------------------------------------------------------

struct Interrupt { void (*isr)(); int mode; };
static std::map<uint8_t, Interrupt> interrupts;

void inputListenerThread() {
    std::string line;
    while (std::getline(std::cin, line)) {
        auto pinPos = line.find("\"pin\":");
        auto valPos = line.find("\"val\":");
        auto anPos = line.find("\"analog\":");
        if (pinPos == std::string::npos || valPos == std::string::npos) continue;
        try {
            int pin = std::stoi(line.substr(pinPos + 6));
            int val = std::stoi(line.substr(valPos + 6));
            int prev;
            void (*isr)() = nullptr;
            {
                std::lock_guard<std::mutex> lock(pinMutex);
                prev = pinStates.count(pin) ? pinStates[pin] : LOW;
                pinStates[pin] = val;
                if (anPos != std::string::npos) analogMilliVolts[pin] = std::stoi(line.substr(anPos + 9));
                auto it = interrupts.find(pin);
                if (it != interrupts.end() && prev != val) {
                    int m = it->second.mode;
                    if (m == CHANGE || (m == RISING && val) || (m == FALLING && !val)) isr = it->second.isr;
                }
            }
            if (isr) isr(); // runs outside the lock, like a real ISR it may call digitalWrite
        } catch (...) {}
    }
}

void attachInterrupt(uint8_t interrupt, void (*isr)(), int mode) {
    std::lock_guard<std::mutex> lock(pinMutex);
    interrupts[interrupt] = { isr, mode };
}

void detachInterrupt(uint8_t interrupt) {
    std::lock_guard<std::mutex> lock(pinMutex);
    interrupts.erase(interrupt);
}

// ---------------------------------------------------------------------------
// GPIO
// ---------------------------------------------------------------------------

void pinMode(uint8_t pin, uint8_t mode) {
    emitIpc("{\"action\":\"pinMode\",\"pin\":" + std::to_string(pin) + ",\"mode\":" + std::to_string(mode) + "}");
}

void digitalWrite(uint8_t pin, uint8_t val) {
    emitIpc("{\"action\":\"digitalWrite\",\"pin\":" + std::to_string(pin) + ",\"value\":" + std::to_string(val ? 1 : 0) + "}");
}

int digitalRead(uint8_t pin) {
    std::lock_guard<std::mutex> lock(pinMutex);
    auto it = pinStates.find(pin);
    return it != pinStates.end() ? it->second : LOW;
}

static int adcBits = ADC_DEFAULT_BITS;
static int pwmBits = 8;

void analogReadResolution(int bits) { adcBits = std::min(16, std::max(1, bits)); }
void analogWriteResolution(int bits) { pwmBits = std::min(16, std::max(1, bits)); }

static uint8_t analogPin(uint8_t pin) {
#ifndef BOARD_NANO_ESP32
    if (pin <= 5) pin += A0; // UNO: analogRead(0) == analogRead(A0)
#endif
    return pin;
}

uint32_t analogReadMilliVolts(uint8_t pin) {
    std::lock_guard<std::mutex> lock(pinMutex);
    auto it = analogMilliVolts.find(analogPin(pin));
    return it != analogMilliVolts.end() ? (uint32_t)it->second : 0;
}

int analogRead(uint8_t pin) {
    const long full = (1L << adcBits) - 1;
    long value = std::lround(analogReadMilliVolts(pin) * full / 3300.0);
    return (int)std::min(full, std::max(0L, value));
}

// `value` is in the current analogWrite resolution; the app works with 0-255.
static void sendPwm(uint8_t pin, uint32_t value, int bits) {
    const double full = (double)((1UL << bits) - 1);
    long duty255 = std::lround(std::min(1.0, value / full) * 255.0);
    emitIpc("{\"action\":\"analogWrite\",\"pin\":" + std::to_string(pin) + ",\"value\":" + std::to_string(duty255) + "}");
}

void analogWrite(uint8_t pin, int val) {
    sendPwm(pin, (uint32_t)std::max(0, val), pwmBits);
}

// A passive buzzer driven with a square wave sees a 50 % duty cycle on average.
void tone(uint8_t pin, unsigned int frequency, unsigned long duration) {
    sendPwm(pin, frequency ? 128 : 0, 8);
}

void noTone(uint8_t pin) {
    sendPwm(pin, 0, 8);
}

#ifdef BOARD_NANO_ESP32
static std::map<uint8_t, int> ledcPinBits;     // pin -> resolution
static std::map<uint8_t, int> ledcChannelBits; // 2.x API: channel -> resolution
static std::map<uint8_t, uint8_t> ledcChannelPin;

bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution) {
    ledcPinBits[pin] = resolution;
    return true;
}

bool ledcDetach(uint8_t pin) {
    ledcPinBits.erase(pin);
    return true;
}

uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution) {
    ledcChannelBits[channel] = resolution;
    return freq;
}

void ledcAttachPin(uint8_t pin, uint8_t channel) {
    ledcChannelPin[channel] = pin;
}

// Sketches using the 2.x API pass a channel, 3.x sketches pass a pin.
bool ledcWrite(uint8_t pinOrChannel, uint32_t duty) {
    auto ch = ledcChannelPin.find(pinOrChannel);
    if (ch != ledcChannelPin.end()) {
        sendPwm(ch->second, duty, ledcChannelBits.count(pinOrChannel) ? ledcChannelBits[pinOrChannel] : 8);
        return true;
    }
    auto it = ledcPinBits.find(pinOrChannel);
    sendPwm(pinOrChannel, duty, it != ledcPinBits.end() ? it->second : 8);
    return true;
}
#endif

// ---------------------------------------------------------------------------
// Time and maths
// ---------------------------------------------------------------------------

void delay(unsigned long ms) {
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

void delayMicroseconds(unsigned int us) {
    std::this_thread::sleep_for(std::chrono::microseconds(us));
}

unsigned long millis() {
    auto now = std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();
}

unsigned long micros() {
    auto now = std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::microseconds>(now - startTime).count();
}

long map(long x, long inMin, long inMax, long outMin, long outMax) {
    if (inMax == inMin) return outMin;
    return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

long random(long howBig) {
    return howBig > 0 ? std::rand() % howBig : 0;
}

long random(long howSmall, long howBig) {
    return howBig > howSmall ? howSmall + random(howBig - howSmall) : howSmall;
}

void randomSeed(unsigned long seed) {
    std::srand((unsigned)seed);
}

// ---------------------------------------------------------------------------
// UNO Q LED matrix
// ---------------------------------------------------------------------------

#ifndef BOARD_NANO_ESP32
Arduino_LED_Matrix::Arduino_LED_Matrix() {
    clear();
}

void Arduino_LED_Matrix::begin() {
    clear();
}

void Arduino_LED_Matrix::loadFrame(const uint32_t buffer[3]) {
    clear();
    int bitIndex = 0;
    for (int i = 0; i < 3; i++) {
        uint32_t val = buffer[i];
        for (int b = 31; b >= 0; b--) {
            int row = bitIndex / 12;
            int col = bitIndex % 12;
            if (row < 8) {
                frameBufferUNO_Q[row][col] = (val & (1 << b)) ? 1 : 0;
            }
            bitIndex++;
        }
    }
    sendIPC();
}

void Arduino_LED_Matrix::loadFrame8x13(const uint8_t frame[8][13]) {
    for (int r = 0; r < 8; r++) {
        for (int c = 0; c < 13; c++) {
            frameBufferUNO_Q[r][c] = frame[r][c];
        }
    }
    sendIPC();
}

void Arduino_LED_Matrix::clear() {
    for (int r = 0; r < 8; r++) {
        for (int c = 0; c < 13; c++) {
            frameBufferUNO_Q[r][c] = 0;
        }
    }
    sendIPC();
}

void Arduino_LED_Matrix::sendIPC() {
    std::string arr = "[";
    for (int r = 0; r < 8; r++) {
        arr += "[";
        for (int c = 0; c < 13; c++) {
            arr += std::to_string(frameBufferUNO_Q[r][c]);
            if (c < 12) arr += ",";
        }
        arr += "]";
        if (r < 7) arr += ",";
    }
    arr += "]";
    emitIpc("{\"action\":\"matrix\",\"frame\":" + arr + "}");
}
#endif

int main(int argc, char** argv) {
    std::thread inputThread(inputListenerThread);
    inputThread.detach();

    setup();
    while (true) {
        loop();
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    return 0;
}
