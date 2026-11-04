#ifndef PREFERENCES_H
#define PREFERENCES_H

// Mock of the ESP32 Preferences library (key-value store in NVS flash). The runner points
// $ARDUINO_VIRTUAL_NVS at a file in the app's build folder, so values survive a sketch restart
// (Stop / Run) like flash does, for as long as the app keeps running.
#include "Arduino.h"
#include <fstream>
#include <sstream>

#ifndef MOCK_ESP32
#error "Preferences.h needs an ESP32 board (Arduino Nano ESP32 or XIAO ESP32C3)"
#endif

class Preferences {
public:
    bool begin(const char* name, bool readOnly = false, const char* partition = nullptr) {
        if (!name || !*name) return false;
        ns = name;
        ro = readOnly;
        open = true;
        load();
        return true;
    }
    void end() { open = false; }

    bool clear() {
        if (!writable()) return false;
        auto& s = store();
        for (auto it = s.begin(); it != s.end();) it = it->first.rfind(ns + "/", 0) == 0 ? s.erase(it) : std::next(it);
        save();
        return true;
    }
    bool remove(const char* key) {
        if (!writable()) return false;
        bool erased = store().erase(full(key)) > 0;
        save();
        return erased;
    }
    bool isKey(const char* key) { return open && store().count(full(key)) > 0; }

    size_t putChar(const char* key, int8_t v) { return put(key, std::to_string(v), 1); }
    size_t putUChar(const char* key, uint8_t v) { return put(key, std::to_string(v), 1); }
    size_t putShort(const char* key, int16_t v) { return put(key, std::to_string(v), 2); }
    size_t putUShort(const char* key, uint16_t v) { return put(key, std::to_string(v), 2); }
    size_t putInt(const char* key, int32_t v) { return put(key, std::to_string(v), 4); }
    size_t putUInt(const char* key, uint32_t v) { return put(key, std::to_string(v), 4); }
    size_t putLong(const char* key, int32_t v) { return put(key, std::to_string(v), 4); }
    size_t putULong(const char* key, uint32_t v) { return put(key, std::to_string(v), 4); }
    size_t putLong64(const char* key, int64_t v) { return put(key, std::to_string(v), 8); }
    size_t putULong64(const char* key, uint64_t v) { return put(key, std::to_string(v), 8); }
    size_t putBool(const char* key, bool v) { return put(key, v ? "1" : "0", 1); }
    size_t putFloat(const char* key, float v) { return put(key, num(v), 4); }
    size_t putDouble(const char* key, double v) { return put(key, num(v), 8); }
    size_t putString(const char* key, const char* v) { return put(key, v ? v : "", v ? strlen(v) : 0); }
    size_t putString(const char* key, const String& v) { return put(key, v, v.length()); }

    int8_t getChar(const char* key, int8_t def = 0) { return (int8_t)getNum(key, def); }
    uint8_t getUChar(const char* key, uint8_t def = 0) { return (uint8_t)getNum(key, def); }
    int16_t getShort(const char* key, int16_t def = 0) { return (int16_t)getNum(key, def); }
    uint16_t getUShort(const char* key, uint16_t def = 0) { return (uint16_t)getNum(key, def); }
    int32_t getInt(const char* key, int32_t def = 0) { return (int32_t)getNum(key, def); }
    uint32_t getUInt(const char* key, uint32_t def = 0) { return (uint32_t)getNum(key, def); }
    int32_t getLong(const char* key, int32_t def = 0) { return (int32_t)getNum(key, def); }
    uint32_t getULong(const char* key, uint32_t def = 0) { return (uint32_t)getNum(key, def); }
    int64_t getLong64(const char* key, int64_t def = 0) { return (int64_t)getNum(key, (double)def); }
    uint64_t getULong64(const char* key, uint64_t def = 0) { return (uint64_t)getNum(key, (double)def); }
    bool getBool(const char* key, bool def = false) { return getNum(key, def ? 1 : 0) != 0; }
    float getFloat(const char* key, float def = NAN) { return (float)getNum(key, def); }
    double getDouble(const char* key, double def = NAN) { return getNum(key, def); }
    String getString(const char* key, const String& def = String()) {
        auto* v = get(key);
        return v ? String(*v) : def;
    }

private:
    std::string ns;
    bool ro = false;
    bool open = false;

    static std::map<std::string, std::string>& store() {
        static std::map<std::string, std::string> s;
        return s;
    }
    static const char* path() { return std::getenv("ARDUINO_VIRTUAL_NVS"); }

    // One "namespace/key<TAB>value" line per entry.
    static void load() {
        static bool loaded = false;
        if (loaded) return;
        loaded = true;
        const char* p = path();
        if (!p) return;
        std::ifstream in(p);
        std::string line;
        while (std::getline(in, line)) {
            size_t tab = line.find('\t');
            if (tab != std::string::npos) store()[line.substr(0, tab)] = line.substr(tab + 1);
        }
    }
    static void save() {
        const char* p = path();
        if (!p) return;
        std::ofstream out(p, std::ios::trunc);
        for (auto& [k, v] : store()) out << k << '\t' << v << '\n';
    }

    static std::string num(double v) {
        std::ostringstream s;
        s.precision(17);
        s << v;
        return s.str();
    }

    bool writable() const { return open && !ro; }
    std::string full(const char* key) const { return ns + "/" + (key ? key : ""); }

    size_t put(const char* key, const std::string& value, size_t size) {
        if (!writable() || !key || !*key) return 0;
        std::string clean = value;
        std::replace(clean.begin(), clean.end(), '\n', ' ');
        store()[full(key)] = clean;
        save();
        return size;
    }
    const std::string* get(const char* key) {
        if (!open) return nullptr;
        auto it = store().find(full(key));
        return it == store().end() ? nullptr : &it->second;
    }
    double getNum(const char* key, double def) {
        auto* v = get(key);
        if (!v) return def;
        try { return std::stod(*v); } catch (...) { return def; }
    }
};

#endif // PREFERENCES_H
