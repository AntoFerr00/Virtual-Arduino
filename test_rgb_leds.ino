#include "Arduino.h"

void setup() {
  Serial.begin(115200);
  Serial.println("Starting RGB LEDs test...");
  
  // Initialize all RGB LED pins as OUTPUT
  int ledPins[] = {
    RGB1_R, RGB1_G, RGB1_B,
    RGB2_R, RGB2_G, RGB2_B,
    RGB3_R, RGB3_G, RGB3_B,
    RGB4_R, RGB4_G, RGB4_B
  };
  
  for(int i = 0; i < 12; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW); // Ensure they start OFF
  }
}

void loop() {
  // --- Test LED 1 ---
  Serial.println("Testing LED 1 (Red, Green, Blue)...");
  digitalWrite(RGB1_R, HIGH); delay(300); digitalWrite(RGB1_R, LOW);
  digitalWrite(RGB1_G, HIGH); delay(300); digitalWrite(RGB1_G, LOW);
  digitalWrite(RGB1_B, HIGH); delay(300); digitalWrite(RGB1_B, LOW);

  // --- Test LED 2 ---
  Serial.println("Testing LED 2 (Red, Green, Blue)...");
  digitalWrite(RGB2_R, HIGH); delay(300); digitalWrite(RGB2_R, LOW);
  digitalWrite(RGB2_G, HIGH); delay(300); digitalWrite(RGB2_G, LOW);
  digitalWrite(RGB2_B, HIGH); delay(300); digitalWrite(RGB2_B, LOW);

  // --- Test LED 3 ---
  Serial.println("Testing LED 3 (Red, Green, Blue)...");
  digitalWrite(RGB3_R, HIGH); delay(300); digitalWrite(RGB3_R, LOW);
  digitalWrite(RGB3_G, HIGH); delay(300); digitalWrite(RGB3_G, LOW);
  digitalWrite(RGB3_B, HIGH); delay(300); digitalWrite(RGB3_B, LOW);

  // --- Test LED 4 ---
  Serial.println("Testing LED 4 (Red, Green, Blue)...");
  digitalWrite(RGB4_R, HIGH); delay(300); digitalWrite(RGB4_R, LOW);
  digitalWrite(RGB4_G, HIGH); delay(300); digitalWrite(RGB4_G, LOW);
  digitalWrite(RGB4_B, HIGH); delay(300); digitalWrite(RGB4_B, LOW);
  
  // --- All LEDs ON (White) ---
  Serial.println("All LEDs ON (White)...");
  int ledPins[] = {
    RGB1_R, RGB1_G, RGB1_B,
    RGB2_R, RGB2_G, RGB2_B,
    RGB3_R, RGB3_G, RGB3_B,
    RGB4_R, RGB4_G, RGB4_B
  };
  for(int i = 0; i < 12; i++) {
    digitalWrite(ledPins[i], HIGH);
  }
  
  delay(1000);
  
  // Turn all OFF
  for(int i = 0; i < 12; i++) {
    digitalWrite(ledPins[i], LOW);
  }
  
  delay(1000);
}
