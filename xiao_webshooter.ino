// Lanciaragnatele - firmware per Seeed XIAO ESP32-C3
//
// Un servo sub-micro spinge con la squadretta la coda della leva della valvola a pinza:
// a riposo l'elastico tiene la valvola chiusa, il servo la apre di quanto serve.
// Il servo e' alimentato direttamente dalla LiPo (serve un modello "1S", 3,7-4,2 V).
// Un sensore di forza (FSR) nel palmo fa da grilletto, un pulsante cambia
// modalita', un motorino a vibrazione conferma la modalita' scelta.
// Otto LED indirizzabili sul coperchio dell'orologio mostrano due barre:
// riga 1 = carica della batteria, riga 2 = fluido rimasto nella cartuccia.
//
// Modalita' (pressione breve del pulsante per passare alla successiva):
//   1 vibrazione  = CONTINUO  getto continuo, la portata segue la forza sul sensore
//   2 vibrazioni  = RAFFICA   palline in serie, piu' premi piu' sono fitte
//   3 vibrazioni  = SINGOLO   una pallina per ogni pressione
// Pressione lunga del pulsante (1,5 s): cartuccia nuova, livello del fluido al 100%.
// Tenere premuto il pulsante all'accensione: modalita' taratura del servo.
//
// Il livello del fluido e' una stima: si calcola dal tempo totale di apertura
// della valvola rispetto a FULL_SYRINGE_OPEN_MS, e resta salvato anche da spento.
//
// Librerie richieste: ESP32Servo, Adafruit NeoPixel (dal Gestore librerie).
// Scheda: "XIAO_ESP32C3" (pacchetto esp32 di Espressif).

#include <ESP32Servo.h>
#include <Adafruit_NeoPixel.h>
#include <Preferences.h>

// ---------- Pin (numeri GPIO del XIAO ESP32-C3) ----------
const int PIN_FSR    = 3;   // D1/A1: FSR verso 3V3, 10k verso GND
const int PIN_BATT   = 4;   // D2/A2: partitore 100k/100k dalla batteria
const int PIN_VIBRO  = 5;   // D3: base del transistor del motorino (via 1k)
const int PIN_LEDS   = 6;   // D4: ingresso dati della striscia LED (via 330 ohm)
const int PIN_BUTTON = 7;   // D5: pulsante verso GND
const int PIN_SERVO  = 10;  // D10: segnale del servo

// ---------- Taratura del servo (microsecondi, trovali in modalita' taratura) ----------
const int SERVO_CLOSED_US = 1000;  // squadretta appena staccata dal pattino: valvola chiusa
const int SERVO_OPEN_US   = 1600;  // valvola tutta aperta
const int CAL_MIN_US      = 700;   // escursione usata in modalita' taratura
const int CAL_MAX_US      = 2100;

// ---------- Sensore di forza (letture ADC 0-4095) ----------
const int FSR_ON   = 400;   // oltre questa soglia il grilletto e' premuto
const int FSR_OFF  = 280;   // sotto questa soglia e' rilasciato (isteresi)
const int FSR_FULL = 3000;  // pressione piena

// ---------- Getto ----------
const float CONT_MIN_OPEN = 0.25;          // apertura minima in continuo (sotto non esce nulla)
const unsigned long BURST_OPEN_MS  = 40;   // durata di ogni pallina in raffica
const unsigned long BURST_GAP_SLOW = 250;  // pausa tra palline con pressione leggera
const unsigned long BURST_GAP_FAST = 60;   // pausa tra palline con pressione piena
const unsigned long SINGLE_OPEN_MS = 60;   // durata del colpo singolo
const unsigned long SERVO_TRAVEL_MS = 25;  // tempo del servo per aprire la valvola

// ---------- Cartuccia ----------
// La molla dentro la cartuccia spinge meno quando si allunga (cartuccia vuota):
// gli impulsi si allungano in proporzione al tempo di apertura accumulato
// dall'ultima ricarica. Lo stesso conteggio da' il livello del fluido sui LED.
const unsigned long FULL_SYRINGE_OPEN_MS = 3000;  // apertura totale che svuota la cartuccia (da misurare)
const float COMP_GAIN = 0.6;                       // a cartuccia vuota impulsi piu' lunghi del 60%
const unsigned long SAVE_DELAY_MS = 3000;          // salva il livello 3 s dopo l'ultimo sparo

// ---------- Batteria ----------
const int BATT_LOW_MV = 3400;
const unsigned long BATT_CHECK_MS = 10000;

// ---------- LED ----------
const int NUM_LEDS = 8;               // 4 batteria + 4 fluido, in fila sulla striscia
const uint8_t LED_BRIGHTNESS = 25;    // 0-255: bassa, per non abbagliare e risparmiare
const unsigned long GAUGE_SHOW_MS = 3000;  // quanto restano accese le barre
const unsigned long GAUGE_AFTER_SHOT_MS = 1500;

const bool DEBUG = true;   // stampa i valori sul monitor seriale (115200)

enum Mode { CONTINUO, RAFFICA, SINGOLO, NUM_MODES };
const char *MODE_NAMES[] = { "CONTINUO", "RAFFICA", "SINGOLO" };

Servo valve;
Adafruit_NeoPixel leds(NUM_LEDS, PIN_LEDS, NEO_GRB + NEO_KHZ800);
Preferences prefs;
Mode mode = CONTINUO;
bool calibration = false;

float fsr = 0;                 // lettura filtrata del sensore
bool pressed = false;
float valveOpen = 0;           // 0 = chiusa, 1 = tutta aperta
float openTotalMs = 0;         // apertura accumulata dall'ultima ricarica
float savedOpenTotalMs = 0;
unsigned long lastShot = 0;

bool burstIsOpen = false;
unsigned long burstPhaseStart = 0;
bool singleActive = false;
unsigned long singleEnd = 0;

bool buttonDown = false;
bool longPressDone = false;
unsigned long buttonSince = 0;

int buzzLeft = 0;
unsigned long buzzLen = 0;
bool buzzOn = false;
unsigned long buzzT = 0;

int battMv = 0;
bool battLow = false;
unsigned long gaugesUntil = 0;
unsigned long lastLedUpdate = 0;
bool ledsLit = false;

unsigned long lastTick = 0;
unsigned long lastBattCheck = 0;
unsigned long lastDebug = 0;

// ---------- Uscite ----------

void setValve(float amount) {
  valveOpen = constrain(amount, 0.0f, 1.0f);
  valve.writeMicroseconds(SERVO_CLOSED_US + (int)((SERVO_OPEN_US - SERVO_CLOSED_US) * valveOpen));
}

void buzz(int count, unsigned long len) {
  buzzLeft = count;
  buzzLen = len;
  buzzOn = false;
  buzzT = 0;
}

void updateBuzz(unsigned long now) {
  if (buzzOn && now - buzzT >= buzzLen) {
    digitalWrite(PIN_VIBRO, LOW);
    buzzOn = false;
    buzzT = now;
  } else if (!buzzOn && buzzLeft > 0 && now - buzzT >= 150) {
    digitalWrite(PIN_VIBRO, HIGH);
    buzzOn = true;
    buzzT = now;
    buzzLeft--;
  }
}

// ---------- Livelli ----------

// Curva di scarica tipica di una LiPo 1S a riposo (mV -> %)
int batteryPercent(int mv) {
  const int pts[][2] = { {3300, 0}, {3500, 5}, {3600, 10}, {3700, 25}, {3750, 40},
                         {3800, 55}, {3900, 70}, {4000, 80}, {4100, 90}, {4200, 100} };
  const int n = sizeof(pts) / sizeof(pts[0]);
  if (mv <= pts[0][0]) return 0;
  for (int i = 1; i < n; i++) {
    if (mv <= pts[i][0])
      return map(mv, pts[i - 1][0], pts[i][0], pts[i - 1][1], pts[i][1]);
  }
  return 100;
}

float usedFraction() {
  return min(1.0f, openTotalMs / FULL_SYRINGE_OPEN_MS);
}

int fluidPercent() {
  return (int)(100 * (1 - usedFraction()) + 0.5f);
}

// ---------- LED ----------

void showGauges(unsigned long now, unsigned long ms) {
  if (now + ms > gaugesUntil) gaugesUntil = now + ms;
}

// Una barra da 4 LED: i LED pieni sono accesi, l'ultimo e' sfumato in proporzione.
void drawBar(int first, int percent, uint32_t color) {
  float level = percent / 25.0f;
  for (int i = 0; i < 4; i++) {
    float f = constrain(level - i, 0.0f, 1.0f);
    uint8_t r = (uint8_t)(((color >> 16) & 0xFF) * f);
    uint8_t g = (uint8_t)(((color >> 8) & 0xFF) * f);
    uint8_t b = (uint8_t)((color & 0xFF) * f);
    leds.setPixelColor(first + i, leds.Color(r, g, b));
  }
}

void updateLeds(unsigned long now) {
  if (now - lastLedUpdate < 50) return;   // 20 aggiornamenti al secondo bastano
  lastLedUpdate = now;

  bool lowBlink = battLow && (now / 500) % 2 == 0;
  if ((long)(gaugesUntil - now) > 0) {
    int bp = batteryPercent(battMv);
    uint32_t battColor = bp > 50 ? leds.Color(0, 255, 0)
                       : bp > 25 ? leds.Color(255, 160, 0)
                                 : leds.Color(255, 0, 0);
    drawBar(0, bp, battColor);
    drawBar(4, fluidPercent(), leds.Color(0, 180, 255));
    leds.show();
    ledsLit = true;
  } else if (lowBlink) {
    // batteria scarica: il primo LED lampeggia rosso anche a barre spente
    leds.clear();
    leds.setPixelColor(0, leds.Color(255, 0, 0));
    leds.show();
    ledsLit = true;
  } else if (ledsLit) {
    leds.clear();
    leds.show();
    ledsLit = false;
  }
}

// ---------- Memoria del livello ----------
// (prima degli ingressi: ogni funzione e' definita prima di essere usata, cosi' il file
// compila anche con un compilatore C++ normale, come quello del simulatore Virtual Arduino)

void saveLevel() {
  prefs.putFloat("used", openTotalMs);
  savedOpenTotalMs = openTotalMs;
}

// Scrive in flash solo a valvola ferma da qualche secondo, per non consumarla.
void maybeSaveLevel(unsigned long now) {
  if (openTotalMs != savedOpenTotalMs && valveOpen == 0 && now - lastShot >= SAVE_DELAY_MS)
    saveLevel();
}

// ---------- Ingressi ----------

void readTrigger() {
  fsr = 0.6f * fsr + 0.4f * analogRead(PIN_FSR);
  if (!pressed && fsr > FSR_ON) pressed = true;
  else if (pressed && fsr < FSR_OFF) pressed = false;
}

float force() {   // 0..1 tra soglia e pressione piena
  return constrain((fsr - FSR_ON) / (float)(FSR_FULL - FSR_ON), 0.0f, 1.0f);
}

void updateButton(unsigned long now) {
  bool down = digitalRead(PIN_BUTTON) == LOW;
  if (down && !buttonDown) {
    buttonDown = true;
    longPressDone = false;
    buttonSince = now;
  } else if (down && !longPressDone && now - buttonSince >= 1500) {
    longPressDone = true;
    openTotalMs = 0;          // cartuccia nuova
    saveLevel();
    buzz(1, 600);
    showGauges(now, GAUGE_SHOW_MS);
  } else if (!down && buttonDown) {
    buttonDown = false;
    if (!longPressDone && now - buttonSince >= 30) {   // antirimbalzo
      mode = (Mode)((mode + 1) % NUM_MODES);
      setValve(0);
      burstIsOpen = false;
      singleActive = false;
      buzz(mode + 1, 120);
      showGauges(now, GAUGE_SHOW_MS);
    }
  }
}

int readBatteryMv() {
  return analogReadMilliVolts(PIN_BATT) * 2;   // partitore 1:2
}

void checkBattery(unsigned long now) {
  if (now - lastBattCheck < BATT_CHECK_MS) return;
  if (valveOpen > 0) return;   // sotto carico la tensione scende: misura a valvola chiusa
  lastBattCheck = now;
  int mv = readBatteryMv();
  if (mv < 1000) return;       // partitore non montato
  battMv = mv;
  battLow = mv < BATT_LOW_MV;
  if (battLow) buzz(3, 400);
}

// ---------- Modalita' ----------

float compensation() {
  return 1.0f + COMP_GAIN * usedFraction();
}

void runContinuous() {
  if (pressed) setValve(min(1.0f, (CONT_MIN_OPEN + (1 - CONT_MIN_OPEN) * force()) * compensation()));
  else setValve(0);
}

void runBurst(unsigned long now, bool justPressed) {
  if (!pressed) {
    if (burstIsOpen) setValve(0);
    burstIsOpen = false;
    return;
  }
  unsigned long openMs = BURST_OPEN_MS * compensation() + SERVO_TRAVEL_MS;
  unsigned long gapMs = BURST_GAP_SLOW - (BURST_GAP_SLOW - BURST_GAP_FAST) * force();
  if (justPressed || (!burstIsOpen && now - burstPhaseStart >= gapMs)) {
    setValve(1);
    burstIsOpen = true;
    burstPhaseStart = now;
  } else if (burstIsOpen && now - burstPhaseStart >= openMs) {
    setValve(0);
    burstIsOpen = false;
    burstPhaseStart = now;
  }
}

void runSingle(unsigned long now, bool justPressed) {
  if (justPressed && !singleActive) {
    setValve(1);
    singleActive = true;
    singleEnd = now + SINGLE_OPEN_MS * compensation() + SERVO_TRAVEL_MS;
  } else if (singleActive && (long)(now - singleEnd) >= 0) {
    setValve(0);
    singleActive = false;   // il prossimo colpo richiede di rilasciare e ripremere
  }
}

// Il servo segue la forza sul sensore tra CAL_MIN_US e CAL_MAX_US:
// leggi sul monitor seriale i valori di "valvola chiusa" e "tutta aperta".
void runCalibration(unsigned long now) {
  float f = constrain(fsr / 4095.0f, 0.0f, 1.0f);
  int us = CAL_MIN_US + (int)((CAL_MAX_US - CAL_MIN_US) * f);
  valve.writeMicroseconds(us);
  if (now - lastDebug >= 200) {
    lastDebug = now;
    Serial.printf("TARATURA  fsr=%4d  servo=%d us\n", (int)fsr, us);
  }
}

// ---------- Setup e ciclo ----------

void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_VIBRO, OUTPUT);
  digitalWrite(PIN_VIBRO, LOW);
  analogReadResolution(12);

  ESP32PWM::allocateTimer(0);
  valve.setPeriodHertz(50);
  valve.attach(PIN_SERVO, 500, 2400);
  setValve(0);

  leds.begin();
  leds.setBrightness(LED_BRIGHTNESS);
  leds.clear();
  leds.show();

  prefs.begin("lanciaragn", false);
  openTotalMs = savedOpenTotalMs = prefs.getFloat("used", 0);

  delay(50);
  int mv = readBatteryMv();
  if (mv >= 1000) battMv = mv;
  battLow = battMv > 0 && battMv < BATT_LOW_MV;

  calibration = digitalRead(PIN_BUTTON) == LOW;
  if (calibration) {
    Serial.println("Modalita' taratura: togli la leva dal perno prima di provare.");
    buzz(5, 80);
  } else {
    buzz(mode + 1, 120);
    showGauges(millis(), GAUGE_SHOW_MS);
  }
}

void loop() {
  unsigned long now = millis();
  updateBuzz(now);
  if (now - lastTick < 2) return;   // ciclo a ~500 Hz
  unsigned long dt = now - lastTick;
  lastTick = now;

  bool wasPressed = pressed;
  readTrigger();
  bool justPressed = pressed && !wasPressed;

  if (calibration) {
    runCalibration(now);
    return;
  }

  updateButton(now);
  checkBattery(now);

  switch (mode) {
    case CONTINUO: runContinuous(); break;
    case RAFFICA:  runBurst(now, justPressed); break;
    case SINGOLO:  runSingle(now, justPressed); break;
    default: break;
  }
  openTotalMs += dt * valveOpen;
  if (valveOpen > 0 || pressed) {
    lastShot = now;
    showGauges(now, GAUGE_AFTER_SHOT_MS);   // mentre spari vedi il fluido scendere
  }
  maybeSaveLevel(now);
  updateLeds(now);

  if (DEBUG && now - lastDebug >= 200) {
    lastDebug = now;
    Serial.printf("%-8s fsr=%4d apertura=%.2f fluido=%3d%% batteria=%4d mV (%d%%)\n",
                  MODE_NAMES[mode], (int)fsr, valveOpen, fluidPercent(), battMv,
                  batteryPercent(battMv));
  }
}
