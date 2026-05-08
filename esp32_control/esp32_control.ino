#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include "secrets.h"

// ------------------------------------------------------------
// PODESAVANJA KOJA SE MENJAJU ZA TVOJ PROJEKAT
// ------------------------------------------------------------
const char* DEVICE_ID = "esp32_1";

// ------------------------------------------------------------
// GPIO mapa. Nove pinove dodaj ovde, pa ih povezi u funkcijama ispod.
// ------------------------------------------------------------
namespace Pins {
  const uint8_t TRIG = 5;
  const uint8_t ECHO = 4;
  const uint8_t SERVO = 18;
  const uint8_t BUZZER = 23;
  const uint8_t DOZVOLI = 14;
  const uint8_t ZABRANI = 27;
}

struct RuntimeConfig {
  int detectionDistanceCm = 20;
  unsigned long gateOpenMs = 4000;
  bool buzzerEnabled = true;
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
Servo gateServo;
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

float lastDistanceCm = -1;
bool carPresent = false;
bool gateOpen = false;

unsigned long gateOpenUntilMs = 0;
unsigned long lastSensorReadMs = 0;
unsigned long lastCommandPollMs = 0;
unsigned long lastStatePublishMs = 0;
unsigned long lastConfigPollMs = 0;
unsigned long lastWifiRetryMs = 0;

String lastRemoteCommandId = "";
uint64_t lastRemoteCommandTimestamp = 0;

String lastActionName = "boot";
String lastActionValue = "";
String lastActionSource = "device";
String lastActionResult = "started";

void connectWiFi();
void ensureWiFi();
void setupPins();
void updateSensor();
void updateButtons();
void updateGateAutoClose();
void updateParkingBuzzer();
void pollRemoteCommand();
void fetchRemoteConfig();
void publishState(const String& reason);
bool handleCommand(const String& commandName, const String& value);
bool handleCommand(const String& commandName, const String& value, const String& source);
float measureDistanceCm();

void setup() {
  Serial.begin(115200);
  setupPins();

  preferences.begin("parking", false);
  lastRemoteCommandId = preferences.getString("lastCmdId", "");
  lastRemoteCommandTimestamp = preferences.getULong64("lastCmdTs", 0);

  gateServo.attach(Pins::SERVO, 500, 2400);
  gateServo.write(0);

  secureClient.setInsecure(); // Za skolski prototip. Za produkciju koristi validan CA sertifikat.

  Serial.println("Pametni parking sistem pokrenut.");
  Serial.println("Rampa je spustena.");
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
    updateSensor();
  }

  updateButtons();
  updateGateAutoClose();
  updateParkingBuzzer();

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
  pinMode(Pins::BUZZER, OUTPUT);

  for (ButtonMapping& button : buttons) {
    pinMode(button.pin, INPUT_PULLUP);
  }
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
    DynamicJsonDocument defaults(512);
    defaults["detectionDistanceCm"] = config.detectionDistanceCm;
    defaults["gateOpenMs"] = config.gateOpenMs;
    defaults["buzzerEnabled"] = config.buzzerEnabled;
    defaults["mode"] = config.mode;
    defaults["updatedBy"] = "esp32";
    JsonObject updatedAt = defaults.createNestedObject("updatedAt");
    updatedAt[".sv"] = "timestamp";

    String defaultPayload;
    serializeJson(defaults, defaultPayload);
    firebasePatch(devicePath("config"), defaultPayload);
    return;
  }

  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("Ne mogu da procitam config: ");
    Serial.println(error.c_str());
    return;
  }

  if (doc["detectionDistanceCm"].is<int>()) {
    config.detectionDistanceCm = constrain(doc["detectionDistanceCm"].as<int>(), 5, 200);
  }

  if (doc["gateOpenMs"].is<unsigned long>()) {
    config.gateOpenMs = constrain(doc["gateOpenMs"].as<unsigned long>(), 1000UL, 30000UL);
  }

  if (doc["buzzerEnabled"].is<bool>()) {
    config.buzzerEnabled = doc["buzzerEnabled"].as<bool>();
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
  DynamicJsonDocument doc(2048);
  doc["deviceId"] = DEVICE_ID;
  doc["online"] = WiFi.status() == WL_CONNECTED;
  doc["reason"] = reason;
  doc["uptimeMs"] = millis();
  doc["distanceCm"] = lastDistanceCm;
  doc["carPresent"] = carPresent;
  doc["gate"] = gateOpen ? "open" : "closed";
  doc["buzzerEnabled"] = config.buzzerEnabled;
  doc["mode"] = config.mode;
  doc["lastRemoteCommandId"] = lastRemoteCommandId;
  doc["lastRemoteCommandTimestamp"] = lastRemoteCommandTimestamp;

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

void updateSensor() {
  lastDistanceCm = measureDistanceCm();
  carPresent = lastDistanceCm > 0 && lastDistanceCm <= config.detectionDistanceCm;

  Serial.print("Udaljenost: ");
  if (lastDistanceCm < 0) {
    Serial.println("nema ocitavanja");
  } else {
    Serial.print(lastDistanceCm);
    Serial.println(" cm");
  }
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

void openGateTemporary() {
  gateServo.write(90);
  gateOpen = true;
  gateOpenUntilMs = millis() + config.gateOpenMs;
  noTone(Pins::BUZZER);
}

void openGateManual() {
  gateServo.write(90);
  gateOpen = true;
  gateOpenUntilMs = 0; // Rucno otvorena rampa ostaje otvorena dok ne stigne komanda za zatvaranje.
  noTone(Pins::BUZZER);
}

void closeGate() {
  gateServo.write(0);
  gateOpen = false;
  gateOpenUntilMs = 0;
  noTone(Pins::BUZZER);
}

void updateGateAutoClose() {
  if (!gateOpen || gateOpenUntilMs == 0) {
    return;
  }

  if ((long)(millis() - gateOpenUntilMs) >= 0) {
    closeGate();
  }
}

void updateParkingBuzzer() {
  static bool toneActive = false;
  static unsigned long nextToggleMs = 0;

  if (!config.buzzerEnabled || gateOpen || !carPresent || lastDistanceCm <= 0) {
    noTone(Pins::BUZZER);
    toneActive = false;
    return;
  }

  const int frequency = 2000;
  unsigned long pauseMs = 0;

  if (lastDistanceCm > 15) {
    pauseMs = 500;
  } else if (lastDistanceCm > 10) {
    pauseMs = 250;
  } else if (lastDistanceCm > 5) {
    pauseMs = 100;
  } else {
    tone(Pins::BUZZER, frequency);
    toneActive = true;
    return;
  }

  const unsigned long now = millis();
  if (now < nextToggleMs) {
    return;
  }

  if (toneActive) {
    noTone(Pins::BUZZER);
    toneActive = false;
    nextToggleMs = now + pauseMs;
  } else {
    tone(Pins::BUZZER, frequency);
    toneActive = true;
    nextToggleMs = now + 70;
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
      Serial.println("DOZVOLJEN PROLAZ. Rampa se otvara.");
      openGateTemporary();
      return true;
    }

    if (normalizedValue == "deny") {
      Serial.println("ZABRANJEN PROLAZ. Rampa ostaje spustena.");
      closeGate();
      return true;
    }
  }

  if (normalizedName == "gate.position") {
    if (normalizedValue == "open") {
      openGateManual();
      return true;
    }

    if (normalizedValue == "close") {
      closeGate();
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
      noTone(Pins::BUZZER);
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

float measureDistanceCm() {
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
