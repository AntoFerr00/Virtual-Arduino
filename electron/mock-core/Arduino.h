#ifndef ARDUINO_H
#define ARDUINO_H

#include <string>
#include <iostream>
#include <chrono>
#include <thread>
#include <map>
#include <vector>
#include <mutex>

#define HIGH 0x1
#define LOW  0x0

#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2

// Standard Arduino pins
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

typedef uint8_t byte;

// Core functions
void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogWrite(uint8_t pin, int val);

void delay(unsigned long ms);
void delayMicroseconds(unsigned int us);
unsigned long millis();
unsigned long micros();

// Serial mock
class SerialMock {
public:
    void begin(unsigned long baudrate) {}
    void print(const std::string& s) {
        std::cout << s;
        std::cout.flush();
    }
    void print(int n) {
        std::cout << n;
        std::cout.flush();
    }
    void println(const std::string& s) {
        std::cout << s << std::endl;
    }
    void println(int n) {
        std::cout << n << std::endl;
    }
    void println() {
        std::cout << std::endl;
    }
};

extern SerialMock Serial;

// Arduino_LED_Matrix Mock
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

// User sketch functions
void setup();
void loop();

// Real main function
int main(int argc, char** argv);

#endif // ARDUINO_H
