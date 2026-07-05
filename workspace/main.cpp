#include "Arduino.h"
void setup() {
  Serial.begin(115200);
  Serial.println("Circuit Simulator Online!");
  
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(5, OUTPUT); // External LED on Pin 5
  pinMode(4, INPUT);  // Pushbutton on Pin 4
}

void loop() {
  // If button on pin 4 is pressed, turn on external LED and built-in LED
  int btnState = digitalRead(4);
  
  if (btnState == HIGH) {
    digitalWrite(LED_BUILTIN, HIGH);
    digitalWrite(5, HIGH);
  } else {
    digitalWrite(LED_BUILTIN, LOW);
    digitalWrite(5, LOW);
  }
  
  delay(10);
}
