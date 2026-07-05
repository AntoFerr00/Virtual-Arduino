#include "Arduino.h"

SerialMock Serial;
static auto startTime = std::chrono::steady_clock::now();

std::map<uint8_t, int> pinStates;
std::mutex pinMutex;

void inputListenerThread() {
    std::string line;
    while (std::getline(std::cin, line)) {
        // Very basic JSON parser for {"pin": X, "val": Y}
        auto pinPos = line.find("\"pin\":");
        auto valPos = line.find("\"val\":");
        if (pinPos != std::string::npos && valPos != std::string::npos) {
            try {
                int pin = std::stoi(line.substr(pinPos + 6));
                int val = std::stoi(line.substr(valPos + 6));
                std::lock_guard<std::mutex> lock(pinMutex);
                pinStates[pin] = val;
            } catch (...) {}
        }
    }
}

void pinMode(uint8_t pin, uint8_t mode) {
    std::cout << "IPC_MSG:{\"action\":\"pinMode\",\"pin\":" << (int)pin << ",\"mode\":" << (int)mode << "}" << std::endl;
}

void digitalWrite(uint8_t pin, uint8_t val) {
    std::cout << "IPC_MSG:{\"action\":\"digitalWrite\",\"pin\":" << (int)pin << ",\"value\":" << (int)val << "}" << std::endl;
}

int digitalRead(uint8_t pin) {
    std::lock_guard<std::mutex> lock(pinMutex);
    if (pinStates.find(pin) != pinStates.end()) {
        return pinStates[pin];
    }
    return LOW; // Default to LOW
}

int analogRead(uint8_t pin) {
    // Similarly we could extend this to "analogVal" later
    return 0;
}

void analogWrite(uint8_t pin, int val) {
    std::cout << "IPC_MSG:{\"action\":\"analogWrite\",\"pin\":" << (int)pin << ",\"value\":" << val << "}" << std::endl;
}

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
    std::cout << "IPC_MSG:{\"action\":\"matrix\",\"frame\":" << arr << "}" << std::endl;
}

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
