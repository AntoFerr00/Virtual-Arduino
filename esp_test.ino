// Arduino Nano ESP32 example for esp_test.json (select "Arduino Nano ESP32" as the board):
//   D4  -> pushbutton -> GND                    (uses the internal pull-up)
//   D5  -> 220 ohm resistor -> LED (+, anode) ; LED (-, cathode) -> GND
//   3V3 -> potentiometer -> GND, wiper -> A0    (never 5 V: the ESP32 pins are 3.3 V only)
const int BUTTON = 4;
const int LED = 5;
const int POT = A0;

void setup() {
  Serial.begin(115200);
  Serial.println("Nano ESP32 ready");

  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  int raw = analogRead(POT);              // 0-4095: the ESP32 ADC is 12-bit
  uint32_t mv = analogReadMilliVolts(POT);
  bool pressed = digitalRead(BUTTON) == LOW;

  // While the button is held, the potentiometer sets the LED brightness (PWM)
  analogWrite(LED, pressed ? map(raw, 0, 4095, 0, 255) : 0);
  digitalWrite(LED_BUILTIN, pressed ? HIGH : LOW);

  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 500) {
    lastPrint = millis();
    Serial.printf("pot: %4d (%lu mV)  button: %s\n", raw, (unsigned long)mv, pressed ? "pressed" : "released");
  }
  delay(10);
}
