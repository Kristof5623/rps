# Távlovas Időmérő és Versenyirányító Rendszer (Endurance Race Tracker)

A távlovas (endurance) sportban használandó idők, állatorvosi adatok és versenyzői státuszok teljes körű kezelését és számítását végző webes alkalmazás. Jelenleg az adatok felvitele manuálisan történik a dedikált szerepkörök (beérkeztetők, orvosok) által, de a jövőben egy Python alapú hardveres integráció fogja automatizálni a fizikai kapukon áthaladó lovasok időmérését.

## Leírás

A projekt célja egy olyan komplex, felhőalapú rendszer (Firebase háttérrel) létrehozása, amely a távlovas versenyek teljes lebonyolítását lefedi: a versenykiírástól kezdve, az élő időmérésen és orvosi vizsgálatokon át, egészen a hivatalos Excel alapú eredménylisták és hőnyomtatós matricák generálásáig. Ha érdekel a projekt, vagy szívesen csatlakoznál a fejlesztéshez, keress bátran!

## Funkciók és Képességek

A rendszer jelenleg az alábbi főbb modulokkal és funkciókkal rendelkezik:

### ÉLŐ Versenykezelés és Nevezés
* **Komplex kategóriakezelés:** 20km, 40km, 60km, 80km (Felnőtt/Junior), 100km (Felnőtt/Junior) távok kezelése, testreszabható körhosszokkal és rajtidőkkel.
* **Versenyzők és Lovak regisztrációja:** Rajtszám, lovas neve, ló neve, egyesület, igazolási számok rögzítése. Tömeges importálási lehetőség (JSON).
* **Állatorvosok menedzselése:** A versenyen résztvevő hivatalos állatorvosok listájának kezelése.

### Időmérés és Értékelés
* **Többlépcsős időrögzítés:** Külön felület a "Beérkezés" és az "Orvosi kapu" (Vet gate) idejének rögzítésére.
* **Automatikus számítások:** A rendszer valós időben számolja a köridőket, a pulzusidőt (regenerációs idő), a körönkénti és az összesített átlagsebességeket (km/h).
* **Élő rangsorolás és lemaradás:** Automatikusan kiszámítja a versenyzők helyezését és a vezetőhöz képesti lemaradást a szabálykönyvnek megfelelően.
* **Célidő / Minősítés kalkulátor:** Segédeszközök a szükséges átlagsebességek és részidők gyors kiszámításához.

### Állatorvosi Vizsgálat (Vet Gate)
* **Részletes orvosi karton:** Pulzus, HRRI, nyálkahártya, kapilláris telítődés (CRT), bélműködés, vízháztartás, izomzat és mozgás értékelésének rögzítése.
* **Hivatalos státuszkódok:** A rendszer kezeli a nemzetközi/hazai rövidítéseket (Active, WD, RET, DSQ, FNR, FTQ-SP, FTQ-GA, FTQ-ME, stb.).

### Élő Kijelzők és TV Mód
* **Versenyzői Adatlapok:** Részletes, nyilvánosan is követhető adatlapok minden lovasról, színes státuszjelzőkkel és élő pozíciókkal.
* **Várakozó / Induló lista (Live Departures):** Visszaszámláló az éppen pihenőidejüket töltő lovasok következő startjáig.
* **TV / Fullscreen Mód:** Kivetítőkre és nagyképernyőkre optimalizált sötét témás élő nézet.

### Exportálás és Nyomtatás
* **Hivatalos Excel Export:** A múltbéli versenyek eredményeinek letöltése a `tavlovasok.hu` hivatalos formátumában (szétbontva kategóriákra, pontos helyezésekkel és kiesési okokkal).
* **Okos Hőnyomtatás:** 15x10 cm-es fekete-fehér hőnyomtatóra optimalizált "Sticker" nyomtatása az orvosi vizsgálat befejezésekor, ami tartalmazza a lovas minden aktuális adatát, idejét és a következő start idejét.
* **A4-es PDF Listák:** Rajtlisták, Nevezési listák és automatikusan generált QR-kódos plakátok nyomtatása az élő követéshez.

## Szerepkör-alapú Hozzáférés (RBAC)

A rendszer dedikált bejelentkezést biztosít, hogy a verseny közben mindenki csak azt lássa, amivel dolga van:
* **Admin:** Teljes hozzáférés mindenhez, versenyek létrehozása, lezárása, törlése.
* **Bíró (Judge):** Hozzáférés az eredmények beviteléhez és felülbírálásához.
* **Beérkeztető (Check-in):** Csak a lovak célba érkezési idejét, illetve az orvosi kapun való áthaladás idejét rögzíti.
* **Állatorvos (Doctor):** Kizárólag a klinikai paramétereket, a pulzust és az orvosi döntést viszi fel a rendszerbe.
* **Nyomtató (Printer):** Hozzáférés a hőnyomtatós matricák gyors kiadásához a Vet Gate végén.

## Használt Technológiák

A frontend jelenleg egy gyors, reszponzív (SPA) webalkalmazás, amely mobiltelefonon és tableten is kiválóan használható a terepen.

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (DOM manipuláció)
* **Backend & Adatbázis:** Firebase Realtime Database (valós idejű adatszinkronizáció a terminálok között)
* **Autentikáció:** Firebase Auth (Email/Jelszó alapú szerepkörös beléptetés)
* **Jövőbeli integráció:** Python (Raspberry Pi / Arduino alapú RFID vagy fotocellás hardveres kapuk adatainak feldolgozására és a Firebase-be küldésére).

## Verziótörténet

* **v97 (Jelenlegi verzió)**
    * Teljes Firebase integráció, valós idejű szinkronizáció a különböző szerepkörök (Orvos, Beérkeztető) tabletjei között.
    * Hőnyomtató-optimalizált (15x10cm) orvosi karton nyomtatás.
    * Hivatalos tavlovasok.hu kompatibilis Excel (XLS) export.
    * Múltbéli és Jövőbeli versenyek menedzselése.
* **v95**
    * Frissített input mezők.
    * Jobb UX/UI kezelés mobil nézeten.
    * Bug fixek az időszámításokban.
