// Example for circuit_test.json:
//   D4 -> pushbutton -> GND        (uses the internal pull-up)
//   D5 -> 220 ohm resistor -> LED (+, anode) ; LED (-, cathode) -> GND
void setup() {
  Serial.begin(115200);
  Serial.println("Circuit Simulator Online!");

  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(5, OUTPUT);       // D5 -> 220 ohm resistor -> LED -> GND
  pinMode(4, INPUT_PULLUP); // D4 -> pushbutton -> GND (internal pull-up)
}

void loop() {
  // With the pull-up, the pin reads LOW while the button is pressed
  int btnState = digitalRead(4);

  if (btnState == LOW) {
    digitalWrite(LED_BUILTIN, HIGH);
    digitalWrite(5, HIGH);
  } else {
    digitalWrite(LED_BUILTIN, LOW);
    digitalWrite(5, LOW);
  }

  delay(10);
}
