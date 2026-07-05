#include "Arduino.h"

Arduino_LED_Matrix matrix;

void setup() {
  Serial.begin(115200);
  matrix.begin();

  uint8_t smiley[8][13] = {
    { 0,0,0,0,0,0,0,0,0,0,0,0,0 },
    { 0,0,0,0,0,0,0,0,0,0,0,0,0 },
    { 0,0,0,1,0,0,0,0,0,1,0,0,0 },
    { 0,0,0,1,0,0,0,0,0,1,0,0,0 },
    { 0,0,0,0,0,0,0,0,0,0,0,0,0 },
    { 0,0,1,0,0,0,0,0,0,0,1,0,0 },
    { 0,0,0,1,1,1,1,1,1,1,0,0,0 },
    { 0,0,0,0,0,0,0,0,0,0,0,0,0 }
  };

  matrix.loadFrame8x13(smiley);
  Serial.println("Smiling face displayed!");
}

void loop() {
  delay(100);
}
