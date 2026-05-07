# ESP32 Parking Gate Remote Control

Osnova projekta za udaljenu kontrolu ESP32 parking rampe preko staticke web aplikacije, Firebase Realtime Database-a i Arduino/C++ koda za ESP32.

## Struktura projekta

```text
.
├── .github/workflows/pages.yml     # GitHub Pages deploy iz web/ direktorijuma
├── database.rules.json             # Firebase Realtime Database pravila za prototip
├── esp32_control/
│   └── esp32_control.ino           # ESP32 Arduino kod
└── web/
    ├── app.js                      # Firebase komunikacija i UI logika
    ├── firebase-config.js          # Firebase config koji treba popuniti
    ├── index.html                  # Web aplikacija
    └── styles.css                  # Moderan responsive UI
```

## Firebase model podataka

Komunikacija je organizovana po uredjaju:

```json
{
  "devices": {
    "esp32_1": {
      "commands": {
        "-pushId": {
          "name": "gate.access",
          "value": "allow",
          "timestamp": 1710000000000,
          "source": "web"
        }
      },
      "state": {
        "online": true,
        "gate": "closed",
        "carPresent": false,
        "distanceCm": 32.4,
        "lastProcessedCommand": {
          "name": "gate.access",
          "value": "allow",
          "source": "web",
          "result": "ok"
        }
      },
      "config": {
        "displayName": "Parking kapija",
        "detectionDistanceCm": 20,
        "gateOpenMs": 4000,
        "buzzerEnabled": true,
        "mode": "auto"
      }
    }
  }
}
```

Svaka komanda ima `name`, `value` i `timestamp`. Web aplikacija dodaje komande kroz `push()`, a ESP32 cita najnoviju komandu sortiranu po `timestamp`. Poslednja obradjena remote komanda se pamti u ESP32 NVS memoriji (`Preferences`), pa se ista komanda ne izvrsava vise puta ni posle restartovanja uredjaja.

## Kako napraviti Firebase projekat

1. Otvori [Firebase Console](https://console.firebase.google.com/) i izaberi `Add project`.
2. Unesi naziv projekta.
3. Google Analytics mozes da iskljucis za ovaj prototip.
4. Ostani na besplatnom Spark planu. Za ovaj projekat nisu potrebni placeni servisi.

## Kako podesiti Realtime Database

1. U Firebase projektu otvori `Build > Realtime Database`.
2. Izaberi `Create database`.
3. Izaberi lokaciju baze. URL ce liciti na:

```text
https://PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app
```

4. Za skolski prototip mozes da izaberes test mode.
5. U tabu `Rules` nalepi sadrzaj fajla `database.rules.json`:

```json
{
  "rules": {
    "devices": {
      "$deviceId": {
        ".read": true,
        ".write": true,
        "commands": {
          ".indexOn": ["timestamp"]
        }
      }
    }
  }
}
```

Ova pravila su namerno otvorena da bi web aplikacija sa GitHub Pages-a i ESP32 mogli da komuniciraju bez dodatnog servera. To je prihvatljivo za demo/prototip, ali nije za javnu produkciju. Za ozbiljniji sistem dodaj Firebase Authentication i stroza pravila.

## Kako ubaciti Firebase config u web aplikaciju

1. U Firebase Console otvori `Project settings`.
2. U sekciji `Your apps` dodaj Web app ako vec ne postoji.
3. Kopiraj `firebaseConfig`.
4. Zameni placeholder vrednosti u `web/firebase-config.js`.
5. Obavezno proveri da `databaseURL` odgovara Realtime Database URL-u.

Primer:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "tvoj-projekat.firebaseapp.com",
  databaseURL: "https://tvoj-projekat-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tvoj-projekat",
  storageBucket: "tvoj-projekat.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## Kako podesiti ESP32 kod

U Arduino IDE instaliraj:

- ESP32 board paket od Espressif-a
- `ESP32Servo`
- `ArduinoJson`

Otvori `esp32_control/esp32_control.ino` i popuni:

```cpp
const char* WIFI_SSID = "IME_WIFI_MREZE";
const char* WIFI_PASSWORD = "WIFI_LOZINKA";
const char* DATABASE_URL = "https://PROJECT_ID-default-rtdb.europe-west1.firebasedatabase.app";
const char* DEVICE_ID = "esp32_1";
```

ESP32 koristi ove glavne putanje:

- `devices/esp32_1/commands` za citanje remote komandi
- `devices/esp32_1/state` za slanje stanja
- `devices/esp32_1/config` za citanje podesavanja

Kod koristi `WiFiClientSecure.setInsecure()` da pojednostavi HTTPS za prototip. Za produkciju treba koristiti validan CA sertifikat umesto toga.

## Kako pokrenuti web aplikaciju lokalno

Web aplikaciju pokreci preko lokalnog servera, jer ES module importi i Firebase SDK rade pouzdanije preko HTTP/HTTPS nego direktnim otvaranjem fajla.

```powershell
node tools/dev-server.mjs
```

Zatim otvori:

```text
http://localhost:5173
```

## Kako pokrenuti web aplikaciju preko GitHub Pages

U projektu vec postoji workflow `.github/workflows/pages.yml`, koji deploy-uje sadrzaj `web/` direktorijuma.

1. Push-uj projekat na GitHub u `main` branch.
2. Otvori `Settings > Pages`.
3. U `Build and deployment > Source` izaberi `GitHub Actions`.
4. Pokreni workflow ili push-uj novu izmenu na `main`.
5. Kada deploy prodje, stranica ce biti dostupna preko GitHub Pages URL-a.

Ako ne zelis GitHub Actions, alternativa je da prebacis sadrzaj `web/` direktorijuma u root ili `docs/` folder i u Pages podesavanjima izaberes `Deploy from a branch`.

## Kako dodati novu komandu

Primer: dodavanje komande `light.enabled`.

1. U `web/app.js` dodaj novi objekat u `commandDefinitions`:

```js
{
  name: "light.enabled",
  value: true,
  label: "Svetlo ON",
  description: "Ukljuci dodatno svetlo.",
  icon: "lightbulb",
  tone: "info"
}
```

2. U `esp32_control/esp32_control.ino` dodaj novi pin u `namespace Pins`.

```cpp
const uint8_t LIGHT = 26;
```

3. U `setupPins()` postavi pin mode.

```cpp
pinMode(Pins::LIGHT, OUTPUT);
```

4. U centralni handler dodaj novu granu:

```cpp
if (normalizedName == "light.enabled") {
  digitalWrite(Pins::LIGHT, normalizedValue == "true" ? HIGH : LOW);
  return true;
}
```

5. Ako treba i fizicko dugme, dodaj novi `ButtonMapping` koji poziva isto ime komande i vrednost. Tako lokalno dugme i web aplikacija ostaju na istoj logici.

## Glavne komande koje su vec podrzane

| Komanda | Vrednost | Efekat |
| --- | --- | --- |
| `gate.access` | `allow` | Otvara rampu na podeseno vreme |
| `gate.access` | `deny` | Zatvara rampu i odbija prolaz |
| `gate.position` | `open` | Otvara rampu |
| `gate.position` | `close` | Zatvara rampu |
| `buzzer.enabled` | `true` / `false` | Ukljucuje ili iskljucuje buzzer |
| `mode` | `auto` / `manual` | Menja rezim rada |
| `state.publish` | `now` | Trazi trenutno stanje uredjaja |

## Korisni zvanicni linkovi

- [Firebase Realtime Database web setup](https://firebase.google.com/docs/database/web/start)
- [Firebase Realtime Database REST API](https://firebase.google.com/docs/reference/rest/database)
- [Firebase Realtime Database security rules](https://firebase.google.com/docs/database/security)
- [Firebase indexing data](https://firebase.google.com/docs/database/security/indexing-data)
- [GitHub Pages publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
