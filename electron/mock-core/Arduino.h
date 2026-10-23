#ifndef ARDUINO_H
#define ARDUINO_H

// Mock Arduino core: sketches are compiled natively and exchange pin states with the app's
// circuit simulation over stdin/stdout. The board is selected at compile time:
//   (default)            Arduino UNO Q      (ABX00162, STM32U585 MCU side)
//   -DBOARD_NANO_ESP32   Arduino Nano ESP32 (ABX00083, ESP32-S3)

#include <string>
#include <iostream>
#include <chrono>
#include <thread>
#include <map>
#include <vector>
#include <mutex>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdarg>
#include <cstdlib>

#define HIGH 0x1
#define LOW  0x0

#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#define INPUT_PULLDOWN 0x3

#define RISING 0x1
#define FALLING 0x2
#define CHANGE 0x3

#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

#ifdef BOARD_NANO_ESP32
// ---- Arduino Nano ESP32 -------------------------------------------------------
#define ARDUINO_NANO_ESP32
#define ESP32
#define LED_BUILTIN 13 // D13 (GPIO48), shared with the header pin
// Onboard RGB LED, active LOW (write LOW to light a colour)
#define LED_RED   14
#define LED_GREEN 15
#define LED_BLUE  16
// Analog inputs: A0-A7 are Arduino pins 17-24
#define A0 17
#define A1 18
#define A2 19
#define A3 20
#define A4 21
#define A5 22
#define A6 23
#define A7 24
#define ADC_DEFAULT_BITS 12
#else
// ---- Arduino UNO Q ------------------------------------------------------------
#define ARDUINO_UNO_Q
#define LED_BUILTIN 13

// MPU RGB LED 1 (Linux controlled usually, but we expose it for mock)
#define RGB1_R 141
#define RGB1_G 142
#define RGB1_B 160

// MPU RGB LED 2
#define RGB2_R 139
#define RGB2_G 140
#define RGB2_B 147

// MCU RGB LED 3 (PH10, PH11, PH12)
#define RGB3_R 210
#define RGB3_G 211
#define RGB3_B 212

// MCU RGB LED 4 (PH13, PH14, PH15)
#define RGB4_R 213
#define RGB4_G 214
#define RGB4_B 215

// Analog inputs (JANALOG): A0-A5 are digital pins 14-19
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19
#define ADC_DEFAULT_BITS 10
#endif

typedef uint8_t byte;
typedef bool boolean;
typedef uint16_t word;
#define F(x) (x)
#define PROGMEM
#ifndef PI
#define PI 3.14159265358979323846
#endif

using std::min;
using std::max;

// Core functions
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
uint32_t analogReadMilliVolts(uint8_t pin);
void analogReadResolution(int bits);
void analogWrite(uint8_t pin, int val);
void analogWriteResolution(int bits);
void tone(uint8_t pin, unsigned int frequency, unsigned long duration = 0);
void noTone(uint8_t pin);

#define digitalPinToInterrupt(p) (p)
void attachInterrupt(uint8_t interrupt, void (*isr)(), int mode);
void detachInterrupt(uint8_t interrupt);

void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
unsigned long millis();
unsigned long micros();

long map(long x, long inMin, long inMax, long outMin, long outMax);
template <typename T, typename L, typename H>
T constrain(T x, L low, H high) { return x < low ? (T)low : (x > high ? (T)high : x); }
long random(long howBig);
long random(long howSmall, long howBig);
void randomSeed(unsigned long seed);

#ifdef BOARD_NANO_ESP32
// ESP32 LEDC PWM (Arduino-ESP32 3.x pin-based API, plus the 2.x channel API)
bool ledcAttach(uint8_t pin, uint32_t freq, uint8_t resolution);
bool ledcWrite(uint8_t pinOrChannel, uint32_t duty);
bool ledcDetach(uint8_t pin);
uint32_t ledcSetup(uint8_t channel, uint32_t freq, uint8_t resolution);
void ledcAttachPin(uint8_t pin, uint8_t channel);
#endif

// Arduino String (subset)
class String : public std::string {
public:
    String() {}
    String(const char* s) : std::string(s ? s : "") {}
    String(const std::string& s) : std::string(s) {}
    explicit String(char c) : std::string(1, c) {}
    explicit String(int v, int base = DEC) : std::string(toBase((long)v, base)) {}
    explicit String(unsigned int v, int base = DEC) : std::string(toBase((long)v, base)) {}
    explicit String(long v, int base = DEC) : std::string(toBase(v, base)) {}
    explicit String(unsigned long v, int base = DEC) : std::string(toBase((long)v, base)) {}
    explicit String(double v, int decimals = 2) : std::string(fixed(v, decimals)) {}
    unsigned int length() const { return (unsigned int)size(); }
    long toInt() const { return std::atol(c_str()); }
    float toFloat() const { return (float)std::atof(c_str()); }
    int indexOf(char c, unsigned int from = 0) const { size_t p = find(c, from); return p == npos ? -1 : (int)p; }
    int indexOf(const std::string& s, unsigned int from = 0) const { size_t p = find(s, from); return p == npos ? -1 : (int)p; }
    String substring(unsigned int from) const { return from >= size() ? String() : String(substr(from)); }
    String substring(unsigned int from, unsigned int to) const { return from >= size() ? String() : String(substr(from, to > from ? to - from : 0)); }
    bool equals(const std::string& s) const { return *this == s; }
    void toUpperCase() { for (auto& ch : *this) ch = (char)toupper(ch); }
    void toLowerCase() { for (auto& ch : *this) ch = (char)tolower(ch); }
    void trim() { size_t a = find_first_not_of(" \t\r\n"); size_t b = find_last_not_of(" \t\r\n"); *this = a == npos ? String() : String(substr(a, b - a + 1)); }
    static std::string toBase(long v, int base);
    static std::string fixed(double v, int decimals);
};

// Serial mock: everything printed goes to the app's Serial Monitor.
class SerialMock {
public:
    void begin(unsigned long baudrate) {}
    void end() {}
    operator bool() const { return true; }
    int available() { return 0; }
    int read() { return -1; }
    int peek() { return -1; }
    void flush() {}

    size_t print(const char* s);
    size_t print(const std::string& s) { return print(s.c_str()); }
    size_t print(char c) { char b[2] = { c, 0 }; return print(b); }
    size_t print(int n, int base = DEC) { return print(String::toBase(n, base)); }
    size_t print(unsigned int n, int base = DEC) { return print(String::toBase((long)n, base)); }
    size_t print(long n, int base = DEC) { return print(String::toBase(n, base)); }
    size_t print(unsigned long n, int base = DEC) { return print(String::toBase((long)n, base)); }
    size_t print(double n, int decimals = 2) { return print(String::fixed(n, decimals)); }

    size_t println() { return print("\n"); }
    template <typename T> size_t println(const T& v) { size_t n = print(v); return n + println(); }
    template <typename T> size_t println(const T& v, int format) { size_t n = print(v, format); return n + println(); }

    size_t printf(const char* format, ...);
    size_t write(uint8_t c) { return print((char)c); }
};

extern SerialMock Serial;

#ifndef BOARD_NANO_ESP32
// Arduino_LED_Matrix Mock (UNO Q 8x13 matrix)
class Arduino_LED_Matrix {
private:
    uint8_t frameBufferUNO_Q[8][13];
public:
    Arduino_LED_Matrix();
    void begin();
    // Loads an 8x12 frame (standard Arduino R4 syntax)
    void loadFrame(const uint32_t buffer[3]);
    // Custom method for the 8x13 matrix
    void loadFrame8x13(const uint8_t frame[8][13]);
    void clear();
private:
    void sendIPC();
};
#endif

// User sketch functions
void setup();
void loop();

// Real main function
int main(int argc, char** argv);

#endif // ARDUINO_H
