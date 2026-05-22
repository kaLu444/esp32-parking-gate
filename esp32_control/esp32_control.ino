#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <math.h>

#include "secrets.h"

// ------------------------------------------------------------
// PODESAVANJA KOJA SE MENJAJU ZA TVOJ PROJEKAT
// ------------------------------------------------------------
const char* DEVICE_ID = "esp32_1";

// ------------------------------------------------------------
// GPIO mapa. Ako dodajes novi senzor, izlaz ili dugme, kreni odavde.
// ------------------------------------------------------------
namespace Pins {
  // Prva rampa - ulaz
  const uint8_t TRIG = 5;
  const uint8_t ECHO = 4;
  const uint8_t SERVO_ENTRY = 18;
  const uint8_t BUZZER_ENTRY = 23;
  const uint8_t DOZVOLI = 14;
  const uint8_t ZABRANI = 27;
  const uint8_t RGB_RED_ENTRY = 22;
  const uint8_t RGB_GREEN_ENTRY = 21;
  const uint8_t RGB_BLUE_ENTRY = 26;

  // Druga rampa - izlaz
  const uint8_t SHARP = 34;
  const uint8_t SERVO_EXIT = 19;
  const uint8_t BUZZER_EXIT = 25;
  const uint8_t RED_LED_EXIT = 32;
  const uint8_t GREEN_LED_EXIT = 33;
}

namespace ServoAngle {
  const int CLOSED = 0;
  const int OPEN = 90;
}

struct RuntimeConfig {
  int detectionDistanceCm = 20;      // HC-SR04 prag za ulaznu rampu
  int exitDetectDistanceCm = 30;     // Izlaz konstatuje auto samo do 30 cm
  int exitOpenDistanceCm = 20;       // Izlaz se automatski otvara tek na 20 cm
  unsigned long gateOpenMs = 4000;   // Vreme privremenog otvaranja za obe rampe
  unsigned long entryGateOpenMs = 4000;
  unsigned long exitGateOpenMs = 4000;
  bool buzzerEnabled = true;         // Pasivni buzzer na ulazu
  bool gate2BuzzerEnabled = true;    // Aktivni buzzer na izlazu
  bool entryAutoEnabled = false;     // Ulaz se automatski otvara samo ako se ukljuci na webu
  bool exitAutoEnabled = true;       // Izlaz je automatski po defaultu
  String entryRgbIdleColor = "blue";
  String entryRgbWaitingColor = "yellow";
  String entryRgbOpenColor = "green";
  String entryRgbDeniedColor = "red";
  String mode = "auto";
};

struct ButtonMapping {
  uint8_t pin;
  const char* label;
  const char* commandName;
  const char* value;
  bool stablePressed;
  bool lastReadingPressed;
  unsigned long lastChangeMs;
};

RuntimeConfig config;
Servo entryServo;
Servo exitServo;
Preferences preferences;
WiFiClientSecure secureClient;

ButtonMapping buttons[] = {
  {Pins::DOZVOLI, "DOZVOLI", "gate.access", "allow", false, false, 0},
  {Pins::ZABRANI, "ZABRANI", "gate.access", "deny", false, false, 0}
};

const unsigned long SENSOR_INTERVAL_MS = 250;
const unsigned long COMMAND_POLL_INTERVAL_MS = 1000;
const unsigned long STATE_PUBLISH_INTERVAL_MS = 2000;
const unsigned long CONFIG_POLL_INTERVAL_MS = 10000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const unsigned long BUTTON_DEBOUNCE_MS = 45;
const unsigned long EXIT_BUZZER_BEEP_MS = 180;
const unsigned long ENTRY_DENIED_SIGNAL_MS = 2000;
const unsigned long ENTRY_RGB_BLINK_MS = 400;
const bool RGB_COMMON_ANODE = false; // Ako RGB LED svetli obrnuto, promeni na true.

float entryDistanceCm = -1;
float exitDistanceCm = -1;
bool entryCarPresent = false;
bool exitCarPresent = false;
bool entryAutoZonePreviouslyActive = false;
bool exitOpenZonePreviouslyActive = false;
bool entryGateOpen = false;
bool exitGateOpen = false;
bool entryDeniedSignal = false;
bool entryRgbBlinkState = false;

unsigned long entryGateOpenUntilMs = 0;
unsigned long exitGateOpenUntilMs = 0;
unsigned long entryDeniedUntilMs = 0;
unsigned long lastEntryRgbBlinkMs = 0;
unsigned long lastSensorReadMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastStatePublishMs = 0;
unsigned long lastConfigPollMs = 0;
unsigned long lastWifiRetryMs = 0;
unsigned long exitBuzzerUntilMs = 0;

String lastRemoteCommandId = "";
uint64_t lastRemoteCommandTimestamp = 0;

String lastActionName = "boot";
String lastActionValue = "";
String lastActionSource = "device";
String lastActionResult = "started";

void connectWiFi();
void ensureWiFi();
void setupPins();
void setupServos();
void updateSensors();
void updateButtons();
void updateAutoOpenGates();
void updateGatesAutoClose();
void updateParkingBuzzer();
void updateEntryRgb();
void updateExitBuzzer();
String normalizeRgbColor(String color, const char* fallback);
String getEntryRgbStateColor();
void pollRemoteCommand();
void fetchRemoteConfig();
void publishState(const String& reason);
bool handleCommand(const String& commandName, const String& value);
bool handleCommand(const String& commandName, const String& value, const String& source);
float measureEntryDistanceCm();
float measureExitSharpDistanceCm();

void setup() {
  Serial.begin(115200);
  setupPins();
  setupServos();

  preferences.begin("parking", false);
  lastRemoteCommandId = preferences.getString("lastCmdId", "");
  lastRemoteCommandTimestamp = preferences.getULong64("lastCmdTs", 0);

  secureClient.setInsecure(); // Za skolski prototip. Za produkciju koristi validan CA sertifikat.

  Serial.println("Pametni parking sistem pokrenut.");
  Serial.println("Rampa 1: HC-SR04 + servo + pasivni buzzer + dugmad.");
  Serial.println("Rampa 2: Sharp senzor + servo + aktivni buzzer + crvena/zelena LED.");
  Serial.println("--------------------------------");

  connectWiFi();
  fetchRemoteConfig();
  publishState("boot");
}

void loop() {
  ensureWiFi();

  const unsigned long now = millis();

  if (now - lastSensorReadMs >= SENSOR_INTERVAL_MS) {
    lastSensorReadMs = now;
    updateSensors();
  }

  updateButtons();
  updateAutoOpenGates();
  updateGatesAutoClose();
  updateParkingBuzzer();
  updateEntryRgb();
  updateExitBuzzer();

  if (now - lastCommandPollMs >= COMMAND_POLL_INTERVAL_MS) {
    lastCommandPollMs = now;
    pollRemoteCommand();
  }

  if (now - lastConfigPollMs >= CONFIG_POLL_INTERVAL_MS) {
    lastConfigPollMs = now;
    fetchRemoteConfig();
  }

  if (now - lastStatePublishMs >= STATE_PUBLISH_INTERVAL_MS) {
    lastStatePublishMs = now;
    publishState("periodic");
  }
}

void setupPins() {
  pinMode(Pins::TRIG, OUTPUT);
  pinMode(Pins::ECHO, INPUT);
  pinMode(Pins::BUZZER_ENTRY, OUTPUT);
  pinMode(Pins::BUZZER_EXIT, OUTPUT);
  pinMode(Pins::RGB_RED_ENTRY, OUTPUT);
  pinMode(Pins::RGB_GREEN_ENTRY, OUTPUT);
  pinMode(Pins::RGB_BLUE_ENTRY, OUTPUT);
  pinMode(Pins::RED_LED_EXIT, OUTPUT);
  pinMode(Pins::GREEN_LED_EXIT, OUTPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(Pins::SHARP, ADC_11db);

  for (ButtonMapping& button : buttons) {
    pinMode(button.pin, INPUT_PULLUP);
  }

  digitalWrite(Pins::BUZZER_EXIT, LOW);
  digitalWrite(Pins::RED_LED_EXIT, HIGH);
  digitalWrite(Pins::GREEN_LED_EXIT, LOW);
}

void setupServos() {
  entryServo.attach(Pins::SERVO_ENTRY, 500, 2400);
  exitServo.attach(Pins::SERVO_EXIT, 500, 2400);
  entryServo.write(ServoAngle::CLOSED);
  exitServo.write(ServoAngle::CLOSED);
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("Povezivanje na WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
    delay(250);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi povezan, IP adresa: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi nije povezan. Pokusavam ponovo kasnije.");
  }
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiRetryMs = now;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

String firebaseBaseUrl() {
  String baseUrl = String(DATABASE_URL);
  baseUrl.trim();

  if (baseUrl.endsWith("/")) {
    baseUrl.remove(baseUrl.length() - 1);
  }

  return baseUrl;
}

bool firebaseReady() {
  const String baseUrl = firebaseBaseUrl();
  return baseUrl.startsWith("https://") && baseUrl.indexOf("UNESI_") == -1;
}

String firebaseUrl(const String& path, const String& query = "") {
  return firebaseBaseUrl() + "/" + path + ".json" + query;
}

bool firebaseGet(const String& path, const String& query, String& payload) {
  if (!firebaseReady() || WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(5000);
  http.begin(secureClient, firebaseUrl(path, query));

  const int statusCode = http.GET();
  payload = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.print("Firebase GET greska: ");
    Serial.print(statusCode);
    Serial.print(" -> ");
    Serial.println(payload);
    return false;
  }

  return true;
}

bool firebasePatch(const String& path, const String& payload) {
  if (!firebaseReady() || WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient http;
  http.setTimeout(5000);
  http.begin(secureClient, firebaseUrl(path));
  http.addHeader("Content-Type", "application/json");

  const int statusCode = http.PATCH(payload);
  const String response = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.print("Firebase PATCH greska: ");
    Serial.print(statusCode);
    Serial.print(" -> ");
    Serial.println(response);
    return false;
  }

  return true;
}

String devicePath(const String& childPath) {
  return "devices/" + String(DEVICE_ID) + "/" + childPath;
}

String jsonValueToString(JsonVariantConst value) {
  if (value.is<const char*>()) {
    return String(value.as<const char*>());
  }

  if (value.is<bool>()) {
    return value.as<bool>() ? "true" : "false";
  }

  if (value.is<int>()) {
    return String(value.as<int>());
  }

  if (value.is<long>()) {
    return String(value.as<long>());
  }

  if (value.is<float>()) {
    return String(value.as<float>());
  }

  String serialized;
  serializeJson(value, serialized);
  return serialized;
}

uint64_t jsonTimestampToUint64(JsonVariantConst value) {
  if (value.is<unsigned long long>()) {
    return value.as<unsigned long long>();
  }

  if (value.is<double>()) {
    return (uint64_t)value.as<double>();
  }

  if (value.is<const char*>()) {
    return strtoull(value.as<const char*>(), nullptr, 10);
  }

  return 0;
}

void rememberRemoteCommand(const String& commandId, uint64_t timestamp) {
  lastRemoteCommandId = commandId;
  lastRemoteCommandTimestamp = timestamp;

  preferences.putString("lastCmdId", lastRemoteCommandId);
  preferences.putULong64("lastCmdTs", lastRemoteCommandTimestamp);
}

void pollRemoteCommand() {
  String payload;
  const String query = "?orderBy=%22timestamp%22&limitToLast=1";

  if (!firebaseGet(devicePath("commands"), query, payload)) {
    return;
  }

  if (payload == "null" || payload.length() == 0) {
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("Ne mogu da procitam komandu: ");
    Serial.println(error.c_str());
    return;
  }

  JsonObject root = doc.as<JsonObject>();
  for (JsonPair pair : root) {
    const String commandId = pair.key().c_str();
    JsonObject command = pair.value().as<JsonObject>();

    const String commandName = command["name"] | "";
    const uint64_t timestamp = jsonTimestampToUint64(command["timestamp"]);
    const String value = jsonValueToString(command["value"]);
    const String source = command["source"] | "web";

    if (commandName.length() == 0 || timestamp == 0) {
      return;
    }

    if (timestamp < lastRemoteCommandTimestamp) {
      return;
    }

    if (timestamp == lastRemoteCommandTimestamp && commandId == lastRemoteCommandId) {
      return;
    }

    Serial.print("Nova Firebase komanda: ");
    Serial.print(commandName);
    Serial.print(" = ");
    Serial.println(value);

    const bool handled = handleCommand(commandName, value, source);
    rememberRemoteCommand(commandId, timestamp);

    if (!handled) {
      lastActionResult = "unknown_command";
      Serial.println("Komanda nije prepoznata, ali je oznacena kao obradjena.");
    }

    publishState("remoteCommand");
  }
}

void fetchRemoteConfig() {
  String payload;
  if (!firebaseGet(devicePath("config"), "", payload)) {
    return;
  }

  if (payload == "null" || payload.length() == 0) {
    DynamicJsonDocument defaults(1536);
    defaults["detectionDistanceCm"] = config.detectionDistanceCm;
    defaults["entryDetectionDistanceCm"] = config.detectionDistanceCm;
    defaults["exitDetectDistanceCm"] = config.exitDetectDistanceCm;
    defaults["exitOpenDistanceCm"] = config.exitOpenDistanceCm;
    defaults["gateOpenMs"] = config.gateOpenMs;
    defaults["entryGateOpenMs"] = config.entryGateOpenMs;
    defaults["exitGateOpenMs"] = config.exitGateOpenMs;
    defaults["buzzerEnabled"] = config.buzzerEnabled;
    defaults["gate2BuzzerEnabled"] = config.gate2BuzzerEnabled;
    defaults["entryAutoEnabled"] = config.entryAutoEnabled;
    defaults["exitAutoEnabled"] = config.exitAutoEnabled;
    defaults["entryRgbIdleColor"] = config.entryRgbIdleColor;
    defaults["entryRgbWaitingColor"] = config.entryRgbWaitingColor;
    defaults["entryRgbOpenColor"] = config.entryRgbOpenColor;
    defaults["entryRgbDeniedColor"] = config.entryRgbDeniedColor;
    defaults["mode"] = config.mode;
    defaults["updatedBy"] = "esp32";
    JsonObject updatedAt = defaults.createNestedObject("updatedAt");
    updatedAt[".sv"] = "timestamp";

    String defaultPayload;
    serializeJson(defaults, defaultPayload);
    firebasePatch(devicePath("config"), defaultPayload);
    return;
  }

  DynamicJsonDocument doc(3072);
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("Ne mogu da procitam config: ");
    Serial.println(error.c_str());
    return;
  }

  if (doc["detectionDistanceCm"].is<int>()) {
    config.detectionDistanceCm = constrain(doc["detectionDistanceCm"].as<int>(), 5, 200);
  }

  if (doc["entryDetectionDistanceCm"].is<int>()) {
    config.detectionDistanceCm = constrain(doc["entryDetectionDistanceCm"].as<int>(), 5, 200);
  }

  if (doc["exitDetectDistanceCm"].is<int>()) {
    config.exitDetectDistanceCm = constrain(doc["exitDetectDistanceCm"].as<int>(), 5, 150);
  }

  if (doc["exitOpenDistanceCm"].is<int>()) {
    const int requestedOpenDistanceCm = doc["exitOpenDistanceCm"].as<int>();
    config.exitOpenDistanceCm = constrain(requestedOpenDistanceCm, 5, config.exitDetectDistanceCm);
  }

  if (doc["gateOpenMs"].is<unsigned long>()) {
    config.gateOpenMs = constrain(doc["gateOpenMs"].as<unsigned long>(), 1000UL, 30000UL);
    config.entryGateOpenMs = config.gateOpenMs;
    config.exitGateOpenMs = config.gateOpenMs;
  }

  if (doc["entryGateOpenMs"].is<unsigned long>()) {
    config.entryGateOpenMs = constrain(doc["entryGateOpenMs"].as<unsigned long>(), 1000UL, 30000UL);
  }

  if (doc["exitGateOpenMs"].is<unsigned long>()) {
    config.exitGateOpenMs = constrain(doc["exitGateOpenMs"].as<unsigned long>(), 1000UL, 30000UL);
  }

  if (doc["buzzerEnabled"].is<bool>()) {
    config.buzzerEnabled = doc["buzzerEnabled"].as<bool>();
  }

  if (doc["gate2BuzzerEnabled"].is<bool>()) {
    config.gate2BuzzerEnabled = doc["gate2BuzzerEnabled"].as<bool>();
  }

  if (doc["entryAutoEnabled"].is<bool>()) {
    config.entryAutoEnabled = doc["entryAutoEnabled"].as<bool>();
  }

  if (doc["exitAutoEnabled"].is<bool>()) {
    config.exitAutoEnabled = doc["exitAutoEnabled"].as<bool>();
  }

  if (doc["entryRgbIdleColor"].is<const char*>()) {
    config.entryRgbIdleColor = normalizeRgbColor(doc["entryRgbIdleColor"].as<String>(), "blue");
  }

  if (doc["entryRgbWaitingColor"].is<const char*>()) {
    config.entryRgbWaitingColor = normalizeRgbColor(doc["entryRgbWaitingColor"].as<String>(), "yellow");
  }

  if (doc["entryRgbOpenColor"].is<const char*>()) {
    config.entryRgbOpenColor = normalizeRgbColor(doc["entryRgbOpenColor"].as<String>(), "green");
  }

  if (doc["entryRgbDeniedColor"].is<const char*>()) {
    config.entryRgbDeniedColor = normalizeRgbColor(doc["entryRgbDeniedColor"].as<String>(), "red");
  }

  if (doc["mode"].is<const char*>()) {
    String remoteMode = doc["mode"].as<const char*>();
    remoteMode.toLowerCase();
    if (remoteMode == "auto" || remoteMode == "manual") {
      config.mode = remoteMode;
    }
  }
}

void publishState(const String& reason) {
  DynamicJsonDocument doc(4096);
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = WiFi.status() == WL_CONNECTED;
  doc["reason"] = reason;
  doc["uptimeMs"] = millis();
  doc["mode"] = config.mode;

  // Stara polja ostaju zbog kompatibilnosti sa postojecim web kodom za ulaz.
  doc["distanceCm"] = entryDistanceCm;
  doc["carPresent"] = entryCarPresent;
  doc["gate"] = entryGateOpen ? "open" : "closed";
  doc["buzzerEnabled"] = config.buzzerEnabled;

  // Ravna polja za izlaz, ako zatrebaju kasnije.
  doc["exitDistanceCm"] = exitDistanceCm;
  doc["exitCarPresent"] = exitCarPresent;
  doc["exitGate"] = exitGateOpen ? "open" : "closed";
  doc["gate2BuzzerEnabled"] = config.gate2BuzzerEnabled;

  doc["lastRemoteCommandId"] = lastRemoteCommandId;
  doc["lastRemoteCommandTimestamp"] = lastRemoteCommandTimestamp;

  JsonObject gates = doc.createNestedObject("gates");

  JsonObject entry = gates.createNestedObject("entry");
  entry["label"] = "Ulaz 01";
  entry["distanceCm"] = entryDistanceCm;
  entry["carPresent"] = entryCarPresent;
  entry["gate"] = entryGateOpen ? "open" : "closed";
  entry["buzzerEnabled"] = config.buzzerEnabled;
  entry["autoEnabled"] = config.entryAutoEnabled;
  entry["sensor"] = "HC-SR04";
  entry["detectDistanceCm"] = config.detectionDistanceCm;
  entry["openMs"] = config.entryGateOpenMs;
  entry["rgb"] = getEntryRgbStateColor();
  JsonObject entryRgb = entry.createNestedObject("rgbColors");
  entryRgb["idle"] = config.entryRgbIdleColor;
  entryRgb["waiting"] = config.entryRgbWaitingColor;
  entryRgb["open"] = config.entryRgbOpenColor;
  entryRgb["denied"] = config.entryRgbDeniedColor;

  JsonObject exit = gates.createNestedObject("exit");
  exit["label"] = "Izlaz 01";
  exit["distanceCm"] = exitDistanceCm;
  exit["carPresent"] = exitCarPresent;
  exit["gate"] = exitGateOpen ? "open" : "closed";
  exit["buzzerEnabled"] = config.gate2BuzzerEnabled;
  exit["autoEnabled"] = config.exitAutoEnabled;
  exit["sensor"] = "Sharp GP2Y0A02YK0F";
  exit["detectDistanceCm"] = config.exitDetectDistanceCm;
  exit["openDistanceCm"] = config.exitOpenDistanceCm;
  exit["openMs"] = config.exitGateOpenMs;
  exit["redLed"] = !exitGateOpen;
  exit["greenLed"] = exitGateOpen;

  JsonObject lastCommand = doc.createNestedObject("lastProcessedCommand");
  lastCommand["name"] = lastActionName;
  lastCommand["value"] = lastActionValue;
  lastCommand["source"] = lastActionSource;
  lastCommand["result"] = lastActionResult;

  JsonObject updatedAt = doc.createNestedObject("updatedAt");
  updatedAt[".sv"] = "timestamp";

  String payload;
  serializeJson(doc, payload);
  firebasePatch(devicePath("state"), payload);
}

void updateSensors() {
  entryDistanceCm = measureEntryDistanceCm();
  const float measuredExitDistanceCm = measureExitSharpDistanceCm();

  entryCarPresent = entryDistanceCm > 0 && entryDistanceCm <= config.detectionDistanceCm;
  exitDistanceCm = measuredExitDistanceCm > 0 && measuredExitDistanceCm <= config.exitDetectDistanceCm
    ? measuredExitDistanceCm
    : -1;
  exitCarPresent = exitDistanceCm > 0;

  static unsigned long lastPrintMs = 0;
  const unsigned long now = millis();
  if (now - lastPrintMs < 1000) {
    return;
  }

  lastPrintMs = now;
  Serial.println("--------------------------------");
  Serial.print("Ulaz 01 udaljenost: ");
  if (entryDistanceCm < 0) {
    Serial.println("nema ocitavanja");
  } else {
    Serial.print(entryDistanceCm);
    Serial.println(" cm");
  }

  Serial.print("Izlaz 01 udaljenost: ");
  if (exitDistanceCm < 0) {
    Serial.println("van opsega");
  } else {
    Serial.print(exitDistanceCm);
    Serial.println(" cm");
  }

  Serial.print("Ulaz auto: ");
  Serial.println(entryCarPresent ? "detektovan" : "nema auta");
  Serial.print("Izlaz auto: ");
  Serial.println(exitCarPresent ? "detektovan" : "nema auta");
  Serial.println("--------------------------------");
}

void updateButtons() {
  const unsigned long now = millis();

  for (ButtonMapping& button : buttons) {
    const bool readingPressed = digitalRead(button.pin) == LOW;

    if (readingPressed != button.lastReadingPressed) {
      button.lastReadingPressed = readingPressed;
      button.lastChangeMs = now;
    }

    if (now - button.lastChangeMs < BUTTON_DEBOUNCE_MS) {
      continue;
    }

    if (readingPressed != button.stablePressed) {
      button.stablePressed = readingPressed;

      if (button.stablePressed) {
        Serial.print("Fizicko dugme: ");
        Serial.println(button.label);
        handleCommand(button.commandName, button.value, "physical");
        publishState("physicalButton");
      }
    }
  }
}

void setExitIndicators() {
  digitalWrite(Pins::RED_LED_EXIT, exitGateOpen ? LOW : HIGH);
  digitalWrite(Pins::GREEN_LED_EXIT, exitGateOpen ? HIGH : LOW);
}

void triggerExitBuzzerBeep() {
  if (!config.gate2BuzzerEnabled) {
    digitalWrite(Pins::BUZZER_EXIT, LOW);
    return;
  }

  digitalWrite(Pins::BUZZER_EXIT, HIGH);
  exitBuzzerUntilMs = millis() + EXIT_BUZZER_BEEP_MS;
}

void updateExitBuzzer() {
  if (exitBuzzerUntilMs == 0) {
    return;
  }

  if ((long)(millis() - exitBuzzerUntilMs) >= 0) {
    digitalWrite(Pins::BUZZER_EXIT, LOW);
    exitBuzzerUntilMs = 0;
  }
}

void openEntryGateTemporary() {
  entryServo.write(ServoAngle::OPEN);
  entryGateOpen = true;
  entryDeniedSignal = false;
  entryGateOpenUntilMs = millis() + config.entryGateOpenMs;
  noTone(Pins::BUZZER_ENTRY);
}

void openEntryGateManual() {
  entryServo.write(ServoAngle::OPEN);
  entryGateOpen = true;
  entryDeniedSignal = false;
  entryGateOpenUntilMs = 0; // Rucno otvorena rampa ostaje otvorena dok ne stigne komanda za zatvaranje.
  noTone(Pins::BUZZER_ENTRY);
}

void closeEntryGate() {
  entryServo.write(ServoAngle::CLOSED);
  entryGateOpen = false;
  entryGateOpenUntilMs = 0;
  noTone(Pins::BUZZER_ENTRY);
}

void openExitGateTemporary() {
  exitServo.write(ServoAngle::OPEN);
  exitGateOpen = true;
  exitGateOpenUntilMs = millis() + config.exitGateOpenMs;
  setExitIndicators();
  triggerExitBuzzerBeep();
}

void openExitGateManual() {
  exitServo.write(ServoAngle::OPEN);
  exitGateOpen = true;
  exitGateOpenUntilMs = 0; // Rucno otvorena rampa ostaje otvorena dok ne stigne komanda za zatvaranje.
  setExitIndicators();
  triggerExitBuzzerBeep();
}

void closeExitGate() {
  exitServo.write(ServoAngle::CLOSED);
  exitGateOpen = false;
  exitGateOpenUntilMs = 0;
  setExitIndicators();
  triggerExitBuzzerBeep();
}

void updateAutoOpenGates() {
  const bool entryAutoZoneActive = entryCarPresent;
  const bool exitOpenZoneActive = exitDistanceCm > 0 && exitDistanceCm <= config.exitOpenDistanceCm;

  if (config.entryAutoEnabled && entryAutoZoneActive && !entryAutoZonePreviouslyActive && !entryGateOpen) {
    Serial.println("Auto detektovan na ulazu. Rampa 1 se automatski otvara.");
    lastActionName = "gate.access";
    lastActionValue = "allow";
    lastActionSource = "ultrasonic";
    lastActionResult = "ok";
    openEntryGateTemporary();
    publishState("entrySensor");
  }

  if (config.exitAutoEnabled && exitOpenZoneActive && !exitOpenZonePreviouslyActive && !exitGateOpen) {
    Serial.println("Auto je na 20 cm od izlaza. Rampa 2 se automatski otvara.");
    lastActionName = "gate2.access";
    lastActionValue = "allow";
    lastActionSource = "sharp";
    lastActionResult = "ok";
    openExitGateTemporary();
    publishState("exitSensor");
  }

  entryAutoZonePreviouslyActive = entryAutoZoneActive;
  exitOpenZonePreviouslyActive = exitOpenZoneActive;
}

void updateGatesAutoClose() {
  if (entryGateOpen && entryGateOpenUntilMs != 0 && (long)(millis() - entryGateOpenUntilMs) >= 0) {
    closeEntryGate();
    lastActionName = "gate.position";
    lastActionValue = "close";
    lastActionSource = "device";
    lastActionResult = "auto_close";
    publishState("entryAutoClose");
  }

  if (exitGateOpen && exitGateOpenUntilMs != 0 && (long)(millis() - exitGateOpenUntilMs) >= 0) {
    closeExitGate();
    lastActionName = "gate2.position";
    lastActionValue = "close";
    lastActionSource = "device";
    lastActionResult = "auto_close";
    publishState("exitAutoClose");
  }
}

void updateParkingBuzzer() {
  static bool beepActive = false;
  static unsigned long beepStartedMs = 0;
  static unsigned long nextBeepMs = 0;
  static uint8_t lastBuzzerZone = 0;

  // Buzzer ulaza radi kao parking senzor u autu:
  // 10-7 cm: t  t  t, 7-4 cm: t t t, 4-2 cm: brze, ispod 2 cm: skoro ttt.
  if (!config.buzzerEnabled || entryGateOpen || !entryCarPresent || entryDistanceCm <= 0 || entryDistanceCm > 10) {
    noTone(Pins::BUZZER_ENTRY);
    beepActive = false;
    beepStartedMs = 0;
    nextBeepMs = 0;
    lastBuzzerZone = 0;
    return;
  }

  uint8_t zone;
  unsigned long beepMs;
  unsigned long pauseMs;

  if (entryDistanceCm > 7) {
    zone = 1;
    beepMs = 70;
    pauseMs = 650;
  } else if (entryDistanceCm > 4) {
    zone = 2;
    beepMs = 60;
    pauseMs = 300;
  } else if (entryDistanceCm > 2) {
    zone = 3;
    beepMs = 50;
    pauseMs = 130;
  } else {
    zone = 4;
    beepMs = 40;
    pauseMs = 45;
  }

  const unsigned long now = millis();

  if (zone != lastBuzzerZone) {
    lastBuzzerZone = zone;
    nextBeepMs = now; // Kada auto predje u blizu zonu, ritam se promeni odmah.
  }

  if (beepActive) {
    if (now - beepStartedMs >= beepMs) {
      noTone(Pins::BUZZER_ENTRY);
      beepActive = false;
      nextBeepMs = now + pauseMs;
    }
    return;
  }

  if (now >= nextBeepMs) {
    tone(Pins::BUZZER_ENTRY, 1500);
    beepActive = true;
    beepStartedMs = now;
  }
}

String normalizeRgbColor(String color, const char* fallback) {
  color.trim();
  color.toLowerCase();

  if (
    color == "red" ||
    color == "green" ||
    color == "blue" ||
    color == "yellow" ||
    color == "white" ||
    color == "off"
  ) {
    return color;
  }

  return String(fallback);
}

String getEntryRgbStateColor() {
  if (entryGateOpen) {
    return config.entryRgbOpenColor;
  }

  if (entryDeniedSignal) {
    return config.entryRgbDeniedColor;
  }

  if (!entryCarPresent) {
    return config.entryRgbIdleColor;
  }

  return config.entryRgbWaitingColor;
}

void setEntryRgb(bool red, bool green, bool blue) {
  if (RGB_COMMON_ANODE) {
    digitalWrite(Pins::RGB_RED_ENTRY, red ? LOW : HIGH);
    digitalWrite(Pins::RGB_GREEN_ENTRY, green ? LOW : HIGH);
    digitalWrite(Pins::RGB_BLUE_ENTRY, blue ? LOW : HIGH);
    return;
  }

  digitalWrite(Pins::RGB_RED_ENTRY, red ? HIGH : LOW);
  digitalWrite(Pins::RGB_GREEN_ENTRY, green ? HIGH : LOW);
  digitalWrite(Pins::RGB_BLUE_ENTRY, blue ? HIGH : LOW);
}

void setEntryRgbColor(const String& color) {
  if (color == "red") {
    setEntryRgb(true, false, false);
  } else if (color == "green") {
    setEntryRgb(false, true, false);
  } else if (color == "blue") {
    setEntryRgb(false, false, true);
  } else if (color == "yellow") {
    setEntryRgb(true, true, false);
  } else if (color == "white") {
    setEntryRgb(true, true, true);
  } else {
    setEntryRgb(false, false, false);
  }
}

void updateEntryRgb() {
  const unsigned long now = millis();

  if (entryDeniedSignal && (long)(now - entryDeniedUntilMs) >= 0) {
    entryDeniedSignal = false;
  }

  if (entryGateOpen) {
    setEntryRgbColor(config.entryRgbOpenColor);
    return;
  }

  if (entryDeniedSignal) {
    setEntryRgbColor(config.entryRgbDeniedColor);
    return;
  }

  if (!entryCarPresent) {
    setEntryRgbColor(config.entryRgbIdleColor);
    return;
  }

  // Auto je ispred ulaza i ceka odluku: zuto treperi.
  if (now - lastEntryRgbBlinkMs >= ENTRY_RGB_BLINK_MS) {
    lastEntryRgbBlinkMs = now;
    entryRgbBlinkState = !entryRgbBlinkState;
  }

  if (entryRgbBlinkState) {
    setEntryRgbColor(config.entryRgbWaitingColor);
  } else {
    setEntryRgb(false, false, false);
  }
}

bool handleCommand(const String& commandName, const String& value) {
  return handleCommand(commandName, value, "local");
}

bool handleCommand(const String& commandName, const String& value, const String& source) {
  String normalizedName = commandName;
  String normalizedValue = value;
  normalizedName.trim();
  normalizedValue.trim();
  normalizedName.toLowerCase();
  normalizedValue.toLowerCase();

  lastActionName = normalizedName;
  lastActionValue = normalizedValue;
  lastActionSource = source;
  lastActionResult = "ok";

  if (normalizedName == "gate.access") {
    if (normalizedValue == "allow") {
      Serial.println("DOZVOLJEN PROLAZ NA ULAZU. Rampa 1 se otvara privremeno.");
      openEntryGateTemporary();
      return true;
    }

    if (normalizedValue == "deny") {
      Serial.println("ZABRANJEN PROLAZ NA ULAZU. Rampa 1 ostaje spustena.");
      closeEntryGate();
      entryDeniedSignal = true;
      entryDeniedUntilMs = millis() + ENTRY_DENIED_SIGNAL_MS;
      return true;
    }
  }

  if (normalizedName == "gate.position") {
    if (normalizedValue == "open") {
      Serial.println("Rampa 1 rucno otvorena.");
      openEntryGateManual();
      return true;
    }

    if (normalizedValue == "close") {
      Serial.println("Rampa 1 zatvorena.");
      closeEntryGate();
      return true;
    }
  }

  if (normalizedName == "gate2.access") {
    if (normalizedValue == "allow") {
      Serial.println("DOZVOLJEN IZLAZ. Rampa 2 se otvara privremeno.");
      openExitGateTemporary();
      return true;
    }

    if (normalizedValue == "deny") {
      Serial.println("ZABRANJEN IZLAZ. Rampa 2 ostaje spustena.");
      closeExitGate();
      return true;
    }
  }

  if (normalizedName == "gate2.position") {
    if (normalizedValue == "open") {
      Serial.println("Rampa 2 rucno otvorena.");
      openExitGateManual();
      return true;
    }

    if (normalizedValue == "close") {
      Serial.println("Rampa 2 zatvorena.");
      closeExitGate();
      return true;
    }
  }

  if (normalizedName == "buzzer.enabled") {
    if (normalizedValue == "true" || normalizedValue == "1" || normalizedValue == "on") {
      config.buzzerEnabled = true;
      return true;
    }

    if (normalizedValue == "false" || normalizedValue == "0" || normalizedValue == "off") {
      config.buzzerEnabled = false;
      noTone(Pins::BUZZER_ENTRY);
      return true;
    }
  }

  if (normalizedName == "gate2.buzzer.enabled") {
    if (normalizedValue == "true" || normalizedValue == "1" || normalizedValue == "on") {
      config.gate2BuzzerEnabled = true;
      return true;
    }

    if (normalizedValue == "false" || normalizedValue == "0" || normalizedValue == "off") {
      config.gate2BuzzerEnabled = false;
      digitalWrite(Pins::BUZZER_EXIT, LOW);
      exitBuzzerUntilMs = 0;
      return true;
    }
  }

  if (normalizedName == "mode") {
    if (normalizedValue == "auto" || normalizedValue == "manual") {
      config.mode = normalizedValue;
      return true;
    }
  }

  if (normalizedName == "state.publish" && normalizedValue == "now") {
    return true;
  }

  lastActionResult = "unknown_command";
  return false;
}

float measureEntryDistanceCm() {
  digitalWrite(Pins::TRIG, LOW);
  delayMicroseconds(2);

  digitalWrite(Pins::TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(Pins::TRIG, LOW);

  const long duration = pulseIn(Pins::ECHO, HIGH, 30000);
  if (duration == 0) {
    return -1;
  }

  return duration * 0.0343 / 2;
}

float measureExitSharpDistanceCm() {
  long sum = 0;

  for (int i = 0; i < 10; i++) {
    sum += analogRead(Pins::SHARP);
    delay(2);
  }

  const float raw = sum / 10.0;
  const float voltage = raw * (3.3 / 4095.0);

  if (voltage <= 0.1) {
    return -1;
  }

  // Priblizna formula za Sharp GP2Y0A02YK0F. Senzor je najpouzdaniji od oko 20 do 150 cm.
  const float distance = 80.8 * pow(voltage, -1.40);
  if (distance < 10 || distance > 180) {
    return -1;
  }

  return distance;
}
