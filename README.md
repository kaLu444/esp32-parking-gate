# Udaljena kontrola parking rampe

Ovaj projekat predstavlja sistem za udaljeno upravljanje parking rampama preko web aplikacije i ESP32 uredjaja. Sistem je zamisljen kao prototip pametnog parking ulaza i izlaza, sa komunikacijom preko Firebase Realtime Database-a.

Web aplikacija sluzi kao kontrolna tabla za operatora, dok ESP32 upravlja senzorima, servo motorima, buzzerima, LED signalizacijom i fizickim dugmadima. Projekat je napravljen tako da moze kasnije da se prosiri novim senzorima, komandama, izlazima i rezimima rada.

## Glavna ideja

Sistem ima dve rampe:

- Rampa 1 predstavlja ulaz.
- Rampa 2 predstavlja izlaz.

Ulazna rampa koristi ultrazvucni senzor za detekciju vozila, servo motor za podizanje rampe, pasivni buzzer kao parking senzor, RGB diodu za signalizaciju i fizicka dugmad za dozvolu ili zabranu prolaza.

Izlazna rampa koristi Sharp analogni senzor za detekciju vozila, drugi servo motor, aktivni buzzer i dve LED diode za prikaz da li je rampa spustena ili podignuta.

## Sta web aplikacija radi

Web aplikacija prikazuje stanje sistema u realnom vremenu:

- da li je ESP32 online ili offline
- da li je vozilo detektovano
- trenutnu udaljenost na ulazu i izlazu
- stanje ulazne i izlazne rampe
- broj komandi poslatih tokom dana
- poslednje aktivnosti sistema

Operator kroz aplikaciju moze da:

- dozvoli pristup na ulazu
- zabrani pristup na ulazu
- otvori ili zatvori ulaznu rampu
- ukljuci ili iskljuci buzzer ulaza
- dozvoli izlaz
- zabrani izlaz
- otvori ili zatvori izlaznu rampu
- ukljuci ili iskljuci buzzer izlaza
- ukljuci automatski rezim za svaku rampu posebno
- pregleda sve aktivnosti u popup prozoru
- eksportuje dnevni izvestaj u CSV formatu

U aplikaciji postoji prostor za jednu kameru. Kamera se povezuje unosom YouTube live linka, nakon cega se live stream prikazuje direktno u glavnom panelu ulaza.

## Podesavanja sistema

Podesavanja nisu prikazana stalno na glavnoj tabli, vec se otvaraju kroz poseban popup. Time glavna kontrolna tabla ostaje pregledna, a detaljna konfiguracija je dostupna samo kada je potrebna.

U podesavanjima se trenutno mogu menjati:

- udaljenost detekcije za ulaznu rampu
- vreme koliko ulazna rampa ostaje otvorena
- udaljenost detekcije za izlaznu rampu
- udaljenost na kojoj se izlazna rampa automatski otvara
- vreme koliko izlazna rampa ostaje otvorena
- boja RGB diode kada nema vozila
- boja RGB diode dok se ceka odluka
- boja RGB diode kada je rampa otvorena
- boja RGB diode kada je prolaz zabranjen

Podesavanja se cuvaju u Firebase Realtime Database-u i ESP32 ih periodicki cita.

## Automatski i rucni rad

Svaka rampa ima svoj `Auto` checkbox.

Kada je automatski rezim ukljucen za ulaznu rampu, rampa se automatski otvara kada senzor detektuje vozilo. Kada je automatski rezim iskljucen, operator mora rucno da dozvoli ili zabrani prolaz.

Izlazna rampa je po defaultu zamisljena da radi automatski. Sharp senzor salje svako validno ocitavanje, a rampa se otvara tek kada je vozilo dovoljno blizu zadatom pragu otvaranja.

Rucno otvaranje rampe preko web aplikacije drzi rampu otvorenom dok operator ponovo ne klikne zatvaranje.

## Signalizacija

Ulazna rampa koristi RGB diodu:

- plava boja oznacava da nema vozila
- zuta boja oznacava da vozilo ceka odluku
- zelena boja oznacava dozvoljen prolaz
- crvena boja oznacava zabranjen prolaz

Ove boje mogu da se promene iz web aplikacije.

Izlazna rampa koristi dve posebne LED diode:

- crvena LED oznacava da je rampa spustena
- zelena LED oznacava da je rampa podignuta

## Buzzer logika

Ulazni buzzer radi kao parking senzor u automobilu. Kada je vozilo dalje od kriticne zone, buzzer ne pisti. Kada vozilo udje ispod 10 cm, buzzer pocinje da pisti u kratkim intervalima.

Sto je vozilo blize rampi, interval izmedju bipova je kraci:

- na vecoj udaljenosti cuje se spor ritam
- na srednjoj udaljenosti ritam postaje brzi
- kada je vozilo veoma blizu, bipovi su skoro spojeni

Izlazni buzzer je aktivni buzzer i koristi se kao kratak zvucni signal kada se druga rampa otvori ili zatvori.

## Firebase struktura

Komunikacija je organizovana po uredjaju:

```text
devices/esp32_1/commands
devices/esp32_1/state
devices/esp32_1/config
```

`commands` cuva komande koje web aplikacija salje ESP32 uredjaju.

`state` cuva trenutno stanje koje ESP32 salje nazad aplikaciji.

`config` cuva podesavanja sistema koja se menjaju iz web aplikacije.

Svaka komanda ima:

- naziv komande
- vrednost komande
- timestamp
- izvor komande
- identifikator zahteva

ESP32 pamti poslednju obradjenu komandu, tako da se ista komanda ne izvrsi vise puta.

## Podrzane komande

| Komanda | Vrednost | Opis |
| --- | --- | --- |
| `gate.access` | `allow` | Dozvoljava prolaz na ulazu |
| `gate.access` | `deny` | Zabranjuje prolaz na ulazu |
| `gate.position` | `open` | Otvara ulaznu rampu |
| `gate.position` | `close` | Zatvara ulaznu rampu |
| `buzzer.enabled` | `true` / `false` | Ukljucuje ili iskljucuje buzzer ulaza |
| `gate2.access` | `allow` | Dozvoljava izlaz |
| `gate2.access` | `deny` | Zabranjuje izlaz |
| `gate2.position` | `open` | Otvara izlaznu rampu |
| `gate2.position` | `close` | Zatvara izlaznu rampu |
| `gate2.buzzer.enabled` | `true` / `false` | Ukljucuje ili iskljucuje buzzer izlaza |

## ESP32 deo sistema

ESP32 je centralni uredjaj koji povezuje fizicki sistem sa cloud bazom. On cita komande iz Firebase-a, obradjuje ih kroz centralni command handler i izvrsava odgovarajuce funkcije.

Fizicka dugmad na ESP32 uredjaju pozivaju iste funkcije kao i komande iz web aplikacije. Zbog toga sistem ima jednu zajednicku logiku za lokalno i udaljeno upravljanje.

Kod je organizovan tako da se nove komande, novi senzori i novi GPIO pinovi mogu dodavati bez menjanja cele strukture programa.

## Tehnologije

Projekat koristi:

- HTML, CSS i JavaScript bez frameworka
- Firebase Realtime Database za komunikaciju
- GitHub Pages za hosting web aplikacije
- Arduino IDE i C++ za ESP32 kod
- ESP32Servo biblioteku za upravljanje servo motorima
- ArduinoJson za obradu JSON podataka

Sistem ne koristi placene servise.

## Trenutno stanje projekta

Trenutno je napravljena osnova funkcionalnog sistema za dve parking rampe. Web aplikacija ima moderan dashboard, komande za obe rampe, aktivnosti, izvestaj, podesavanja i prikaz stanja uredjaja.

ESP32 kod podrzava dve rampe, dva senzora, dva buzzera, RGB diodu, dve LED diode, fizicka dugmad, Firebase komande, slanje stanja i citanje konfiguracije.

Projekat je spreman za testiranje na pravom hardveru i dalje prosirenje, na primer dodavanje kamere, evidencije korisnika, dodatnih senzora ili naprednijih pravila za automatski rad.
