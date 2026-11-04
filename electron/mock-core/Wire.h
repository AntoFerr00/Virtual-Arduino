#ifndef WIRE_H
#define WIRE_H

#include <cstdint>
#include <cstddef>
#include <vector>

// I2C master on A4 (SDA) / A5 (SCL). The app tells the sketch which addresses answer on the
// bus (parts that are powered and wired to A4/A5); everything else NACKs like a real bus.
// Simulated devices: MPU-6050 at 0x68 (level and motionless: az = +1 g, no rotation).
class TwoWire {
public:
    void begin() {}
    void begin(int address) {} // slave mode: not simulated
    void end() {}
    void setClock(uint32_t clock) {}

    void beginTransmission(int address);
    size_t write(int data);
    size_t write(const uint8_t* data, size_t quantity);
    // 0 = success, 2 = NACK on address (no device answering)
    uint8_t endTransmission(int sendStop = 1);

    // Returns the number of bytes received: 0 if no device answers at that address.
    uint8_t requestFrom(int address, int quantity, int sendStop = 1);
    int available();
    int read();
    int peek();

private:
    int txAddress = -1;
    std::vector<uint8_t> txBuffer;
    std::vector<uint8_t> rxBuffer;
    size_t rxIndex = 0;
};

extern TwoWire Wire;

// Called by the mock core when the app reports the addresses on the bus.
void i2cSetBus(const std::vector<int>& addresses);

#endif // WIRE_H
