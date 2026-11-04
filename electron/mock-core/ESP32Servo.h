#ifndef ESP32_SERVO_H
#define ESP32_SERVO_H

// Mock of the ESP32Servo library (madhephaestus/ESP32Servo). A servo is a LEDC PWM output at
// 50 Hz (setPeriodHertz) whose pulse width sets the angle; the app's servo reads that width.
#include "Arduino.h"

#ifndef MOCK_ESP32
#error "ESP32Servo.h needs an ESP32 board (Arduino Nano ESP32 or XIAO ESP32C3)"
#endif

#define MIN_PULSE_WIDTH 544
#define MAX_PULSE_WIDTH 2400
#define DEFAULT_PULSE_WIDTH 1500

// Timers are not simulated: allocating one always succeeds.
class ESP32PWM {
public:
    static void allocateTimer(int timer) {}
};

class Servo {
public:
    void setPeriodHertz(int hz) { if (hz > 0) periodHz = hz; }

    int attach(int pin) { return attach(pin, MIN_PULSE_WIDTH, MAX_PULSE_WIDTH); }
    int attach(int pin, int minUs, int maxUs) {
        this->pin = pin;
        this->minUs = minUs;
        this->maxUs = maxUs;
        lastUs = -1;
        ledcAttach((uint8_t)pin, (uint32_t)periodHz, BITS);
        return 1;
    }

    void detach() {
        if (pin < 0) return;
        ledcWrite((uint8_t)pin, 0); // no more pulses: the servo goes limp
        ledcDetach((uint8_t)pin);
        pin = -1;
    }
    bool attached() const { return pin >= 0; }

    // Below MIN_PULSE_WIDTH the value is an angle in degrees, as in the Arduino Servo library.
    void write(int value) {
        if (value < MIN_PULSE_WIDTH) value = map(constrain(value, 0, 180), 0, 180, minUs, maxUs);
        writeMicroseconds(value);
    }

    void writeMicroseconds(int us) {
        if (pin < 0) return;
        us = constrain(us, minUs, maxUs);
        current = us;
        if (us == lastUs) return; // the pulse train repeats by itself: send only changes
        lastUs = us;
        const double full = (double)((1UL << BITS) - 1);
        ledcWrite((uint8_t)pin, (uint32_t)std::lround(us * full * periodHz / 1e6));
    }

    int read() const { return (int)map(current, minUs, maxUs, 0, 180); }
    int readMicroseconds() const { return current; }

private:
    static const uint8_t BITS = 16;
    int pin = -1;
    int minUs = MIN_PULSE_WIDTH;
    int maxUs = MAX_PULSE_WIDTH;
    int periodHz = 50;
    int current = DEFAULT_PULSE_WIDTH;
    int lastUs = -1;
};

#endif // ESP32_SERVO_H
