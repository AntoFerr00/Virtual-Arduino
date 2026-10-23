#include "Wire.h"
#include <algorithm>
#include <mutex>
#include <set>

TwoWire Wire;

static const size_t BUFFER_LENGTH = 32; // same receive/transmit buffer as the Arduino Wire library

// ---------------------------------------------------------------------------
// MPU-6050 register model (GY-521 module, AD0 low: address 0x68)
// ---------------------------------------------------------------------------
namespace {

const int MPU_ADDRESS = 0x68;
const uint8_t REG_ACCEL_CONFIG = 0x1C;
const uint8_t REG_ACCEL_XOUT_H = 0x3B; // ACCEL_XOUT_H .. GYRO_ZOUT_L = 0x3B .. 0x48
const uint8_t REG_PWR_MGMT_1 = 0x6B;
const uint8_t REG_WHO_AM_I = 0x75;

class Mpu6050 {
public:
    Mpu6050() { reset(); }

    void reset() {
        std::fill(std::begin(regs), std::end(regs), 0);
        regs[REG_PWR_MGMT_1] = 0x40; // wakes up asleep: write 0 to PWR_MGMT_1 first
        regs[REG_WHO_AM_I] = MPU_ADDRESS;
        pointer = 0;
    }

    // First byte of a write sets the register pointer, the rest are written from there on.
    void write(const std::vector<uint8_t>& bytes) {
        if (bytes.empty()) return;
        pointer = bytes[0] & 0x7F;
        for (size_t i = 1; i < bytes.size(); i++) writeRegister(pointer++, bytes[i]);
        pointer &= 0x7F;
    }

    // A read burst (one requestFrom) sees one consistent sample.
    void beginRead() { sample(); }

    uint8_t read() {
        uint8_t value = regs[pointer];
        pointer = (pointer + 1) & 0x7F;
        return value;
    }

private:
    uint8_t regs[128];
    uint8_t pointer = 0;

    void writeRegister(uint8_t reg, uint8_t value) {
        reg &= 0x7F;
        if ((reg >= REG_ACCEL_XOUT_H && reg <= 0x60) || reg == REG_WHO_AM_I) return; // read-only
        if (reg == REG_PWR_MGMT_1 && (value & 0x80)) { reset(); return; } // DEVICE_RESET
        regs[reg] = value;
    }

    void put16(uint8_t reg, int value) {
        value = std::max(-32768, std::min(32767, value));
        regs[reg] = (uint8_t)((value >> 8) & 0xFF);
        regs[reg + 1] = (uint8_t)(value & 0xFF);
    }

    // Asleep (PWR_MGMT_1 bit 6) the data registers keep their last value, as on the chip.
    void sample() {
        if (regs[REG_PWR_MGMT_1] & 0x40) return;
        int afsSel = (regs[REG_ACCEL_CONFIG] >> 3) & 0x03; // ±2/4/8/16 g -> 16384/8192/4096/2048 LSB/g
        int lsbPerG = 16384 >> afsSel;
        put16(REG_ACCEL_XOUT_H, 0);           // ax
        put16(REG_ACCEL_XOUT_H + 2, 0);       // ay
        put16(REG_ACCEL_XOUT_H + 4, lsbPerG); // az = +1 g: lying flat, chip side up
        put16(0x41, (int)((25.0 - 36.53) * 340)); // TEMP_OUT: 25 °C
        put16(0x43, 0); put16(0x45, 0); put16(0x47, 0); // gyro: not rotating
    }
};

std::mutex busMutex;
std::set<int> busAddresses; // addresses that answer, as reported by the app
Mpu6050 mpu;

bool answers(int address) {
    return busAddresses.count(address) > 0;
}

} // namespace

void i2cSetBus(const std::vector<int>& addresses) {
    std::lock_guard<std::mutex> lock(busMutex);
    std::set<int> next(addresses.begin(), addresses.end());
    if (next.count(MPU_ADDRESS) && !busAddresses.count(MPU_ADDRESS)) mpu.reset(); // power-on state
    busAddresses = next;
}

// ---------------------------------------------------------------------------
// TwoWire
// ---------------------------------------------------------------------------

void TwoWire::beginTransmission(int address) {
    txAddress = address;
    txBuffer.clear();
}

size_t TwoWire::write(int data) {
    if (txAddress < 0 || txBuffer.size() >= BUFFER_LENGTH) return 0;
    txBuffer.push_back((uint8_t)data);
    return 1;
}

size_t TwoWire::write(const uint8_t* data, size_t quantity) {
    size_t n = 0;
    while (n < quantity && write(data[n])) n++;
    return n;
}

uint8_t TwoWire::endTransmission(int sendStop) {
    int address = txAddress;
    txAddress = -1;
    std::lock_guard<std::mutex> lock(busMutex);
    if (!answers(address)) return 2;
    if (address == MPU_ADDRESS) mpu.write(txBuffer);
    txBuffer.clear();
    return 0;
}

uint8_t TwoWire::requestFrom(int address, int quantity, int sendStop) {
    rxBuffer.clear();
    rxIndex = 0;
    std::lock_guard<std::mutex> lock(busMutex);
    if (!answers(address) || quantity <= 0) return 0;
    size_t n = std::min((size_t)quantity, BUFFER_LENGTH);
    if (address == MPU_ADDRESS) mpu.beginRead();
    for (size_t i = 0; i < n; i++) rxBuffer.push_back(address == MPU_ADDRESS ? mpu.read() : 0xFF);
    return (uint8_t)n;
}

int TwoWire::available() {
    return (int)(rxBuffer.size() - rxIndex);
}

int TwoWire::read() {
    return rxIndex < rxBuffer.size() ? rxBuffer[rxIndex++] : -1;
}

int TwoWire::peek() {
    return rxIndex < rxBuffer.size() ? rxBuffer[rxIndex] : -1;
}
