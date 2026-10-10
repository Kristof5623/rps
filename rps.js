
    // --- FIREBASE INICIALIZÁLÁS ---
    const firebaseConfig = {
      apiKey: "AIzaSyCzlVhZr9yqWB-rEV-b-jTBb-KYG1YCwIM",
      authDomain: "endurance-race-tracker.firebaseapp.com",
      databaseURL: "https://endurance-race-tracker-default-rtdb.europe-west1.firebasedatabase.app",
      projectId: "endurance-race-tracker",
      storageBucket: "endurance-race-tracker.firebasestorage.app",
      messagingSenderId: "1015097239730",
      appId: "1:1015097239730:web:4c60ec2907a62e68ef41ab"
    };
    
    firebase.initializeApp(firebaseConfig);
    const db = firebase.database();
    const auth = firebase.auth(); 
    // ------------------------------

    // --- GLOBÁLIS VÁLTOZÓK ---
    const CALC_LIMIT = 15.99;
    let currentAdatlapFilter = null;
    let dbListenersActive = false;
    // ÉLŐ PANELEK: MENTETLEN MÓDOSÍTÁS ŐRE (l. setFormDirty / isFormDirty)
    // Az élő újratöltés korábban a FÓKUSZ alapján döntött: ha a fókusz az űrlapon
    // belül volt, kihagyta a frissítést. Csakhogy a "Most" és a "Mentés" gomb is az
    // űrlapon BELÜL van, és kattintás után rajtuk marad a fókusz - vagyis amint a
    // rendszer vitte fel az időt (Most gomb), az adott panel élő frissítése végleg
    // leállt, amíg a felhasználó nem kattintott valahova az űrlapon kívülre.
    // Ezért nem a fókuszt nézzük, hanem azt, van-e TÉNYLEGES mentetlen módosítás.
    const ELO_FORMOK = ['verseny-form-container', 'beerkeztetes-form', 'orvosi-ido-form', 'orvosi-form'];
    const formDirty = {};
    let liveVets = [];
    // speedThresholds[dist] = { min, max } km/h, mindkettő opcionális (üres = nincs figyelve az a határ).
    // min: ez alatt időtúllépés (OT) kockázat. max: efölött sebesség miatti kiesés (SP) kockázat, 139. § (2).
    let speedThresholds = {};
    let ridersCache = {}; // riders/{license} - lo-lovas-integracio.md
    let horsesCache = {}; // horses/{startNum}
    let vetsDbCache = {}; // vetsDb/{nev} - allatorvos torzsadat (versenyfuggetlen)
    let clubsCache = {}; // clubs/{clubKey} - önálló egyesület-törzs
    let uiTheme = 'default'; // admin választja (settings/uiTheme), mindenkinek szinkronban - l. THEME_LIST
    // colors: [primary (dot), bg, card] - a swatch előnézet ebből épül fel (renderThemeSwatches)
    // Sorrend: sötét témák, majd világosak. A key-ek szándékosan változatlanok, hogy a
    // settings/uiTheme-ben tárolt régi érték ne törjön el - két téma jelentése viszont
    // megváltozott: 'terminal' már Éjkék (Tokyo Night), 'wheat' már Pergamen (meleg papír).
    const THEME_LIST = [
        { key: 'default',  label: '🐎 End-Ride (alap)', colors: ['#3cc68c', '#0c0e11', '#14171c'] },
        { key: 'nyereg',   label: '🟤 Nyereg',        colors: ['#D69A5C', '#14100C', '#1D1712'] },
        { key: 'graphite', label: '⚙️ Acél',          colors: ['#2F81F7', '#0D1117', '#161B22'] },
        { key: 'violet',   label: '🔮 Ametiszt',      colors: ['#7C7FF5', '#0B0C11', '#14161C'] },
        { key: 'terminal', label: '🌃 Éjkék',         colors: ['#7AA2F7', '#1A1B26', '#24283B'] },
        { key: 'mono',     label: '⬛ Minimál',       colors: ['#3E8BFF', '#000000', '#0A0A0A'] },
        { key: 'forest',   label: '🌲 Fenyves',       colors: ['#35C47D', '#0B120E', '#141C17'] },
        { key: 'ocean',    label: '🌊 Óceán',         colors: ['#3EB8E5', '#08131C', '#0F1F2B'] },
        { key: 'wine',     label: '🍷 Rubin',         colors: ['#E5484D', '#120E10', '#1C171A'] },
        { key: 'alt',      label: '🌅 Borostyán',     colors: ['#F5A524', '#14110D', '#1E1A15'] },
        { key: 'player',   label: '🎧 Player',        colors: ['#1DB954', '#0B0B0B', '#181818'] },
        { key: 'gold',     label: '✨ Éjarany',       colors: ['#D9A93C', '#0C0A07', '#17140E'] },
        { key: 'neon',     label: '🌆 Neon',          colors: ['#F04FB0', '#07060E', '#110E1E'] },
        { key: 'napfeny',  label: '🌞 Napfény (kint, erős fényben)', colors: ['#0B7A4B', '#FFFFFF', '#F2F5F3'] },
        { key: 'daylight', label: '🌤️ Verőfény',     colors: ['#0570DE', '#F6F9FC', '#FFFFFF'] },
        { key: 'nordic',   label: '🧊 Északi Fény',   colors: ['#5E81AC', '#ECEFF4', '#FFFFFF'] },
        { key: 'mint',     label: '🌿 Menta',         colors: ['#0E9F6E', '#F2F8F5', '#FFFFFF'] },
        { key: 'wheat',    label: '📜 Pergamen',      colors: ['#9F5B21', '#FAF8F4', '#FFFFFF'] },
        { key: 'coral',    label: '🌺 Korall',        colors: ['#D9544A', '#FCF6F4', '#FFFFFF'] },
        { key: 'pearl',    label: '🫧 Gyöngyház',     colors: ['#6B5AD6', '#F1EEF8', '#FFFFFF'] },
    ];

    // Ismeretlen kulcs (pl. egy régen törölt téma neve a localStorage-ban) esetén az Alapra esünk
    // vissza - anélkül a data-theme egy nem létező témára mutatna, és a :root maradna érvényben,
    // de a swatch-listán semmi sem lenne kijelölve.
    function ervenyesTemaKulcs(key) {
        return THEME_LIST.some(t => t.key === key) ? key : 'default';
    }

    function applyThemeColorMeta(key) {
        const t = THEME_LIST.find(x => x.key === key) || THEME_LIST[0];
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', t.colors[1]);
    }

    function applyTheme(key) {
        const kulcs = ervenyesTemaKulcs(key);
        document.documentElement.setAttribute('data-theme', kulcs);
        applyThemeColorMeta(kulcs);
        return kulcs;
    }

    // Villanás-mentes indulás: amíg a Firebase beállítás betöltődik, a legutóbb ismert témát használjuk
    applyTheme(localStorage.getItem('uiTheme') || 'default');
    
    let viewingPastRaceData = null; 
    let pastAdatlapFilter = null; 
    
    // FŐ ÉLŐ VERSENY ADATOK
    let liveRaceMeta = null;
    let competitors = [];
    let editingBib = null;
    let raceConfig = getEmptyRaceConfig();

    // LOKÁLIS VERSENYLISTÁK A FIREBASE-BŐL
    let localRaces = { mult: [], jovo: [] };
    // Megjött-e már az első Firebase pillanatkép? Amíg nem, töltés-csontvázat mutatunk a
    // "nincs verseny rögzítve" felirat helyett (l. renderLocalRaces).
    const betoltesAllapot = { races: false, live: false };

    // MODAL VERSENY ADATOK
    let modalRaceId = null;
    let modalRaceConfig = getEmptyRaceConfig();
    let modalCompetitors = [];
    let modalEditingBib = null;
    let modalGyorsEditingBib = null; // IDEIGLENES: "Gyors eredmény" fül szerkesztési állapota - l. saveRmGyorsCompetitor()

    // A hosszú távoknak (120-160) nincs junior párja a 120j kivételével: a Magyar Junior
    // Bajnokság 80-120 km, és nemzetközileg is a CEIYJ2* 120 a felső határ.
    const catNames = {
        "160": "160 km",
        "140": "140 km",
        "120": "120 km", "120j": "120 km Junior",
        "100": "100 km", "100j": "100 km Junior",
        "80":  "80 km", "80j": "80 km Junior",
        "60":  "60 km", "40":  "40 km", "20":  "20 km"
    };

    // A távok sorrendje mindenhol (kiírás, verseny-szerkesztő) ebből jön, hogy egy helyen
    // lehessen bővíteni. Csökkenő táv szerint, a junior változat a felnőtt párja után.
    const DIST_ORDER = ["160", "140", "120", "100", "80", "60", "40", "20"];

    // Az összes nevezhető kategória (junior változattal együtt), csökkenő táv szerint. Helyezés-
    // számítás, adatlap-lista és sebességhatár mind ebből dolgozik - korábban mindegyik saját,
    // 100 km-nél megálló listát használt, így egy 120-160 km-es versenyző sosem kapott helyezést.
    const ALL_CATS = ["160", "140", "120", "120j", "100", "100j", "80", "80j", "60", "40", "20"];

    // A körszám a max. 40 km-es körhossz szabályt tartja (48. § (2)).
    function getEmptyRaceConfig() {
        return {
            "160": { h:'', m:'', s:'', laps: ['', '', '', '', ''] },
            "140": { h:'', m:'', s:'', laps: ['', '', '', '', ''] },
            "120": { h:'', m:'', s:'', laps: ['', '', '', ''] },
            "100": { h:'', m:'', s:'', laps: ['', '', '', ''] },
            "80":  { h:'', m:'', s:'', laps: ['', '', ''] },
            "60":  { h:'', m:'', s:'', laps: ['', '', ''] },
            "40":  { h:'', m:'', s:'', laps: ['', ''] },
            "20":  { h:'', m:'', s:'', laps: [''] }
        };
    }

    // KÖTELEZŐ PIHENŐIDŐ (53. §) körönként: cfg.holds[i] = az i. kör UTÁNI pihenő percben,
    // a kiírásban (élőben is) admin állítja. Ha nincs megadva: 40 perc, de 100 km és afölötti
    // távon az utolsó pihenő (az utolsó kör előtti) 50 perc - 53. § (3): legalább az egyik
    // pihenőnek 50 percesnek kell lennie. Az utolsó kör után nincs pihenő (cél).
    const ALAP_PIHENO_PERC = 40;

    function alapPihenoPerc(dist, lapIdx, lapCount) {
        const km = parseInt(String(dist || '').replace('j', ''), 10) || 0;
        if (km >= 100 && lapCount >= 2 && lapIdx === lapCount - 2) return 50;
        return ALAP_PIHENO_PERC;
    }

    function getPihenoPerc(cfg, dist, lapIdx) {
        const lapCount = ((cfg && cfg.laps) || []).length;
        const v = cfg && cfg.holds ? parseFloat(cfg.holds[lapIdx]) : NaN;
        return (!isNaN(v) && v > 0) ? v : alapPihenoPerc(dist, lapIdx, lapCount);
    }

    function parseCompetitors(data) {
        if (!data) return [];
        // FNR (teljesítette, de helyezés nélkül - II. melléklet) NEM kiesés: régebbi adatban
        // isEliminated=true-val is előfordul, ezt itt egységesen kiegyenesítjük.
        return Object.values(data).filter(c => c && c.bib !== undefined).map(c => {
            if (c.status === 'FNR' && c.isEliminated) c.isEliminated = false;
            return c;
        });
    }

    // Az RFID kapu (rfid_kapu.py) csak a nyers időket írja (laps/{i}/h,m,s és oh,om,os) - a számolt
    // mezőket (arrSec, vetSec, isComplete, nextStart, sebességek) csak a felületi mentés tölti ki.
    // Addig a rangsor, az Élő Kiindulások, a matrica stb. nem látná az RFID-vel felírt időt. Ezért ha
    // egy versenyzőnél a nyers idő és a számolt érték nem egyezik, a KIJELZÉSHEZ helyben újraszámoljuk
    // (az adatbázisba nem írunk - a következő felületi mentés úgyis elvégzi).
    function szamolatlanIdokPotlasa(comps, config) {
        return comps.map(c => {
            if (!c || !c.dist || !(c.laps || []).length) return c;
            const elter = (c.laps || []).some(l => l && (
                toSec(l.h, l.m, l.s) !== (l.arrSec || 0) || toSec(l.oh, l.om, l.os) !== (l.vetSec || 0)));
            if (!elter) return c;
            const uj = recalcCompetitorData(JSON.parse(JSON.stringify(c)), config);
            delete uj._timeWarnings;
            return uj;
        });
    }

    // Helyezés kiírása: "3." / "FNR" / "ELIM" - a fok-jel ("3º") magyarul hibás.
    function helyezesCimke(c, rank) {
        if (c.isEliminated) return 'ELIM';
        if (c.status === 'FNR' || rank === 'FNR') return 'FNR';
        return (rank === undefined || rank === null || rank === '-' || rank === '') ? '-' : rank + '.';
    }

    // Sorrend a listákban: helyezettek, utánuk az FNR (teljesítette, helyezés nélkül), végül a kiesettek.
    function eredmenyCsoport(c) {
        if (c.isEliminated) return 2;
        if (c.status === 'FNR') return 1;
        return 0;
    }

    function eredmenyRendezo(ranksInfo) {
        return (a, b) => {
            const ga = eredmenyCsoport(a), gb = eredmenyCsoport(b);
            if (ga !== gb) return ga - gb;
            if (ga === 0) {
                const ra = typeof ranksInfo[a.bib]?.rank === 'number' ? ranksInfo[a.bib].rank : 999;
                const rb = typeof ranksInfo[b.bib]?.rank === 'number' ? ranksInfo[b.bib].rank : 999;
                if (ra !== rb) return ra - rb;
            }
            return parseInt(a.bib) - parseInt(b.bib);
        };
    }

    // km/h magyar formában (tizedesvessző).
    function kmh(v, jegy = 2) {
        return (typeof v === 'number' && isFinite(v)) ? v.toFixed(jegy).replace('.', ',') : '-';
    }

    // --- LÓ- ÉS LOVAS-TÖRZSADAT (docs/lo-lovas-integracio.md, P1/2) ---
    function sanitizeKey(s) {
        return String(s).trim().replace(/[.#$\[\]]/g, '_');
    }

    // Nevezéskor a ló/lovas törzsadat frissítése MEZŐSZINTŰ útvonalakkal. Korábban a teljes
    // riders/{igazolás} és horses/{start szám} rekordot írtuk felül {név, klub, ...}-bal, ami a
    // multi-path update miatt KITÖRÖLTE a szövetségi adatokat (FEI szám, edző, minősítő pont,
    // "foreign" jelző...) - így lett üres pl. Bukor Barbara adatlapja, és így került be egy
    // külföldi a magyar bajnokságba. Üres mezővel nem írunk felül meglévő értéket.
    function torzsFrissitesek(startNum, loNev, license, lovasNev, club) {
        const u = {};
        const most = Date.now();
        const sn = String(startNum || '').trim();
        const lic = String(license || '').trim();
        if (sn) {
            const p = 'horses/' + sanitizeKey(sn) + '/';
            u[p + 'startNum'] = sn;
            u[p + 'updatedAt'] = most;
            if (String(loNev || '').trim()) u[p + 'name'] = String(loNev).trim();
        }
        if (lic) {
            const p = 'riders/' + sanitizeKey(lic) + '/';
            u[p + 'license'] = lic;
            u[p + 'updatedAt'] = most;
            if (String(lovasNev || '').trim()) u[p + 'name'] = String(lovasNev).trim();
            if (String(club || '').trim()) u[p + 'club'] = String(club).trim();
        }
        return u;
    }

    // (A fázis 1-2 egyszeri adatjavítás/migráció lefutott és leellenőrzésre került - 47 lovas, 53 ló,
    // konfliktus/hiányzó rekord nélkül - ezért a kód innen törölve. l. docs/lo-lovas-integracio.md)

    // FÁZIS 4 - Google-szerű javaslatlista: bármelyik mezőbe gépelve (név, ló, start szám,
    // igazolási szám, egyesület) feldobja az egyező, már ismert lovakat/lovasokat, kattintásra
    // pedig a hozzá tartozó összes mezőt kitölti.
    function searchRiders(q) {
        const lq = q.toLowerCase();
        const seen = new Set();
        return Object.values(ridersCache).filter(r => {
            if (!r || seen.has(r.license)) return false;
            const match = (r.name && r.name.toLowerCase().includes(lq)) || (r.license && String(r.license).toLowerCase().includes(lq));
            if (match) seen.add(r.license);
            return match;
        }).map(r => ({ label: `${r.name} — ${r.license}${r.club ? ' · ' + r.club : ''}`, ...r }));
    }

    function searchHorses(q) {
        const lq = q.toLowerCase();
        return Object.values(horsesCache).filter(h => h && ((h.name && h.name.toLowerCase().includes(lq)) || (h.startNum && String(h.startNum).toLowerCase().includes(lq))))
            .map(h => ({ label: `${h.name} — ${h.startNum}`, ...h }));
    }

    // Elsődlegesen a saját clubs/ törzsből keres, és amíg egy frissen beírt egyesület még
    // nincs benne, kiegészíti a riders/{license}.club
    // mezőkből is - így nem esik ki semmi a listából. Normalizált kulccsal (kisbetűs,
    // összevont szóközök) dedupolunk, hogy egy elgépelt szóköz ne látsszon külön klubnak.
    function searchClubs(q) {
        const lq = q.toLowerCase();
        const clubs = new Map();
        Object.values(clubsCache).forEach(c => {
            if (!c || !c.name) return;
            const trimmed = c.name.trim().replace(/\s+/g, ' ');
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (!clubs.has(key)) clubs.set(key, trimmed);
        });
        Object.values(ridersCache).forEach(r => {
            if (!r || !r.club) return;
            const trimmed = r.club.trim().replace(/\s+/g, ' ');
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (!clubs.has(key)) clubs.set(key, trimmed);
        });
        return Array.from(clubs.values()).filter(c => c.toLowerCase().includes(lq)).map(c => ({ label: c, club: c }));
    }

    // Állatorvos-törzsadat: a vets/ node mindig az AKTUÁLIS verseny orvosait
    // tartalmazza, a vetsDb/ viszont megőrzi az összes eddig felvitt orvost.
    // Így új versenynél nem kell újra begépelni a neveket, elég rákeresni.
    function searchVets(q) {
        const lq = q.toLowerCase();
        return Object.values(vetsDbCache)
            .filter(v => v && v.name && v.name.toLowerCase().includes(lq))
            .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
            .map(v => ({ label: v.name, name: v.name }));
    }

    // A törzsadatba felvétel: a név maga a kulcs (sanitizeKey), így ugyanaz az
    // orvos nem kerül be kétszer. A már rögzített vizsgálatokban a kiírt név
    // a hiteles - azt ez soha nem módosítja.
    function vetTorzsbe(name) {
        const tiszta = String(name || '').trim().replace(/\s+/g, ' ');
        if (!tiszta) return;
        db.ref('vetsDb/' + sanitizeKey(tiszta)).update({
            name: tiszta,
            updatedAt: Date.now()
        }).catch(() => {});
    }

    // Az inputot egy pozicionált wrapperbe csomagolja és alá illeszti a javaslatlistát -
    // a HTML-t nem kell hozzá módosítani, csak egyszer meg kell hívni induláskor.
    function attachAutocomplete(inputId, getSuggestions, onSelect) {
        const input = document.getElementById(inputId);
        if (!input || input.dataset.acBound) return;
        input.dataset.acBound = '1';

        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);

        const list = document.createElement('div');
        list.className = 'ac-list';
        wrapper.appendChild(list);

        // Google-kereső-szerű billentyűzetes vezérlés: nyilakkal lép a listában, Enter/Tab
        // elfogadja a kijelöltet - ha még nem nyilazott, mindig az első elem a kijelölt alapból.
        let currentItems = [];
        let highlightIndex = -1;

        function updateHighlight() {
            Array.from(list.children).forEach((el, i) => el.classList.toggle('active', i === highlightIndex));
            const activeEl = list.children[highlightIndex];
            if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ block: 'nearest' });
        }

        function selectItem(idx) {
            const item = currentItems[idx];
            if (!item) return;
            onSelect(item);
            list.style.display = 'none';
        }

        function render(items) {
            currentItems = items;
            highlightIndex = items.length ? 0 : -1;
            if (!items.length) { list.style.display = 'none'; list.innerHTML = ''; return; }
            // textContent-tel épül, nem innerHTML-lel - ha egy név/egyesület valaha < vagy > karaktert
            // tartalmazna, ne szakítsa meg vagy értelmezze HTML-ként a listát.
            list.innerHTML = items.map((it, i) => `<div class="ac-item${i === 0 ? ' active' : ''}" data-idx="${i}"></div>`).join('');
            Array.from(list.children).forEach((el, i) => {
                el.textContent = items[i].label;
                el.onmousedown = (e) => { e.preventDefault(); selectItem(i); };
                el.onmouseenter = () => { highlightIndex = i; updateHighlight(); };
            });
            list.style.display = 'block';
        }

        input.addEventListener('input', () => {
            const q = input.value.trim();
            if (!q) { list.style.display = 'none'; return; }
            render(getSuggestions(q).slice(0, 8));
        });
        input.addEventListener('focus', () => {
            const q = input.value.trim();
            if (q) render(getSuggestions(q).slice(0, 8));
        });
        input.addEventListener('keydown', (e) => {
            if (list.style.display !== 'block' || !currentItems.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightIndex = (highlightIndex + 1) % currentItems.length;
                updateHighlight();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                highlightIndex = (highlightIndex - 1 + currentItems.length) % currentItems.length;
                updateHighlight();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                selectItem(highlightIndex >= 0 ? highlightIndex : 0);
            } else if (e.key === 'Tab') {
                // nem preventDefault-oljuk, hogy a böngésző alapértelmezett fókuszváltása is lefusson -
                // így a Tab egyszerre fogadja el a javaslatot ÉS lép a következő mezőre.
                selectItem(highlightIndex >= 0 ? highlightIndex : 0);
            } else if (e.key === 'Escape') {
                list.style.display = 'none';
            }
        });
        input.addEventListener('blur', () => setTimeout(() => { list.style.display = 'none'; }, 150));
    }

    function initAutocompleteFields(prefix) {
        const p = prefix ? prefix + '-' : '';

        attachAutocomplete(p + 'regName', searchRiders, (item) => {
            document.getElementById(p + 'regName').value = item.name;
            document.getElementById(p + 'regLicense').value = item.license;
            if (item.club) document.getElementById(p + 'regClub').value = item.club;
        });
        attachAutocomplete(p + 'regLicense', searchRiders, (item) => {
            document.getElementById(p + 'regLicense').value = item.license;
            document.getElementById(p + 'regName').value = item.name;
            if (item.club) document.getElementById(p + 'regClub').value = item.club;
        });
        attachAutocomplete(p + 'regInternal', searchHorses, (item) => {
            document.getElementById(p + 'regInternal').value = item.name;
            document.getElementById(p + 'regStartNum').value = item.startNum;
        });
        attachAutocomplete(p + 'regStartNum', searchHorses, (item) => {
            document.getElementById(p + 'regStartNum').value = item.startNum;
            document.getElementById(p + 'regInternal').value = item.name;
        });
        attachAutocomplete(p + 'regClub', searchClubs, (item) => {
            document.getElementById(p + 'regClub').value = item.club;
        });
        // Állatorvos-név kereső: elég beírni pár betűt a korábbi versenyeken
        // már szerepelt orvosokból.
        attachAutocomplete(p + 'regVetName', searchVets, (item) => {
            document.getElementById(p + 'regVetName').value = item.name;
        });
    }

    function mergeRaceConfig(dbConfig) {
        let safeCfg = getEmptyRaceConfig();
        if(!dbConfig) return safeCfg;
        for(let k in safeCfg) {
            if(dbConfig[k]) {
                safeCfg[k].h = dbConfig[k].h || '';
                safeCfg[k].m = dbConfig[k].m || '';
                safeCfg[k].s = dbConfig[k].s || '';
                if(dbConfig[k].laps && Array.isArray(dbConfig[k].laps)) {
                    safeCfg[k].laps = [...dbConfig[k].laps];
                } else if(dbConfig[k].laps) {
                    safeCfg[k].laps = Object.values(dbConfig[k].laps);
                }
                for(let i=0; i<safeCfg[k].laps.length; i++) {
                    if(safeCfg[k].laps[i] === undefined) safeCfg[k].laps[i] = '';
                }
                // Körönkénti pihenőidő (perc) - l. getPihenoPerc(). A Firebase a ritka tömböt
                // objektumként adhatja vissza, ezért kulcs szerint másoljuk.
                if (dbConfig[k].holds) {
                    const h = dbConfig[k].holds;
                    safeCfg[k].holds = safeCfg[k].laps.map((_, i) => (h[i] === undefined || h[i] === null) ? '' : h[i]);
                }
            }
        }
        return safeCfg;
    }

    function generateSlug(name, date) {
        let str = (name + '-' + (date || "verseny")).toLowerCase();
        str = str.replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i').replace(/ó/g, 'o').replace(/ö/g, 'o').replace(/ő/g, 'o').replace(/ú/g, 'u').replace(/ü/g, 'u').replace(/ű/g, 'u');
        str = str.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
        return str || Date.now().toString();
    }

    // --- TOAST NOTIFICATIONS ---
    function showToast(msg, isError = false) {
        const t = document.getElementById('toastMessage');
        t.innerText = msg;
        t.style.background = isError ? 'var(--danger)' : 'var(--success)';
        t.style.display = 'block';
        setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    let confirmCallback = null;
    function showConfirm(title, msg, callback) {
        document.getElementById('confirmTitle').innerText = title;
        document.getElementById('confirmDesc').innerText = msg;
        confirmCallback = callback;
        document.getElementById('customConfirm').style.display = 'flex';
    }
    function closeConfirm() {
        document.getElementById('customConfirm').style.display = 'none';
        confirmCallback = null;
    }
    document.getElementById('confirmOkBtn').addEventListener('click', () => {
        if(confirmCallback) confirmCallback();
        closeConfirm();
    });

    // --- MANUÁLIS ÉS AUTOMATIKUS MIGRÁCIÓS MOTOR ---
    function forceMoveRace(fromType, toType, id) {
        let msg = fromType === 'mult' && toType === 'jovo' ? "Biztosan áthelyezed a Jövőbeli versenyek közé?" : "Biztosan áthelyezed?";
        showConfirm("Verseny áthelyezése", msg, () => {
            // Célzott olvasás a konkrét versenyre - a "/" gyökér beolvasása a szigorúbb
            // Firebase szabályok mellett permission_denied hibát dobna (nincs .read a gyökéren).
            db.ref('races/' + fromType + '/' + id).once('value').then(snap => {
                let sourceRace = snap.val();
                if (sourceRace) {
                    let updates = {};
                    updates['races/' + toType + '/' + id] = sourceRace;
                    updates['races/' + fromType + '/' + id] = null;
                    db.ref('/').update(updates).then(() => {
                        showToast("Verseny sikeresen áthelyezve!");
                    }).catch(e => showToast("Hiba az áthelyezéskor: " + e.message, true));
                }
            }).catch(e => showToast("Hiba az áthelyezéskor: " + e.message, true));
        });
    }

    function forceMoveToLive(sourceType, id) {
        const uzenet = "Biztosan ÉLŐ-be teszed ezt a versenyt?\n(A jelenlegi élő futam automatikusan lezárul és átkerül a múltba!)" +
            (liveRaceMeta ? befejezetlenFigyelmeztetes(competitors, raceConfig, 'a lezáruló élő versenyben') : '');
        showConfirm("Verseny Élesítése", uzenet, () => {
            // Célzott olvasások a "/" gyökér helyett - lásd forceMoveRace megjegyzését.
            Promise.all([
                db.ref('liveRaceMeta').once('value'),
                db.ref('raceConfig').once('value'),
                db.ref('competitors').once('value'),
                db.ref('races/' + sourceType + '/' + id).once('value'),
                db.ref('vets').once('value')
            ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap, sourceSnap, vetsSnap]) => {
                let updates = {};
                let curLiveMeta = liveMetaSnap.val();
                let curRaceConfig = raceConfigSnap.val();
                let curCompetitors = competitorsSnap.val();

                if (curLiveMeta) {
                    let oldId = curLiveMeta.id || Date.now().toString();
                    updates['races/mult/' + oldId] = {
                        id: oldId, name: curLiveMeta.name, loc: curLiveMeta.loc, date: curLiveMeta.date, desc: curLiveMeta.desc || "",
                        isObRound: curLiveMeta.isObRound !== false,
                        raceConfig: curRaceConfig || getEmptyRaceConfig(),
                        competitors: curCompetitors || null,
                        // Az élő verseny orvosai a lezárt versenyhez kerülnek (korábban elvesztek).
                        vets: vetsSnap.val() || null
                    };
                }

                let sourceRace = sourceSnap.val();
                if (sourceRace) {
                    updates['liveRaceMeta'] = { id: sourceRace.id, name: sourceRace.name, loc: sourceRace.loc, date: sourceRace.date, desc: sourceRace.desc || "", isObRound: sourceRace.isObRound !== false };
                    updates['raceConfig'] = sourceRace.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = sourceRace.competitors || null;
                    // A versenyhez felvett orvosok lesznek az élő orvoslista - nem az előző verseny orvosai.
                    updates['vets'] = sourceRace.vets || null;
                    updates['races/' + sourceType + '/' + id] = null;
                }

                db.ref('/').update(updates).then(() => {
                    showToast("🚀 Verseny sikeresen ÉLŐ-be mozgatva!");
                    switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'));
                }).catch(e => showToast("Hiba a mozgatáskor: " + e.message, true));
            }).catch(e => showToast("Hiba a mozgatáskor: " + e.message, true));
        });
    }

    // Lezárt versenyben helyezést kapna, pedig nem teljesítette a távot: nincs kiesve, nem FNR,
    // nem "Gyors eredmény", és kevesebb kész köre van, mint amennyi a kiírásban szerepel (ide
    // tartozik az is, aki el sem indult, de nem kapott WD-t). A rangsort ez nem írja át - a valódi
    // adatban ilyen eddig nem fordult elő -, csak lezáráskor és exportkor figyelmeztetünk rá.
    function befejezetlenVersenyzok(comps, cfg) {
        return (comps || []).filter(c => {
            if (!c || c.isEliminated || c.status === 'FNR' || c.manualEntry) return false;
            const vart = (((cfg || {})[String(c.dist || '').replace('j', '')] || {}).laps || []).length;
            const kesz = (c.laps || []).filter(l => l && l.isComplete).length;
            return vart > 0 && kesz < vart;
        });
    }
    function befejezetlenFigyelmeztetes(comps, cfg, mi) {
        const lista = befejezetlenVersenyzok(comps, cfg);
        if (!lista.length) return '';
        const nevek = lista.map(c => {
            const vart = ((cfg[String(c.dist).replace('j', '')] || {}).laps || []).length;
            const kesz = (c.laps || []).filter(l => l && l.isComplete).length;
            return `#${c.bib} ${c.name} (${catNames[c.dist] || c.dist}, ${kesz}/${vart} kör)`;
        }).join(', ');
        return `\n\n⚠️ ${lista.length} versenyző nem fejezte be a távot, és nincs kiesési státusza, ezért ${mi} helyezést kapna: ${nevek}. Előbb érdemes beállítani a státuszát (pl. WD, RET vagy FTQ).`;
    }

    function forceMoveToPastFromLive() {
        const uzenet = "Biztosan a Múltbéli versenyek közé rakod a jelenlegi ÉLŐ versenyt?" + befejezetlenFigyelmeztetes(competitors, raceConfig, 'a lezárt versenyben');
        showConfirm("Verseny Lezárása", uzenet, () => {
            // Célzott olvasások a "/" gyökér helyett - lásd forceMoveRace megjegyzését.
            Promise.all([
                db.ref('liveRaceMeta').once('value'),
                db.ref('raceConfig').once('value'),
                db.ref('competitors').once('value'),
                db.ref('vets').once('value')
            ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap, vetsSnap]) => {
                let curLiveMeta = liveMetaSnap.val();
                if (!curLiveMeta) return;

                let oldId = curLiveMeta.id || Date.now().toString();
                let updates = {};

                updates['races/mult/' + oldId] = {
                    id: oldId, name: curLiveMeta.name, loc: curLiveMeta.loc, date: curLiveMeta.date, desc: curLiveMeta.desc || "",
                    isObRound: curLiveMeta.isObRound !== false,
                    raceConfig: raceConfigSnap.val() || getEmptyRaceConfig(),
                    competitors: competitorsSnap.val() || null,
                    vets: vetsSnap.val() || null
                };

                updates['liveRaceMeta'] = null;
                updates['raceConfig'] = getEmptyRaceConfig();
                updates['competitors'] = null;
                updates['vets'] = null;

                db.ref('/').update(updates).then(() => {
                    showToast("Verseny sikeresen lezárva és átmozgatva a Múltba!");
                    switchMainTab('versenyek', document.getElementById('btn-menu-versenyek'));
                }).catch(e => showToast("Hiba a lezáráskor: " + e.message, true));
            }).catch(e => showToast("Hiba a lezáráskor: " + e.message, true));
        });
    }

    function runAutoMigration() {
        // Célzott olvasások a "/" gyökér helyett - lásd forceMoveRace megjegyzését.
        Promise.all([
            db.ref('liveRaceMeta').once('value'),
            db.ref('raceConfig').once('value'),
            db.ref('competitors').once('value'),
            db.ref('races/jovo').once('value'),
            db.ref('vets').once('value')
        ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap, jovoSnap, vetsSnap]) => {
            let curRaceConfig = raceConfigSnap.val();
            let curCompetitors = competitorsSnap.val();
            let curVets = vetsSnap.val();

            // Helyi időzóna szerinti pontos dátum (Magyar idő)
            let d = new Date();
            let today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            let meta = liveMetaSnap.val() || null;
            let jovo = jovoSnap.val() || {};

            let updates = {};
            let needsUpdate = false;

            if (meta && meta.date < today) {
                let id = meta.id || Date.now().toString();
                updates['races/mult/' + id] = {
                    id: id, name: meta.name, loc: meta.loc, date: meta.date, desc: meta.desc || "",
                    isObRound: meta.isObRound !== false,
                    raceConfig: curRaceConfig || getEmptyRaceConfig(),
                    competitors: curCompetitors || {},
                    vets: curVets || null
                };
                updates['raceConfig'] = getEmptyRaceConfig();
                updates['competitors'] = {};
                updates['vets'] = null;
                updates['liveRaceMeta'] = null;
                meta = null;
                needsUpdate = true;
            }

            if (!meta) {
                let toMoveId = Object.keys(jovo).find(key => jovo[key].date === today);
                if (toMoveId) {
                    let r = jovo[toMoveId];
                    updates['liveRaceMeta'] = { id: r.id, name: r.name, loc: r.loc, date: r.date, desc: r.desc || "", isObRound: r.isObRound !== false };
                    updates['raceConfig'] = r.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = r.competitors || {};
                    // A versenyhez előre felvett orvosok lesznek az élő orvoslista.
                    updates['vets'] = r.vets || null;
                    updates['races/jovo/' + toMoveId] = null;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                db.ref('/').update(updates).then(() => console.log("✅ Automatikus verseny migráció sikeresen lefutott!"));
            }
        }).catch(e => console.warn("Automatikus verseny migráció kihagyva:", e.message));
    }

    // --- BIZTONSÁGOS FIREBASE FIGYELŐK ---
    function startDatabaseListeners() {
        if(dbListenersActive) return;
        dbListenersActive = true;

        db.ref('liveRaceMeta').on('value', snap => {
            liveRaceMeta = snap.val();
            betoltesAllapot.live = true;
            szurkolasFigyeles();
            renderLocalRaces();
            nyitottNezetFrissitese();   // pl. A4 nyomtatványok: az élő verseny is választható
        });

        db.ref('races').on('value', (snapshot) => {
            if(snapshot.exists()) {
                const data = snapshot.val();
                localRaces = {
                    mult: data.mult ? Object.values(data.mult) : [],
                    jovo: data.jovo ? Object.values(data.jovo) : []
                };
            } else {
                localRaces = { mult: [], jovo: [] };
            }
            betoltesAllapot.races = true;
            renderLocalRaces();
            
            if (document.getElementById('export-mod').classList.contains('active')) {
                renderExportList();
            }
            
            if (viewingPastRaceData && document.getElementById('past-race-view').classList.contains('active')) {
                const updatedRace = localRaces.mult.find(x => x.id === viewingPastRaceData.id);
                if(updatedRace) { viewingPastRaceData = updatedRace; renderPastAdatlapList(); refreshOpenModalIfNeeded(); }
            }

            nyitottNezetFrissitese();
        });

        db.ref('raceConfig').on('value', (snapshot) => {
            raceConfig = mergeRaceConfig(snapshot.val());
            competitors = szamolatlanIdokPotlasa(competitors, raceConfig);
            renderKiiras();
            if (!viewingPastRaceData && document.getElementById('adatlapok').classList.contains('active')) { renderAdatlapList(); }
            refreshOpenModalIfNeeded();
        });

        db.ref('competitors').on('value', (snapshot) => {
            competitors = szamolatlanIdokPotlasa(parseCompetitors(snapshot.val()), raceConfig);
            rfidKapuFrissites();
            kovetesEsemenyek();
            updateCompetitorDisplays();
            if (attekintoForras === 'live' && document.getElementById('attekinto-mod')?.classList.contains('active')) renderAttekinto();
            if (document.getElementById('kezdolap')?.classList.contains('active')) renderKezdolap();
            
            // A kategória-választó nézet (currentAdatlapFilter === null) is frissüljön:
            // eddig egy új kategória csak fülváltás után jelent meg.
            if(!viewingPastRaceData && document.getElementById('adatlapok').classList.contains('active')) { renderAdatlapList(); }
            refreshOpenModalIfNeeded();

            // A nyomtatási kártya eddig kimaradt a frissítésből: a kiválasztott
            // versenyzőnél régi időkkel maradt a képernyőn (és úgy is nyílt nyomtatásra).
            if(document.getElementById('nyomtatas-mod').classList.contains('active')) {
                if (document.getElementById('sel-nyomtatas').value) loadNyomtatasData();
            }

            if(document.getElementById('fo-mod').classList.contains('active') && document.getElementById('verseny').style.display === 'block') {
                // Csak az ŰRLAPOT nézzük, nem az egész fület, és a fókusz helyett a
                // mentetlen módosítást: a gombok (Most / Mentés) nem blokkolják a
                // frissítést, csak a ténylegesen beírt, még el nem mentett adat.
                const selectedBib = document.getElementById('selectCompetitor').value;
                if (selectedBib && !isFormDirty('verseny-form-container')) { loadCompetitorData(); }
            }
            if(document.getElementById('beerkeztetes-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-beerkeztetes').value;
                if (selectedBib && !isFormDirty('beerkeztetes-form')) { loadBeerkeztetesData(); }
            }
            if(document.getElementById('orvosi-ido-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-orvosi-ido').value;
                if (selectedBib && !isFormDirty('orvosi-ido-form')) { loadOrvosiIdoData(); }
            }
            if(document.getElementById('orvosi-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-orvosi').value;
                if (selectedBib && !isFormDirty('orvosi-form')) { loadOrvosiData(); }
            }
        });

        db.ref('vets').on('value', snap => {
            liveVets = snap.val() ? Object.values(snap.val()) : [];
            renderVetList();
            updateVetDropdowns();
        });

        // Ló/lovas törzsadat cache az autocomplete-hez (lo-lovas-integracio.md, 7. szakasz)
        db.ref('riders').on('value', snap => {
            ridersCache = snap.val() || {};
            if (document.getElementById('torzs-lovasok')?.classList.contains('active')) renderTorzsLovasokList();
            if (document.getElementById('beallitasok-pontkereso')?.style.display === 'block') renderAdminPontkereso();
            nyitottNezetFrissitese();   // bajnokság (korosztály, nevek), kezdőlap
        });
        db.ref('horses').on('value', snap => {
            horsesCache = snap.val() || {};
            if (document.getElementById('torzs-lovak')?.classList.contains('active')) renderTorzsLovakList();
            nyitottNezetFrissitese();   // ló-ranglista, Év Tenyésztője (tenyésztő a lótörzsből), kezdőlap
        });
        db.ref('clubs').on('value', snap => { clubsCache = snap.val() || {}; });
        // Állatorvos-törzsadat: versenyfüggetlen névlista a kereséshez.
        db.ref('vetsDb').on('value', snap => {
            vetsDbCache = snap.val() || {};
            if (document.getElementById('beallitasok-vetek')?.style.display === 'block') renderVetTorzs();
        });

        // Sebesség min/max távonként - alapból üres (nincs figyelve), minden eszközön szinkronban
        db.ref('settings/speedThresholds').on('value', snap => {
            speedThresholds = snap.val() || {};
            checkBeerkeztetesSpeed();
            renderSpeedThresholds();
            if (document.getElementById('adatlapok')?.classList.contains('active')) renderAdatlapList();
            if (document.getElementById('past-race-view')?.classList.contains('active')) renderPastAdatlapList();
        });

        // Design téma - alapból "default", minden eszközön szinkronban
        db.ref('settings/uiTheme').on('value', snap => {
            // Ha ezen az eszközön valaki saját témát választott, azt nem
            // írjuk felül - a közös téma csak alapértelmezés.
            if (localStorage.getItem('uiThemeSajat') === '1') { renderThemeSwatches(); return; }
            uiTheme = applyTheme(snap.val() || 'default');
            localStorage.setItem('uiTheme', uiTheme);
            renderThemeSwatches();
        });

        // Bajnoki pontszámítás törzsadatai (bajnoki-pontszamitas.md)
        db.ref('teams').on('value', snap => { teamsCache = snap.val() || {}; nyitottNezetFrissitese(); });
        db.ref('externalResults').on('value', snap => { externalResultsCache = snap.val() || {}; nyitottNezetFrissitese(); });
        db.ref('settings/bajnokavatasDatum').on('value', snap => { bajnokavatasDatumCache = snap.val() || {}; nyitottNezetFrissitese(); });
    }

    // ÚJRATÖLTÉS UTÁN: a nézet azonnal kirajzolódik (a legutóbbi helyén), az adatok és a belépés
    // állapota viszont csak egy pillanattal később érkeznek a Firebase-ből. Korábban emiatt egyes
    // nézetek (Felhasználók, bajnokság, Év Tenyésztője, lezárt verseny eredménye) üresek maradtak,
    // amíg a felhasználó ki-be nem lépett. Ezért minden érintett adat (és a belépés) megérkezésekor
    // az épp nyitott nézet újrarajzolódik - összevonva, hogy egy adatcsomagnál ne fusson le tízszer.
    let nezetFrissitesIdozito = null;
    function nyitottNezetFrissitese() {
        clearTimeout(nezetFrissitesIdozito);
        nezetFrissitesIdozito = setTimeout(() => {
            const aktiv = (document.querySelector('.mode-content.active') || {}).id;
            kezdolapAlso.forras = null; // a kezdőlap alsó része (bajnokság, ló-ranglista) is számolódjon újra
            refreshOpenBajnoksagViews();
            if (aktiv === 'kezdolap') renderKezdolap();
            if (aktiv === 'felhasznalok-mod' && authAllapotIsmert) renderFelhasznalokOldal();
            if (aktiv === 'nyomtatvanyok-mod') renderNyomtatvanyok();
            if (aktiv === 'export-mod') renderExportList();
            if (aktiv === 'past-race-view') multVersenyVisszaallitas();
        }, 60);
    }

    // A megnézett lezárt verseny (és kategória) megjegyzése, hogy újratöltés után is ugyanott legyünk
    const MULT_VERSENY_KULCS = 'rps-mult-verseny';
    function multVersenyMentes() {
        try {
            if (viewingPastRaceData) sessionStorage.setItem(MULT_VERSENY_KULCS, JSON.stringify({ id: viewingPastRaceData.id, dist: pastAdatlapFilter || null }));
            else sessionStorage.removeItem(MULT_VERSENY_KULCS);
        } catch (e) {}
    }
    function multVersenyVisszaallitas() {
        if (viewingPastRaceData || !document.getElementById('past-race-view')?.classList.contains('active')) return;
        let m = null;
        try { m = JSON.parse(sessionStorage.getItem(MULT_VERSENY_KULCS)); } catch (e) {}
        const r = m && localRaces.mult.find(x => x.id === m.id);
        if (r) openPublicPastRace(r.id, m.dist || null);
        else if (betoltesAllapot.races) switchSidebarMode('versenyek', document.getElementById('btn-menu-versenyek'));
    }

    // Csak azt a bajnoksági nézetet frissíti, ami épp aktív - a többi majd megnyitáskor újraszámol.
    function refreshOpenBajnoksagViews() {
        if (document.getElementById('bajnoksag-egyeni')?.classList.contains('active')) renderEgyeniBajnoksag();
        if (document.getElementById('bajnoksag-lo')?.classList.contains('active')) renderLoRanglista();
        if (document.getElementById('bajnoksag-teny')?.classList.contains('active')) renderEvTenyesztoje();
        if (document.getElementById('bajnoksag-csapat')?.classList.contains('active')) {
            if (document.getElementById('csapat-rang')?.style.display !== 'none') renderCsapatRanglista();
            if (document.getElementById('csapat-kezel')?.style.display === 'block') renderTeamList();
            if (document.getElementById('csapat-kulf')?.style.display === 'block') renderExternalResultsList();
            if (document.getElementById('csapat-datum')?.style.display === 'block') renderBajnokavatasDatumSettings();
        }
        if (document.getElementById('beallitasok-kulfoldi')?.style.display === 'block') renderKulfoldiKezelo();
        if (document.getElementById('attekinto-mod')?.classList.contains('active')) renderAttekinto();
        if (document.getElementById('beallitasok-vetek')?.style.display === 'block') renderVetTorzs();
    }

    startDatabaseListeners();

    // ============================================================================
    // FIÓK, BEJELENTKEZÉS, JOGOSULTSÁGOK
    // Belépés: Google-fiókkal, e-maillel (regisztrációval) vagy a régi stábfiókok felhasználónevével
    // (felhasznalonev@verseny.hu). Minden fiók a users/{uid} alatt: a profil (név, e-mail, kép,
    // utolsó belépés) és a követések a felhasználóé, a szerepkör (role) és a menünkénti jogok
    // (jogok) csak az adminé - a Firebase szabályai is így engedik (tests/firebase-szabalyok.json).
    // Íráshoz a szabályok a szerepkör meglétét kérik: aki csak regisztrált, az néző marad.
    // ============================================================================

    // A menük / belső nézetek jogai. A szerepkör adja az alapot (SZEREP_JOGOK), az admin a
    // Felhasználók oldalon pipánként felülírhatja. Az admin szerepkör mindent lát.
    const JOG_LISTA = [
        { kulcs: 'fomod-verseny', csoport: 'Élő verseny', cimke: 'Eredmények bevitele (Teljes verseny fül)' },
        { kulcs: 'fomod-kiiras', csoport: 'Élő verseny', cimke: 'Kiírás, versenyzők, sebességhatár' },
        { kulcs: 'beerkeztetes', csoport: 'Feladatkörök', cimke: 'Beérkeztetés' },
        { kulcs: 'orvosi-ido', csoport: 'Feladatkörök', cimke: 'Orvosi idő' },
        { kulcs: 'orvosi', csoport: 'Feladatkörök', cimke: 'Állatorvosi vizsgálat' },
        { kulcs: 'nyomtatas', csoport: 'Feladatkörök', cimke: 'Nyomtatás (orvosi lap)' },
        { kulcs: 'nyomtatvanyok', csoport: 'Admin eszközök', cimke: 'A4 nyomtatványok' },
        { kulcs: 'attekinto', csoport: 'Admin eszközök', cimke: 'Versenyáttekintő' },
        { kulcs: 'rfid', csoport: 'Admin eszközök', cimke: 'RFID kapuk' },
        { kulcs: 'export', csoport: 'Admin eszközök', cimke: 'Verseny exportálás' },
        { kulcs: 'beallitasok', csoport: 'Admin eszközök', cimke: 'Beállítások' },
        { kulcs: 'tenyeszto', csoport: 'Admin eszközök', cimke: 'Év Tenyésztője' }
    ];
    const SZEREPKOROK = [
        { kulcs: '', cimke: 'Nincs – csak néző' },
        { kulcs: 'judge', cimke: 'Bíró' },
        { kulcs: 'doctor', cimke: 'Állatorvos' },
        { kulcs: 'checkin', cimke: 'Beérkeztető' },
        { kulcs: 'printer', cimke: 'Nyomtató' },
        { kulcs: 'admin', cimke: 'Admin – mindent lát és kezel' }
    ];
    const SZEREP_JOGOK = {
        judge: ['fomod-verseny'],
        doctor: ['beerkeztetes', 'orvosi-ido', 'orvosi', 'nyomtatas'],
        checkin: ['beerkeztetes', 'orvosi-ido'],
        printer: ['nyomtatas']
    };
    // Menügomb -> melyik jog kell hozzá ('__admin': csak az admin szerepkör)
    const JOG_MENU = {
        'btn-menu-fomod': ['fomod-verseny', 'fomod-kiiras'],
        'btn-menu-attekinto': ['attekinto'],
        'btn-menu-rfid': ['rfid'],
        'btn-menu-nezok': ['__admin'],
        'btn-menu-beallitasok': ['beallitasok'],
        'btn-menu-export': ['export'],
        'btn-menu-felhasznalok': ['__admin'],
        'btn-menu-beerkeztetes': ['beerkeztetes'],
        'btn-menu-orvosi-ido': ['orvosi-ido'],
        'btn-menu-orvosi': ['orvosi'],
        'btn-menu-nyomtatas': ['nyomtatas'],
        'btn-menu-nyomtatvanyok': ['nyomtatvanyok'],
        'btn-menu-bajnoksag-teny': ['tenyeszto']
    };
    // Belső nézet -> jog. Ami nincs itt, az nyilvános.
    const NEZET_JOG = {
        'fo-mod': ['fomod-verseny', 'fomod-kiiras'], 'attekinto-mod': ['attekinto'], 'rfid-mod': ['rfid'], 'nezok-mod': ['__admin'],
        'beallitasok-mod': ['beallitasok'], 'export-mod': ['export'], 'felhasznalok-mod': ['__admin'],
        'beerkeztetes-mod': ['beerkeztetes'], 'orvosi-ido-mod': ['orvosi-ido'], 'orvosi-mod': ['orvosi'],
        'nyomtatas-mod': ['nyomtatas'], 'nyomtatvanyok-mod': ['nyomtatvanyok'], 'bajnoksag-teny': ['tenyeszto']
    };
    // Belépéskor ide visz a szerepkör (ha szabad oda), hogy a stáb rögtön a saját munkájánál legyen
    const SZEREP_NYITO = {
        doctor: { nezet: 'orvosi-mod', gomb: 'btn-menu-orvosi' },
        checkin: { nezet: 'beerkeztetes-mod', gomb: 'btn-menu-beerkeztetes' },
        printer: { nezet: 'nyomtatas-mod', gomb: 'btn-menu-nyomtatas' },
        judge: { nezet: 'fo-mod', gomb: 'btn-menu-fomod' }
    };

    let aktivSzerep = null;        // null = nincs belépve, 'guest' = belépett, de nincs szerepköre
    let aktivJogok = new Set();
    let authAllapotIsmert = false;  // amíg a Firebase nem szólt, nem terelünk el semmilyen nézetről
    let authUiKulcs = null;
    let fiokAdat = null;            // a users/{uid} tartalma (profil, kovetes, beallitas, role, jogok)
    let fiokRef = null, fiokFigyelo = null, migracioFutott = false;

    function adminE() { return aktivSzerep === 'admin'; }
    function jogVan(kulcs) { return adminE() || aktivJogok.has(kulcs); }
    function nezetEngedelyezett(id) {
        const kell = NEZET_JOG[id];
        if (!kell) return true;
        if (!aktivSzerep) return false;
        return kell.includes('__admin') ? adminE() : kell.some(jogVan);
    }
    function nyitoNezet() {
        switchSidebarMode('kezdolap', null);
    }

    // A szerepkör + a pipák -> a ténylegesen érvényes jogok halmaza
    function jogokSzamit(role, jogok) {
        if (role === 'admin') return new Set(JOG_LISTA.map(j => j.kulcs));
        if (jogok && typeof jogok === 'object') return new Set(Object.keys(jogok).filter(k => jogok[k]));
        return new Set(SZEREP_JOGOK[role] || []);
    }

    // --- NÉZŐSZÁMLÁLÁS (csak az admin látja, a kezdőlap tetején) ---
    // Minden megnyitott oldal (böngészőfül) fenntart egy jelenlet/{munkamenet} bejegyzést, amit a
    // Firebase a kapcsolat megszakadásakor magától töröl (onDisconnect) -> "most nézik: N". A napi
    // látogató: latogatok/{nap}/{böngésző-azonosító}, böngészőnként naponta egyszer írva (az azonosító
    // a localStorage-ban marad). Személyes adat nincs, csak véletlen azonosító és időpont.
    // Szabályok: tests/firebase-szabalyok.json (jelenlet, latogatok) - nélkülük az írás csendben elmarad.
    function veletlenAzon() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
    const jelenletRef = db.ref('jelenlet/' + veletlenAzon());
    (function nezoSzamlaloIndit() {
        let azon;
        try {
            azon = localStorage.getItem('rps-latogato');
            if (!azon) { azon = veletlenAzon(); localStorage.setItem('rps-latogato', azon); }
        } catch (e) { azon = veletlenAzon(); }
        // Ha ma már járt itt, a szabály elutasítja (!data.exists()) - így egy böngésző naponta egyszer számít.
        db.ref('latogatok/' + napIso(new Date()) + '/' + azon).set(Date.now()).catch(() => {});
        db.ref('.info/connected').on('value', snap => {
            if (snap.val() !== true) return;
            jelenletRef.onDisconnect().remove()
                .then(() => jelenletRef.set({ t: Date.now(), s: auth.currentUser ? 1 : 0 }))
                .catch(() => {});
        });
    })();

    // Az admin a háttérben figyeli a számokat (belépéstől), a "👁 Nézők" fül ebből rajzol.
    let nezoLeallit = null;
    const nezo = { most: null, belepve: 0, napok: null, csucs: 0, csucsIdo: null, hiba: false };
    function nezoSzamlaloFigyeles(be) {
        if (!be) { if (nezoLeallit) { nezoLeallit(); nezoLeallit = null; } return; }
        if (nezoLeallit) return;
        const jRef = db.ref('jelenlet'), lRef = db.ref('latogatok');
        const jCb = jRef.on('value', s => {
            const lista = Object.values(s.val() || {});
            nezo.most = lista.length; nezo.belepve = lista.filter(x => x && x.s).length; nezo.hiba = false;
            if (nezo.most >= nezo.csucs) { nezo.csucs = nezo.most; nezo.csucsIdo = new Date(); }
            renderNezok();
        }, () => { nezo.hiba = true; renderNezok(); });
        const lCb = lRef.on('value', s => {
            const v = s.val() || {};
            nezo.napok = {};
            Object.keys(v).forEach(nap => { nezo.napok[nap] = Object.keys(v[nap] || {}).length; });
            renderNezok();
        }, () => { nezo.hiba = true; renderNezok(); });
        nezoLeallit = () => { jRef.off('value', jCb); lRef.off('value', lCb); };
    }

    function renderNezok() {
        const cont = document.getElementById('nezok-tartalom');
        if (!cont || !document.getElementById('nezok-mod')?.classList.contains('active')) return;
        if (nezo.hiba) { cont.innerHTML = '<p class="field-hint">Nem olvasható – a Firebase-szabályok (jelenlet, latogatok) frissítése kell.</p>'; return; }
        const ma = napIso(new Date());
        const napok = nezo.napok || {};
        const szam = v => (v === null || v === undefined) ? '…' : v;
        const ido = d => d ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '';
        // Az utolsó 14 nap (a mai is), akkor is, ha valamelyik napon senki nem járt itt
        const lista = [];
        for (let i = 13; i >= 0; i--) { const n = new Date(); n.setDate(n.getDate() - i); lista.push(napIso(n)); }
        const max = Math.max(1, ...lista.map(n => napok[n] || 0));
        cont.innerHTML = `<div class="rfid-osszesito">
                <div><b>${szam(nezo.most)}</b><span>most nézik${typeof nezo.most === 'number' ? ` (bejelentkezve: ${nezo.belepve})` : ''}</span></div>
                <div><b>${nezo.napok ? (napok[ma] || 0) : '…'}</b><span>látogató ma</span></div>
                <div><b>${nezo.csucs || '…'}</b><span>mai csúcs egyszerre${nezo.csucsIdo ? ' (' + ido(nezo.csucsIdo) + ')' : ''} – amióta figyeled</span></div>
            </div>
            <h4 style="margin:14px 0 4px 0;">Látogatók naponta (utolsó 14 nap)</h4>
            <div class="nezo-napok">${lista.slice().reverse().map(n => `<div class="nezo-nap ${n === ma ? 'ma' : ''}">
                <span>${escapeHtml(n.slice(5).replace('-', '.'))}.${n === ma ? ' ma' : ''}</span>
                <div><div class="sav" style="width:${Math.round((napok[n] || 0) / max * 100)}%"></div></div>
                <span class="db">${napok[n] || 0}</span></div>`).join('')}</div>`;
    }

    auth.onAuthStateChanged(user => {
        if (fiokRef && fiokFigyelo) fiokRef.off('value', fiokFigyelo);
        fiokRef = null; fiokFigyelo = null; fiokAdat = null;
        jelenletRef.update({ s: user ? 1 : 0 }).catch(() => {});
        if (!user) {
            nezoSzamlaloFigyeles(false);
            applyAuthUI(false, null);
            kovetesBetoltes(null);
            return;
        }
        profilMentes(user);
        fiokRef = db.ref('users/' + user.uid);
        fiokFigyelo = fiokRef.on('value', snap => {
            fiokAdat = snap.val() || {};
            const role = fiokAdat.role || 'guest';
            applyAuthUI(true, role, jogokSzamit(role, fiokAdat.jogok));
            kovetesBetoltes(fiokAdat.kovetes || {});
            nezoSzamlaloFigyeles(role === 'admin');
            if (role === 'admin' && !migracioFutott) { migracioFutott = true; runAutoMigration(); }
            if (document.getElementById('fiokModal')?.style.display === 'flex') renderFiok();
        }, () => {
            fiokAdat = {};
            applyAuthUI(true, 'guest', new Set());
            kovetesBetoltes({});
        });
    });

    // Minden belépéskor frissül a saját profil (név, e-mail, kép, utolsó belépés) - ebből látja az
    // admin a Felhasználók oldalon, ki regisztrált. Ha a szabályok még a régiek, csendben kimarad.
    function profilMentes(user) {
        const szolg = (user.providerData && user.providerData[0] && user.providerData[0].providerId) || 'password';
        const email = String(user.email || '');
        const profil = {
            email: email,
            nev: String(user.displayName || (email.endsWith('@verseny.hu') ? email.split('@')[0] : '') || '').slice(0, 80),
            szolgaltato: szolg,
            utolsoBelepes: Date.now()
        };
        if (user.photoURL) profil.foto = String(user.photoURL).slice(0, 300);
        const ref = db.ref('users/' + user.uid + '/profil');
        ref.update(profil).then(() => ref.child('letrehozva').once('value')).then(s => {
            if (s && !s.exists()) return ref.update({ letrehozva: Date.now() });
        }).catch(() => {});
    }

    function applyAuthUI(isLoggedIn, role, jogok) {
        aktivSzerep = isLoggedIn ? (role || 'guest') : null;
        aktivJogok = isLoggedIn ? new Set(jogok || []) : new Set();
        authAllapotIsmert = true;

        const b = document.body;
        [...b.classList].filter(c => /^(role-|jog-)/.test(c) || c === 'jogos' || c === 'belepve').forEach(c => b.classList.remove(c));
        if (isLoggedIn) {
            b.classList.add('belepve', 'role-' + aktivSzerep);
            if (!adminE()) b.classList.add('jogos');
            JOG_LISTA.forEach(j => { if (jogVan(j.kulcs)) b.classList.add('jog-' + j.kulcs); });
        }
        menukJogSzerint();
        fiokSavFrissit();

        // Terelés csak akkor, ha a jogok tényleg változtak (különben pl. egy követés mentése is
        // átvinné az orvost a vizsgálati lapra).
        const kulcs = isLoggedIn ? aktivSzerep + '|' + [...aktivJogok].sort().join(',') : '-';
        if (kulcs !== authUiKulcs) {
            authUiKulcs = kulcs;
            szerepNavigacio(isLoggedIn);
        }
        ujNavFrissit();
        if (document.getElementById('kezdolap')?.classList.contains('active')) renderKezdolap();
        nyitottNezetFrissitese();
    }

    // A menügombok a jogok szerint (inline !important, mert a régi szerepkör-osztályok is !important-ok)
    function menukJogSzerint() {
        Object.entries(JOG_MENU).forEach(([id, kell]) => {
            const gomb = document.getElementById(id);
            if (!gomb) return;
            const lathato = !!aktivSzerep && (kell.includes('__admin') ? adminE() : kell.some(jogVan));
            gomb.style.setProperty('display', lathato ? 'flex' : 'none', 'important');
        });
        ['admin-menu', 'szerepkor-menu', 'nyomtatvany-menu'].forEach(id => {
            const cs = document.getElementById(id);
            if (!cs) return;
            const van = [...cs.querySelectorAll('.sidebar-btn')].some(g => g.style.display !== 'none');
            cs.style.setProperty('display', van ? 'flex' : 'none', 'important');
        });
    }

    function szerepNavigacio(isLoggedIn) {
        const aktiv = (document.querySelector('.mode-content.active') || {}).id;
        if (aktiv && !nezetEngedelyezett(aktiv)) { nyitoNezet(); }
        if (!isLoggedIn) return;
        const most = (document.querySelector('.mode-content.active') || {}).id;
        const nyito = SZEREP_NYITO[aktivSzerep];
        // A stáb a nyilvános nézetről a saját munkájához kerül; ha épp egy szabad belső nézeten van, ott marad.
        if (nyito && nezetEngedelyezett(nyito.nezet) && (!most || !NEZET_JOG[most])) {
            switchMainTab(nyito.nezet, document.getElementById(nyito.gomb));
        }
        if ((document.querySelector('.mode-content.active') || {}).id === 'fo-mod') foModFulJogSzerint();
    }

    // Az ÉLŐ Verseny Kezelés fülei: kiírás jog nélkül csak a "Teljes verseny" (eredmény) fül marad
    function foModFulJogSzerint() {
        if (!aktivSzerep || adminE()) return;
        const aktivFul = document.querySelector('#fo-mod .tabs .tab-btn.active');
        const kiirasFulek = ['btn-sebesseg', 'btn-kiiras', 'btn-versenyzok', 'btn-orvosok'];
        if (!jogVan('fomod-kiiras') && jogVan('fomod-verseny') && (!aktivFul || kiirasFulek.includes(aktivFul.id))) {
            switchSubMode('verseny', document.getElementById('btn-verseny'));
        } else if (!jogVan('fomod-verseny') && aktivFul && aktivFul.id === 'btn-verseny') {
            switchSubMode('kiiras', document.getElementById('btn-kiiras'));
        }
    }

    function szerepNev(role) {
        const sz = SZEREPKOROK.find(s => s.kulcs === role);
        return role === 'guest' || !role ? 'Néző' : (sz ? sz.cimke.split(' – ')[0] : role);
    }

    // --- Az oldalsó menü alján: belépés gomb vagy a fiók rövid adatai ---
    function fiokSavFrissit() {
        const sav = document.getElementById('fiok-sav');
        if (!sav) return;
        const u = auth.currentUser;
        if (!u) {
            sav.innerHTML = `<button class="sidebar-submit" onclick="fiokMegnyit('belepes')">Belépés / Regisztráció</button>
                <p class="fiok-sav-megj">Kövesd a kedvenc versenyzőidet, szurkolj nekik. A stáb itt lép be.</p>`;
            return;
        }
        const p = (fiokAdat && fiokAdat.profil) || {};
        sav.innerHTML = `<button class="fiok-sav-kartya" onclick="fiokMegnyit()">
                ${fiokAvatarHtml(u, p)}
                <span><b>${escapeHtml(p.nev || u.displayName || u.email || 'Fiókom')}</b><small>${escapeHtml(szerepNev(aktivSzerep))}</small></span>
            </button>
            <button class="sidebar-submit kijelentkezes" onclick="doLogout()">Kijelentkezés</button>`;
    }

    function fiokAvatarHtml(u, p) {
        const kep = (p && p.foto) || (u && u.photoURL);
        const nev = (p && p.nev) || (u && (u.displayName || u.email)) || '?';
        if (kep) return `<img class="fiok-avatar" src="${escapeHtml(kep)}" alt="" referrerpolicy="no-referrer">`;
        const betuk = String(nev).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '?';
        return `<span class="fiok-avatar betu">${escapeHtml(betuk)}</span>`;
    }

    // --- Belépés / regisztráció / fiók ablak ---
    let fiokNezet = 'belepes';
    let fiokUzenet = null;  // { szoveg, hiba }

    function fiokMegnyit(nezet, uzenet) {
        fiokNezet = nezet || (auth.currentUser ? 'fiok' : 'belepes');
        fiokUzenet = uzenet ? { szoveg: uzenet, hiba: false } : null;
        document.getElementById('fiokModal').style.display = 'flex';
        renderFiok();
        if (document.getElementById('sidebar').classList.contains('open')) toggleMenu();
    }
    function fiokBezar() { document.getElementById('fiokModal').style.display = 'none'; }
    function fiokNezetValt(n) { fiokNezet = n; fiokUzenet = null; renderFiok(); }

    const GOOGLE_IKON = `<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

    function renderFiok() {
        const cont = document.getElementById('fiokTartalom');
        if (!cont) return;
        const u = auth.currentUser;
        if (u && !['fiok'].includes(fiokNezet)) fiokNezet = 'fiok';
        if (!u && fiokNezet === 'fiok') fiokNezet = 'belepes';
        const uzenet = fiokUzenet ? `<div class="fiok-uzenet ${fiokUzenet.hiba ? 'hiba' : ''}">${escapeHtml(fiokUzenet.szoveg)}</div>` : '';

        if (fiokNezet === 'fiok') { cont.innerHTML = fiokOldalHtml(u) ; return; }

        const fulek = `<div class="fiok-fulek">
            <button class="${fiokNezet === 'belepes' ? 'aktiv' : ''}" onclick="fiokNezetValt('belepes')">Belépés</button>
            <button class="${fiokNezet === 'regisztracio' ? 'aktiv' : ''}" onclick="fiokNezetValt('regisztracio')">Regisztráció</button>
        </div>`;
        const google = `<button class="fiok-google" onclick="googleBelepes()">${GOOGLE_IKON}<span>${fiokNezet === 'regisztracio' ? 'Regisztráció' : 'Belépés'} Google-fiókkal</span></button>
            <div class="fiok-vagy"><span>vagy</span></div>`;

        let urlap = '';
        if (fiokNezet === 'belepes') {
            urlap = `<form onsubmit="emailBelepes(); return false;" class="fiok-urlap">
                    <label for="loginUser">E-mail vagy felhasználónév</label>
                    <input type="text" id="loginUser" autocomplete="username" required>
                    <label for="loginPass">Jelszó</label>
                    <input type="password" id="loginPass" autocomplete="current-password" required>
                    <button type="submit" class="calc-btn">Belépés</button>
                </form>
                <button class="fiok-link" onclick="fiokNezetValt('jelszo')">Elfelejtett jelszó?</button>`;
        } else if (fiokNezet === 'regisztracio') {
            urlap = `<form onsubmit="regisztracio(); return false;" class="fiok-urlap">
                    <label for="regNev">Név</label>
                    <input type="text" id="regNevFiok" autocomplete="name" maxlength="80" required>
                    <label for="regEmail">E-mail</label>
                    <input type="email" id="regEmail" autocomplete="email" required>
                    <label for="regJelszo">Jelszó (legalább 6 karakter)</label>
                    <input type="password" id="regJelszo" autocomplete="new-password" minlength="6" required>
                    <label for="regJelszo2">Jelszó még egyszer</label>
                    <input type="password" id="regJelszo2" autocomplete="new-password" minlength="6" required>
                    <label class="fiok-pipa"><input type="checkbox" id="regAdatvedelem" required> Elolvastam és elfogadom az <a href="#" onclick="adatvedelemMegnyit(); return false;">adatvédelmi tájékoztatót</a>.</label>
                    <button type="submit" class="calc-btn">Regisztráció</button>
                </form>`;
        } else if (fiokNezet === 'jelszo') {
            urlap = `<form onsubmit="jelszoEmlekezteto(); return false;" class="fiok-urlap">
                    <p class="fiok-megj">Add meg a regisztrációkor használt e-mail címet, és küldünk egy linket az új jelszó beállításához.
                        (A régi, felhasználónévvel belépő stábfiókoknál az admin tud segíteni.)</p>
                    <label for="jelszoEmail">E-mail</label>
                    <input type="email" id="jelszoEmail" autocomplete="email" required>
                    <button type="submit" class="calc-btn">Link küldése</button>
                </form>
                <button class="fiok-link" onclick="fiokNezetValt('belepes')">← Vissza a belépéshez</button>`;
        }
        cont.innerHTML = `<div class="fiok">
            <div class="fiok-fej">${brandLogoSvg('fiok-logo')}<div><h3>End-Ride fiók</h3><p>Kövesd a kedvenc versenyzőidet, kapj értesítést róluk, és szurkolj nekik élőben.</p></div></div>
            ${fiokNezet === 'jelszo' ? '' : fulek}
            <div id="fiok-uzenet-hely">${uzenet}</div>
            ${fiokNezet === 'jelszo' ? '' : google}
            ${urlap}
            <p class="fiok-megj kicsi">A stáb (bíró, állatorvos, beérkeztető) a regisztráció után az admintól kap jogot. <a href="#" onclick="adatvedelemMegnyit(); return false;">Adatvédelem</a></p>
        </div>`;
    }

    function fiokHibaSzoveg(e) {
        const kod = (e && (e.code || e.message)) || '';
        const t = {
            'auth/invalid-credential': 'Hibás e-mail / felhasználónév vagy jelszó.',
            'auth/wrong-password': 'Hibás jelszó.',
            'auth/user-not-found': 'Nincs ilyen fiók.',
            'auth/invalid-email': 'Az e-mail cím formátuma nem jó.',
            'auth/email-already-in-use': 'Ezzel az e-mail címmel már van fiók - lépj be, vagy kérj új jelszót.',
            'auth/weak-password': 'A jelszó túl gyenge (legalább 6 karakter).',
            'auth/too-many-requests': 'Túl sok próbálkozás - várj egy kicsit, és próbáld újra.',
            'auth/network-request-failed': 'Nincs internetkapcsolat.',
            'auth/popup-blocked': 'A böngésző letiltotta a felugró ablakot - engedélyezd, vagy próbáld újra.',
            'auth/operation-not-allowed': 'Ez a belépési mód még nincs bekapcsolva (admin: Firebase konzol → Authentication → Sign-in method).',
            'auth/unauthorized-domain': 'Ez a webcím nincs engedélyezve a belépéshez (admin: Firebase konzol → Authentication → Settings → Authorized domains).',
            'auth/requires-recent-login': 'Biztonsági okból lépj ki és be újra, majd próbáld meg még egyszer.',
            'auth/account-exists-with-different-credential': 'Ezzel az e-mail címmel már van fiók más belépési móddal - lépj be azzal.'
        };
        const talalt = Object.keys(t).find(k => kod.includes(k));
        if (talalt) return t[talalt];
        // A saját (űrlap-ellenőrzési) üzeneteinknek nincs kódjuk - azok úgy jók, ahogy vannak
        return e && !e.code && e.message ? e.message : 'Nem sikerült: ' + (e && e.message ? e.message : kod);
    }
    function fiokHiba(e) {
        const kod = (e && (e.code || e.message)) || '';
        if (/popup-closed-by-user|cancelled-popup-request/.test(kod)) return; // a felhasználó bezárta - nem hiba
        fiokUzenet = { szoveg: fiokHibaSzoveg(e), hiba: true };
        // Csak az üzenetsor frissül - az újrarajzolás kitörölné, amit a felhasználó beírt
        const hely = document.getElementById('fiok-uzenet-hely');
        if (hely) hely.innerHTML = `<div class="fiok-uzenet hiba" role="alert">${escapeHtml(fiokUzenet.szoveg)}</div>`;
        else renderFiok();
    }
    function fiokSiker(szoveg) {
        showToast(szoveg);
        fiokBezar();
    }

    function googleBelepes() {
        if (!firebase.auth.GoogleAuthProvider) { fiokHiba({ message: 'A Google-belépés itt nem érhető el.' }); return; }
        const provider = new firebase.auth.GoogleAuthProvider();
        try { auth.useDeviceLanguage(); } catch (e) {}
        auth.signInWithPopup(provider)
            .then(() => fiokSiker('Sikeres belépés.'))
            .catch(e => {
                // Telefonon / beépített böngészőben a felugró ablak tiltott lehet - átirányítással próbáljuk
                if (e && /popup-blocked|operation-not-supported-in-this-environment/.test(e.code || '')) {
                    auth.signInWithRedirect(provider).catch(fiokHiba);
                    return;
                }
                fiokHiba(e);
            });
    }

    function emailBelepes() {
        const u = document.getElementById('loginUser').value.trim();
        const p = document.getElementById('loginPass').value;
        // A régi stábfiókok felhasználónévvel lépnek be (nev@verseny.hu)
        const email = u.includes('@') ? u : u + '@verseny.hu';
        auth.signInWithEmailAndPassword(email, p)
            .then(() => fiokSiker('Sikeres belépés.'))
            .catch(e => { document.getElementById('loginPass').value = ''; fiokHiba(e); });
    }
    // Régi név, ha valahol még hívnák
    function doLogin() { emailBelepes(); }

    function regisztracio() {
        const nev = document.getElementById('regNevFiok').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const j1 = document.getElementById('regJelszo').value;
        const j2 = document.getElementById('regJelszo2').value;
        if (!document.getElementById('regAdatvedelem').checked) { fiokHiba({ message: 'Az adatvédelmi tájékoztató elfogadása kötelező.' }); return; }
        if (j1 !== j2) { fiokHiba({ message: 'A két jelszó nem egyezik.' }); return; }
        if (/@verseny\.hu$/i.test(email)) { fiokHiba({ message: 'Ez a cím a stábfiókoké - adj meg saját e-mail címet.' }); return; }
        auth.createUserWithEmailAndPassword(email, j1)
            .then(cred => cred.user.updateProfile({ displayName: nev }).then(() => profilMentes({
                uid: cred.user.uid, email: cred.user.email, displayName: nev, photoURL: null, providerData: [{ providerId: 'password' }]
            })))
            .then(() => fiokSiker('Sikeres regisztráció - üdv az End-Ride-on!'))
            .catch(fiokHiba);
    }

    function jelszoEmlekezteto() {
        const email = document.getElementById('jelszoEmail').value.trim();
        auth.sendPasswordResetEmail(email)
            .then(() => { fiokUzenet = { szoveg: 'Ha van ilyen fiók, elküldtük a linket - nézd meg a postafiókodat (a spam mappát is).', hiba: false }; fiokNezet = 'belepes'; renderFiok(); })
            .catch(fiokHiba);
    }

    function doLogout() {
        auth.signOut().then(() => {
            fiokBezar();
            nyitoNezet();
            showToast('Kijelentkeztél.');
        });
    }

    // Fiók törlése (Google Play / GDPR: a felhasználó maga törölhesse): a saját adatai és a belépési fiók
    function fiokTorles() {
        const u = auth.currentUser;
        if (!u) return;
        showConfirm('Fiók végleges törlése', 'Törlődik a profilod, a követéseid és a szurkolásaid, és a fiókkal többet nem tudsz belépni. Ez nem vonható vissza.', () => {
            const uid = u.uid;
            const torlesek = [
                db.ref('users/' + uid + '/profil').remove(),
                db.ref('users/' + uid + '/kovetes').remove(),
                db.ref('users/' + uid + '/beallitas').remove()
            ];
            if (liveRaceMeta && liveRaceMeta.id) Object.keys(szurkolasAdat || {}).forEach(bib => {
                if (szurkolasAdat[bib] && szurkolasAdat[bib][uid]) torlesek.push(db.ref('szurkolas/' + liveRaceMeta.id + '/' + bib + '/' + uid).remove());
            });
            Promise.all(torlesek.map(p => p.catch(() => null)))
                .then(() => u.delete())
                .then(() => { fiokBezar(); nyitoNezet(); showToast('A fiókodat töröltük.'); })
                .catch(e => { fiokUzenet = { szoveg: fiokHibaSzoveg(e), hiba: true }; renderFiok(); });
        });
    }

    // End-Ride logó (patkó, benne pulzusvonal - l. kepek/logo.svg). A háttér a téma kiemelő színe,
    // így minden témában illik a felülethez; a telefonos ikon (kepek/ikon-*.png) mindig zöld.
    function brandLogoSvg(osztaly = '') {
        return `<svg class="brand-logo ${osztaly}" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="24" class="bl-alap"/><path class="bl-lo" d="M29.93 72.29A30 30 0 1 1 70.07 72.29L61.38 62.63A17 17 0 1 0 38.62 62.63Z"/><rect class="bl-lyuk" x="27.38" y="56.90" width="3" height="6.8" rx="1.5" transform="rotate(-26.0 28.88 60.30)"/><rect class="bl-lyuk" x="25.01" y="45.78" width="3" height="6.8" rx="1.5" transform="rotate(2.0 26.51 49.18)"/><rect class="bl-lyuk" x="28.15" y="34.85" width="3" height="6.8" rx="1.5" transform="rotate(30.0 29.65 38.25)"/><rect class="bl-lyuk" x="68.85" y="34.85" width="3" height="6.8" rx="1.5" transform="rotate(-210.0 70.35 38.25)"/><rect class="bl-lyuk" x="71.99" y="45.78" width="3" height="6.8" rx="1.5" transform="rotate(-182.0 73.49 49.18)"/><rect class="bl-lyuk" x="69.62" y="56.90" width="3" height="6.8" rx="1.5" transform="rotate(-154.0 71.12 60.30)"/><path class="bl-vonal" d="M35 55H42L45.5 46L50.5 64L54.5 51L57 55H65"/></svg>`;
    }

    // --- A saját fiók oldala (belépve) ---
    function fiokOldalHtml(u) {
        const p = (fiokAdat && fiokAdat.profil) || {};
        const szolg = p.szolgaltato || ((u.providerData && u.providerData[0]) || {}).providerId || 'password';
        const email = p.email || u.email || '';
        const regiFiok = /@verseny\.hu$/i.test(email);
        const nev = p.nev || u.displayName || (regiFiok ? email.split('@')[0] : email) || 'Fiókom';
        const jogok = adminE() ? ['Minden menü (admin)'] : JOG_LISTA.filter(j => aktivJogok.has(j.kulcs)).map(j => j.cimke);
        const kov = kovetettLista();
        const ertesitesTamogatott = typeof Notification !== 'undefined';
        const ertesitesBe = ertesitesBekapcsolva();
        const tiltva = ertesitesTamogatott && Notification.permission === 'denied';

        return `<div class="fiok">
            <div class="fiok-profil">
                ${fiokAvatarHtml(u, p)}
                <div style="min-width:0;">
                    <h3>${escapeHtml(nev)}</h3>
                    <p>${regiFiok ? 'Stábfiók (felhasználónév: ' + escapeHtml(email.split('@')[0]) + ')' : escapeHtml(email)} · ${szolg === 'google.com' ? 'Google-fiók' : 'E-mail + jelszó'}</p>
                    <span class="fiok-szerep ${aktivSzerep && aktivSzerep !== 'guest' ? 'stab' : ''}">${escapeHtml(szerepNev(aktivSzerep))}</span>
                </div>
            </div>
            ${jogok.length ? `<div class="fiok-blokk"><h4>Jogosultságaid</h4><p class="fiok-megj">${jogok.map(escapeHtml).join(' · ')}</p></div>`
                : `<div class="fiok-blokk"><p class="fiok-megj">Nézőként követheted a versenyzőket és szurkolhatsz. Ha a stáb tagja vagy (bíró, állatorvos, beérkeztető), szólj az adminnak, és ő megadja a jogaidat.</p></div>`}

            <div class="fiok-blokk">
                <h4>⭐ Követett versenyzők és lovak</h4>
                ${kov.length ? `<div class="fiok-kovetettek">${kov.map(k => `<div class="fiok-kovetett">
                        <button class="name-link" onclick="fiokBezar(); ${k.tipus === 'lovas' ? 'openRiderProfile' : 'openHorseProfile'}('${escapeHtml(k.id)}')">${k.tipus === 'lovas' ? '👤' : '🐴'} ${escapeHtml(k.nev)}</button>
                        <button class="fiok-x" title="Követés vége" onclick="kovetesValt('${k.tipus}', '${escapeHtml(k.id)}')">✕</button>
                    </div>`).join('')}</div>`
                    : `<p class="fiok-megj">Még senkit nem követsz. Egy lovas vagy ló adatlapján a <b>☆ Követés</b> gombbal veheted fel - élő versenyen jelezzük, ha beér, átmegy a vizsgálaton vagy célba ér.</p>`}
            </div>

            <div class="fiok-blokk">
                <h4>🔔 Értesítések</h4>
                ${!ertesitesTamogatott ? `<p class="fiok-megj">Ez a böngésző nem tud értesítést küldeni. iPhone-on: Megosztás → „Főképernyőhöz adás”, és onnan megnyitva már igen.</p>`
                    : `<label class="fiok-kapcsolo"><input type="checkbox" ${ertesitesBe ? 'checked' : ''} ${tiltva ? 'disabled' : ''} onchange="ertesitesValt(this.checked)"> Értesítés a követettekről ezen az eszközön</label>
                       <p class="fiok-megj">${tiltva ? 'Az értesítések le vannak tiltva ennek az oldalnak a böngésző beállításaiban - ott tudod engedélyezni.'
                            : 'Akkor jön, amíg az End-Ride nyitva van (háttérben is). Ha az oldal előtérben van, a képernyő tetején jelenik meg.'}</p>`}
            </div>

            <div class="fiok-blokk">
                <h4>🎨 Megjelenés</h4>
                <p class="fiok-megj">A téma csak ezen az eszközön változik.</p>
                <div class="theme-swatch-row fiok-temak">${THEME_LIST.map(t => temaSwatchHtml(t, uiTheme === t.key, 'fiokTemaValt')).join('')}</div>
            </div>

            ${appTelepithetoHtml()}

            <div class="fiok-gombok">
                <button class="calc-btn" onclick="doLogout()">Kijelentkezés</button>
                <button class="fiok-link veszely" onclick="fiokTorles()">Fiók törlése</button>
            </div>
            <p class="fiok-megj kicsi"><a href="#" onclick="adatvedelemMegnyit(); return false;">Adatvédelmi tájékoztató</a></p>
        </div>`;
    }

    function fiokTemaValt(kulcs) { setUiTheme(kulcs); renderFiok(); }

    // --- Adatvédelmi tájékoztató (az adatkezelő nevét és címét az admin adja meg: Felhasználók oldal) ---
    function adatvedelemMegnyit() {
        const kiir = (adatkezelo) => {
            const nev = (adatkezelo && adatkezelo.nev) || 'az End-Ride üzemeltetője';
            const email = adatkezelo && adatkezelo.email;
            document.getElementById('infoModalTitle').textContent = 'Adatvédelmi tájékoztató';
            document.getElementById('infoModalBody').innerHTML = `
                <p><b>Adatkezelő:</b> ${escapeHtml(nev)}${email ? ` (${escapeHtml(email)})` : ''}.</p>
                <p><b>Milyen adatot tárolunk, ha fiókot hozol létre?</b> A neved, az e-mail címed, Google-belépésnél a profilképed címét,
                    a regisztráció és az utolsó belépés idejét, a követett versenyzőidet és lovaidat, valamint a szurkolásaidat (melyik versenyzőnek, mikor).</p>
                <p><b>Mire használjuk?</b> A belépéshez, a követéshez és az értesítésekhez, a szurkolások számlálásához, valamint ahhoz, hogy az admin
                    a stáb tagjainak (bíró, állatorvos, beérkeztető) jogot adhasson. Másnak nem adjuk tovább, hirdetésre nem használjuk.</p>
                <p><b>Hol tároljuk?</b> A Google Firebase szolgáltatásában (adatbázis és belépés). A versenyeredmények (lovas, ló, idők) a
                    versenyszabályzat szerint nyilvánosak - ezek nem a fiókodhoz tartoznak.</p>
                <p><b>Látogatottság:</b> a Cloudflare Web Analytics sütik nélkül, személyes azonosítás nélkül számolja a látogatásokat.</p>
                <p><b>Meddig?</b> Amíg a fiókod megvan. A <b>Fiók → Fiók törlése</b> gombbal bármikor törölheted - ekkor a profilod, a követéseid és
                    a szurkolásaid is törlődnek. Kérdés esetén ${email ? `írj a ${escapeHtml(email)} címre` : 'keresd az adatkezelőt'}.</p>
                <p><b>Jogaid:</b> hozzáférés, helyesbítés, törlés, tiltakozás; panasszal a Nemzeti Adatvédelmi és Információszabadság Hatósághoz (NAIH) fordulhatsz.</p>`;
            document.getElementById('infoModal').style.display = 'flex';
        };
        db.ref('settings/adatkezelo').once('value').then(s => kiir(s.val())).catch(() => kiir(null));
    }

    // ============================================================================
    // KÖVETÉS, ÉRTESÍTÉS, SZURKOLÁS
    // Követni lovast (igazolási szám) és lovat (start szám) lehet. Belépve a fiókban tároljuk
    // (users/{uid}/kovetes/{lovas|lo}/{id}), kijelentkezve ezen az eszközön - belépéskor átkerül.
    // Élő versenyen a követettek eseményeiről (beérkezés, vizsgálat, kiesés, cél) értesítést kap.
    // ============================================================================
    const KOVETES_HELYI = 'rps-kovetes';
    let kovetesek = { lovas: {}, lo: {} };

    function kovetesHelyiOlvas() {
        try { const k = JSON.parse(localStorage.getItem(KOVETES_HELYI)) || {}; return { lovas: k.lovas || {}, lo: k.lo || {} }; }
        catch (e) { return { lovas: {}, lo: {} }; }
    }
    function kovetesHelyiIr(k) { try { localStorage.setItem(KOVETES_HELYI, JSON.stringify(k)); } catch (e) {} }

    function kovetesBetoltes(fiokbol) {
        if (fiokbol === null) {
            kovetesek = kovetesHelyiOlvas();
        } else {
            kovetesek = { lovas: Object.assign({}, fiokbol.lovas), lo: Object.assign({}, fiokbol.lo) };
            // A kijelentkezve követetteket átvisszük a fiókba
            const helyi = kovetesHelyiOlvas();
            const atvinni = {};
            ['lovas', 'lo'].forEach(t => Object.keys(helyi[t]).forEach(id => {
                if (!kovetesek[t][id]) { atvinni[t + '/' + id] = Number(helyi[t][id]) || Date.now(); kovetesek[t][id] = atvinni[t + '/' + id]; }
            }));
            if (Object.keys(atvinni).length && auth.currentUser) {
                db.ref('users/' + auth.currentUser.uid + '/kovetes').update(atvinni)
                    .then(() => kovetesHelyiIr({ lovas: {}, lo: {} })).catch(() => {});
            }
        }
        kovetesUIFrissit();
    }

    function kovetettE(tipus, id) { return !!(id && kovetesek[tipus] && kovetesek[tipus][sanitizeKey(String(id))]); }

    function kovetesValt(tipus, id) {
        const kulcs = sanitizeKey(String(id || ''));
        if (!kulcs) return;
        const most = !kovetettE(tipus, id);
        const nev = tipus === 'lovas' ? ((ridersCache[kulcs] || {}).name || id) : ((horsesCache[kulcs] || {}).name || id);
        if (most) kovetesek[tipus][kulcs] = Date.now(); else delete kovetesek[tipus][kulcs];
        const u = auth.currentUser;
        const kesz = () => {
            showToast(most ? `⭐ Követed: ${nev}` : `Követés vége: ${nev}`);
            kovetesUIFrissit();
        };
        if (u) {
            db.ref('users/' + u.uid + '/kovetes/' + tipus + '/' + kulcs).set(most ? Date.now() : null).then(kesz)
                .catch(e => { showToast('Nem sikerült menteni: ' + e.message, true); });
        } else {
            kovetesHelyiIr(kovetesek);
            kesz();
            if (most && !localStorage.getItem('rps-kovetes-tipp')) {
                try { localStorage.setItem('rps-kovetes-tipp', '1'); } catch (e) {}
                setTimeout(() => showToast('Tipp: lépj be, és a követéseid minden eszközödön megmaradnak.'), 2600);
            }
        }
    }

    function kovetettLista() {
        const lista = [];
        Object.keys(kovetesek.lovas).forEach(id => lista.push({ tipus: 'lovas', id, nev: (ridersCache[id] || {}).name || id }));
        Object.keys(kovetesek.lo).forEach(id => lista.push({ tipus: 'lo', id, nev: (horsesCache[id] || {}).name || id }));
        return lista.sort((a, b) => a.nev.localeCompare(b.nev, 'hu'));
    }

    function kovetesGombHtml(tipus, id) {
        if (!id) return '';
        const be = kovetettE(tipus, id);
        return `<button type="button" class="kovetes-gomb ${be ? 'aktiv' : ''}" onclick="event.stopPropagation(); kovetesValt('${tipus}', '${escapeHtml(String(id))}')">${be ? '★ Követed' : '☆ Követés'}</button>`;
    }

    // A követett versenyző az élő versenyen (a lovasa vagy a lova követett)
    function kovetettVersenyzoE(c) { return kovetettE('lovas', c.license) || kovetettE('lo', c.startNum); }

    function kovetesUIFrissit() {
        // A frissen követett versenyző mostani állapota legyen a kiindulás - különben az első
        // eseménye (pl. a következő beérkezése) kimaradna az értesítésből.
        kovetesEsemenyek(true);
        if (document.getElementById('adatlapModal')?.style.display === 'flex') {
            if (document.querySelector('#modalBody .profil')) renderProfil();
            else if (typeof refreshOpenModalIfNeeded === 'function') refreshOpenModalIfNeeded();
        }
        if (document.getElementById('fiokModal')?.style.display === 'flex') renderFiok();
        if (document.getElementById('kezdolap')?.classList.contains('active')) renderKezdolap();
        if (document.getElementById('adatlapok')?.classList.contains('active') && !viewingPastRaceData) renderAdatlapList();
    }

    // --- Értesítések a követettekről (amíg az oldal nyitva van) ---
    const ERTESITES_KULCS = 'rps-ertesites';
    function ertesitesBekapcsolva() {
        try { return localStorage.getItem(ERTESITES_KULCS) === '1' && typeof Notification !== 'undefined' && Notification.permission === 'granted'; }
        catch (e) { return false; }
    }
    function ertesitesValt(be) {
        if (!be) { try { localStorage.removeItem(ERTESITES_KULCS); } catch (e) {} renderFiok(); return; }
        if (typeof Notification === 'undefined') return;
        Notification.requestPermission().then(eng => {
            if (eng === 'granted') {
                try { localStorage.setItem(ERTESITES_KULCS, '1'); } catch (e) {}
                rendszerErtesites('🔔 Értesítések bekapcsolva', 'Szólunk, ha egy követett versenyződ beér, vizsgálaton megy át vagy célba ér.', 'proba');
            } else {
                showToast('Az értesítést a böngészőben engedélyezni kell.', true);
            }
            renderFiok();
        });
    }
    function rendszerErtesites(cim, szoveg, tag) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const opts = { body: szoveg, tag: tag || undefined, icon: 'kepek/ikon-192.png', badge: 'kepek/ikon-96.png', data: { url: location.href.split('#')[0] } };
        const sima = () => { try { new Notification(cim, opts); } catch (e) {} };
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => (reg ? reg.showNotification(cim, opts) : sima())).catch(sima);
        } else sima();
    }

    // Az élő verseny követett versenyzőinek eseményei: az előző állapothoz képest mi változott.
    let kovetesAllapot = null, kovetesVersenyId = null;
    // csakAlap: csak az állapotot jegyzi meg (követés be/ki), értesítés nélkül
    function kovetesEsemenyek(csakAlap = false) {
        if (!liveRaceMeta) { kovetesAllapot = null; kovetesVersenyId = null; return; }
        const versenyId = liveRaceMeta.id || liveRaceMeta.name || 'elo';
        const uj = {};
        competitors.forEach(c => {
            if (!kovetettVersenyzoE(c)) return;
            const korok = c.laps || [];
            uj[c.bib] = {
                erk: korok.filter(l => l && l.arrSec > 0).length,
                vet: korok.filter(l => l && l.vetSec > 0).length,
                kiesett: !!c.isEliminated,
                cel: teljesitetteE(c, raceConfig)
            };
        });
        if (!csakAlap && kovetesAllapot && kovetesVersenyId === versenyId) {
            let rangok = null;
            competitors.forEach(c => {
                const most = uj[c.bib], elozo = kovetesAllapot[c.bib];
                if (!most || !elozo) return;
                const nev = c.name + (c.internal ? ' · ' + c.internal : '');
                const tav = catNames[c.dist] || c.dist;
                if (most.kiesett && !elozo.kiesett) {
                    kovetesErtesit('❌ ' + nev, getElimText(c) + ' · ' + tav, c);
                } else if (most.cel && !elozo.cel) {
                    rangok = rangok || calculateCurrentRanks(competitors, raceConfig);
                    const r = rangok[c.bib];
                    kovetesErtesit('🏁 ' + nev + ' célba ért', (r && typeof r.rank === 'number' ? r.rank + '. hely · ' : '') + tav, c);
                } else if (most.vet > elozo.vet) {
                    kovetesErtesit('🩺 ' + nev, most.vet + '. vizsgálat: megfelelt · ' + tav, c);
                } else if (most.erk > elozo.erk) {
                    const l = (c.laps || [])[most.erk - 1];
                    kovetesErtesit('⏱️ ' + nev, `Beérkezett a(z) ${most.erk}. körből${l && l.loopSpd ? ' · ' + kmh(l.loopSpd) + ' km/h' : ''} · ${tav}`, c);
                }
            });
        }
        kovetesAllapot = uj;
        kovetesVersenyId = versenyId;
    }
    function kovetesErtesit(cim, szoveg, c) {
        showToast(cim + ' – ' + szoveg);
        if (document.hidden && ertesitesBekapcsolva()) rendszerErtesites(cim, szoveg, 'kovetes-' + c.bib);
    }

    // --- Szurkolás: élő versenyen egy versenyzőnek fiókonként egy taps (szurkolas/{verseny}/{rajtszám}/{uid}) ---
    let szurkolasAdat = {}, szurkolasRef = null, szurkolasVersenyId = null;
    function szurkolasFigyeles() {
        const id = liveRaceMeta && liveRaceMeta.id ? sanitizeKey(String(liveRaceMeta.id)) : null;
        if (id === szurkolasVersenyId) return;
        if (szurkolasRef) szurkolasRef.off();
        szurkolasRef = null; szurkolasVersenyId = id; szurkolasAdat = {};
        if (!id) return;
        szurkolasRef = db.ref('szurkolas/' + id);
        szurkolasRef.on('value', s => { szurkolasAdat = s.val() || {}; szurkolasUIFrissit(); }, () => {});
    }
    function szurkolasSzam(bib) { const x = szurkolasAdat[sanitizeKey(String(bib))]; return x ? Object.keys(x).length : 0; }
    function szurkoltamE(bib) {
        const u = auth.currentUser;
        const x = szurkolasAdat[sanitizeKey(String(bib))];
        return !!(u && x && x[u.uid]);
    }
    function szurkolas(bib) {
        const u = auth.currentUser;
        if (!u) { fiokMegnyit('belepes', 'A szurkoláshoz lépj be - Google-fiókkal egy kattintás.'); return; }
        if (!szurkolasVersenyId) return;
        const ref = db.ref('szurkolas/' + szurkolasVersenyId + '/' + sanitizeKey(String(bib)) + '/' + u.uid);
        const most = !szurkoltamE(bib);
        (most ? ref.set(Date.now()) : ref.remove())
            .then(() => { if (most) showToast('👏 Szurkolsz neki!'); })
            .catch(e => showToast('Nem sikerült: ' + (e.code === 'PERMISSION_DENIED' ? 'a szurkolás még nincs engedélyezve az adatbázisban (admin: szabályok frissítése)' : e.message), true));
    }
    function szurkolasGombHtml(bib, kicsi) {
        if (!szurkolasVersenyId) return '';
        const en = szurkoltamE(bib);
        return `<button type="button" class="szurkolas-gomb ${en ? 'aktiv' : ''} ${kicsi ? 'kicsi' : ''}" data-szurk-bib="${escapeHtml(String(bib))}" title="${en ? 'Szurkolsz neki - kattints a visszavonáshoz' : 'Szurkolok!'}" onclick="event.stopPropagation(); szurkolas('${escapeHtml(String(bib))}')">👏 <span>${szurkolasSzam(bib)}</span></button>`;
    }
    // Új taps esetén nem rajzolunk újra mindent, csak a számlálók frissülnek
    function szurkolasUIFrissit() {
        document.querySelectorAll('.szurkolas-gomb[data-szurk-bib]').forEach(g => {
            const bib = g.dataset.szurkBib;
            const en = szurkoltamE(bib);
            g.classList.toggle('aktiv', en);
            g.title = en ? 'Szurkolsz neki - kattints a visszavonáshoz' : 'Szurkolok!';
            const s = g.querySelector('span');
            if (s) s.textContent = szurkolasSzam(bib);
        });
    }

    // ============================================================================
    // FELHASZNÁLÓK (csak admin): ki regisztrált, szerepkör és menünkénti jogok
    // ============================================================================
    let felhasznalokAdat = {}, felhasznalokRef = null, felhSzuro = 'mind';
    function felhasznalokFigyeles(be) {
        if (be && !felhasznalokRef && adminE()) {
            felhasznalokRef = db.ref('users');
            felhasznalokRef.on('value', s => { felhasznalokAdat = s.val() || {}; renderFelhasznalok(); },
                e => { document.getElementById('felh-lista').innerHTML = `<p class="field-hint">Nem olvasható: ${escapeHtml(e.message)}</p>`; });
        } else if (!be && felhasznalokRef) {
            felhasznalokRef.off(); felhasznalokRef = null;
        }
    }
    function felhSzuroValt(sz) { felhSzuro = sz; renderFelhasznalok(); }

    function datumIdo(ms) {
        if (!ms) return '–';
        const d = new Date(ms);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function renderFelhasznalok() {
        const cont = document.getElementById('felh-lista');
        if (!cont) return;
        // Más felhasználó belépése is frissíti a listát (utolsó belépés) - a nyitott kártyák és a
        // még el nem mentett szerepkör/pipák ne vesszenek el közben.
        const nyitva = new Set([...cont.querySelectorAll('.felh-kartya[open]')].map(k => k.dataset.uid));
        const fuggo = {};
        cont.querySelectorAll('.felh-kartya').forEach(k => {
            const g = k.querySelector('.felh-mentes');
            if (g && !g.disabled) fuggo[k.dataset.uid] = { role: k.querySelector('.felh-szerepkor').value, jogok: [...k.querySelectorAll('input[data-jog]')].filter(i => i.checked).map(i => i.dataset.jog) };
        });
        const keres = (document.getElementById('felh-kereso')?.value || '').trim().toLowerCase();
        const sajat = auth.currentUser && auth.currentUser.uid;
        const lista = Object.entries(felhasznalokAdat).map(([uid, a]) => ({ uid, a: a || {}, p: (a && a.profil) || {} }));
        const stab = lista.filter(x => x.a.role);
        const db_ = { mind: lista.length, stab: stab.length, nezo: lista.length - stab.length };
        document.getElementById('felh-szurok').innerHTML = [['mind', 'Mind'], ['stab', 'Stáb'], ['nezo', 'Nézők']]
            .map(([k, c]) => `<button class="tab-btn ${felhSzuro === k ? 'active' : ''}" onclick="felhSzuroValt('${k}')">${c} <small>${db_[k]}</small></button>`).join('');

        const szurt = lista.filter(x => felhSzuro === 'mind' || (felhSzuro === 'stab' ? x.a.role : !x.a.role))
            .filter(x => !keres || [x.p.nev, x.p.email, x.uid].some(s => String(s || '').toLowerCase().includes(keres)))
            .sort((x, y) => (!!y.a.role - !!x.a.role) || ((y.p.utolsoBelepes || 0) - (x.p.utolsoBelepes || 0)));
        if (!szurt.length) { cont.innerHTML = '<p class="field-hint" style="text-align:center; padding:20px 0;">Nincs találat.</p>'; return; }

        cont.innerHTML = szurt.map(({ uid, a, p }) => {
            const role = a.role || '';
            const jogok = jogokSzamit(role, a.jogok);
            const regi = /@verseny\.hu$/i.test(p.email || '');
            const nev = p.nev || (p.email ? p.email.split('@')[0] : '') || 'Névtelen fiók';
            const en = uid === sajat;
            const csoportok = [...new Set(JOG_LISTA.map(j => j.csoport))];
            const jogHtml = csoportok.map(cs => `<div class="felh-jogcsoport"><b>${escapeHtml(cs)}</b>${JOG_LISTA.filter(j => j.csoport === cs).map(j =>
                `<label><input type="checkbox" data-jog="${j.kulcs}" ${jogok.has(j.kulcs) ? 'checked' : ''} ${!role || role === 'admin' ? 'disabled' : ''} onchange="felhValtozott('${uid}')"> ${escapeHtml(j.cimke)}</label>`).join('')}</div>`).join('');
            return `<details class="felh-kartya ${role ? 'stab' : ''}" data-uid="${escapeHtml(uid)}">
                <summary>
                    ${fiokAvatarHtml(null, p.foto ? p : { nev })}
                    <span class="felh-nev"><b>${escapeHtml(nev)}${en ? ' (te)' : ''}</b>
                        <small>${p.email ? escapeHtml(regi ? 'stábfiók: ' + p.email.split('@')[0] : p.email) : 'régi fiók – a neve a következő belépésekor jelenik meg'}${p.szolgaltato === 'google.com' ? ' · Google' : ''}</small></span>
                    <span class="felh-szerep ${role ? 'stab' : ''}">${escapeHtml(szerepNev(role || 'guest'))}</span>
                </summary>
                <div class="felh-reszlet">
                    <p class="field-hint" style="margin-top:0;">Regisztrált: ${datumIdo(p.letrehozva)} · utoljára belépett: ${datumIdo(p.utolsoBelepes)}</p>
                    <label>Szerepkör</label>
                    <select class="felh-szerepkor" ${en ? 'disabled' : ''} onchange="felhSzerepValt('${uid}', this.value)">
                        ${SZEREPKOROK.map(s => `<option value="${s.kulcs}" ${s.kulcs === role ? 'selected' : ''}>${escapeHtml(s.cimke)}</option>`).join('')}
                    </select>
                    ${en ? '<p class="field-hint">A saját szerepkörödet nem módosíthatod (nehogy kizárd magad).</p>' : ''}
                    <div class="felh-jogok ${!role || role === 'admin' ? 'tiltott' : ''}">${jogHtml}</div>
                    <p class="field-hint">${role === 'admin' ? 'Az admin mindent lát és kezel.' : !role ? 'Szerepkör nélkül néző: semmit nem írhat az adatbázisba.' : 'A szerepkör adja az alapot, a pipákkal menünként szűkítheted vagy bővítheted.'}</p>
                    <div class="felh-gombok"><button class="calc-btn add-btn felh-mentes" disabled onclick="felhMentes('${uid}')">Mentés</button></div>
                </div>
            </details>`;
        }).join('');
        cont.querySelectorAll('.felh-kartya').forEach(k => {
            const uid = k.dataset.uid;
            if (nyitva.has(uid)) k.open = true;
            const f = fuggo[uid];
            if (!f) return;
            k.open = true;
            k.querySelector('.felh-szerepkor').value = f.role;
            k.querySelectorAll('input[data-jog]').forEach(i => { i.checked = f.jogok.includes(i.dataset.jog); i.disabled = !f.role || f.role === 'admin'; });
            k.querySelector('.felh-jogok').classList.toggle('tiltott', !f.role || f.role === 'admin');
            k.querySelector('.felh-mentes').disabled = false;
        });
    }

    function felhKartya(uid) { return document.querySelector(`.felh-kartya[data-uid="${CSS.escape(uid)}"]`); }
    function felhValtozott(uid) { const k = felhKartya(uid); if (k) k.querySelector('.felh-mentes').disabled = false; }
    function felhSzerepValt(uid, role) {
        const k = felhKartya(uid);
        if (!k) return;
        const alap = jogokSzamit(role, null);
        k.querySelectorAll('input[data-jog]').forEach(i => { i.checked = alap.has(i.dataset.jog); i.disabled = !role || role === 'admin'; });
        k.querySelector('.felh-jogok').classList.toggle('tiltott', !role || role === 'admin');
        felhValtozott(uid);
    }
    function felhMentes(uid) {
        const k = felhKartya(uid);
        if (!k) return;
        if (auth.currentUser && uid === auth.currentUser.uid) return;
        const role = k.querySelector('.felh-szerepkor').value;
        const jelolt = [...k.querySelectorAll('input[data-jog]')].filter(i => i.checked).map(i => i.dataset.jog);
        const alap = [...jogokSzamit(role, null)].sort().join(',');
        // Ha a pipák a szerepkör alapjával egyeznek, nem tároljuk külön (így egy későbbi alapváltozás is érvényes lesz)
        const jogok = (!role || role === 'admin' || jelolt.slice().sort().join(',') === alap) ? null : Object.fromEntries(jelolt.map(j => [j, true]));
        // Szerepkör nélkül a role kulcsnak NEM szabad léteznie (a szabályok a meglétét nézik az íráshoz)
        db.ref('users/' + uid).update({ role: role || null, jogok })
            .then(() => showToast('Mentve: ' + (felhasznalokAdat[uid]?.profil?.nev || uid) + ' – ' + szerepNev(role || 'guest')))
            .catch(e => showToast('Hiba: ' + e.message, true));
    }

    function adatkezeloBetolt() {
        db.ref('settings/adatkezelo').once('value').then(s => {
            const a = s.val() || {};
            const n = document.getElementById('adatkezelo-nev'), e = document.getElementById('adatkezelo-email');
            // amíg valaki épp gépel benne, ne írjuk felül
            if (n && document.activeElement !== n) n.value = a.nev || '';
            if (e && document.activeElement !== e) e.value = a.email || '';
        }).catch(() => {});
    }
    function adatkezeloMentes() {
        const nev = document.getElementById('adatkezelo-nev').value.trim();
        const email = document.getElementById('adatkezelo-email').value.trim();
        db.ref('settings/adatkezelo').set({ nev: nev || null, email: email || null })
            .then(() => showToast('Az adatvédelmi tájékoztató adatai mentve.'))
            .catch(e => showToast('Hiba: ' + e.message, true));
    }

    function renderFelhasznalokOldal() {
        adatkezeloBetolt();
        felhasznalokFigyeles(true);
        renderFelhasznalok();
    }

    // ============================================================================
    // TELEPÍTHETŐ ALKALMAZÁS (PWA): a telefon kezdőképernyőjére tehető, saját ikonnal
    // ============================================================================
    let telepitesKeres = null;
    if (typeof window.addEventListener === 'function') {
        window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); telepitesKeres = e; });
        window.addEventListener('appinstalled', () => { telepitesKeres = null; showToast('Az End-Ride felkerült a kezdőképernyőre.'); });
    }
    function appTelepitve() { return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
    function appTelepithetoHtml() {
        if (appTelepitve()) return '';
        const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
        return `<div class="fiok-blokk">
            <h4>📲 End-Ride a telefonodon</h4>
            ${telepitesKeres ? `<button class="calc-btn" onclick="appTelepites()">Hozzáadás a kezdőképernyőhöz</button>`
                : `<p class="fiok-megj">${ios ? 'iPhone-on: Safari → Megosztás gomb → „Főképernyőhöz adás”.' : 'A böngésző menüjében: „Hozzáadás a kezdőképernyőhöz” vagy „Alkalmazás telepítése”.'} Így saját ikonnal, teljes képernyőn nyílik, mint egy app.</p>`}
        </div>`;
    }
    function appTelepites() {
        if (!telepitesKeres) return;
        telepitesKeres.prompt();
        telepitesKeres.userChoice.finally(() => { telepitesKeres = null; renderFiok(); });
    }
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && typeof window.addEventListener === 'function') {
        window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
    }

    function toggleMenu() {
        document.getElementById('sidebar').classList.toggle('open');
        document.querySelector('.overlay').classList.toggle('open');
    }

    // Ezekben a nézetekben széles, nem törhető ranglista-tábla van (.ttrack-table), ezért nagy
    // kijelzőn kitágul alattuk a hasáb. Mindenhol máshol az űrlapokhoz szabott keskeny hasáb
    // marad - egy input nem lesz szebb attól, ha 1300px széles (l. .szeles-nezet a CSS-ben).
    const SZELES_NEZETEK = ['bajnoksag-egyeni', 'bajnoksag-lo', 'bajnoksag-csapat', 'attekinto-mod', 'bajnoksag-teny'];

    function switchSidebarMode(targetId, btn) {
        // Jog nélkül (vagy kijelentkezve) belső nézetre nem lehet menni - pl. egy régi könyvjelzőből
        // vagy a localStorage-ban megjegyzett nézetből. Amíg a belépés állapota nem ismert, nem terelünk.
        if (authAllapotIsmert && !nezetEngedelyezett(targetId)) {
            targetId = 'kezdolap';
            btn = null;
        }
        if (targetId !== 'felhasznalok-mod') felhasznalokFigyeles(false);
        if(btn && btn.id === 'btn-menu-adatlapok') { viewingPastRaceData = null; }
        document.querySelectorAll('.mode-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.sidebar-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        document.body.classList.toggle('szeles-nezet', SZELES_NEZETEK.includes(targetId));
        if(btn) btn.classList.add('active');
        localStorage.setItem('currentMode', targetId); 
        if(window.innerWidth <= 800) { document.getElementById('sidebar').classList.remove('open'); document.querySelector('.overlay').classList.remove('open'); }
        
        if (targetId === 'adatlapok') renderAdatlapList();
        if (targetId === 'elo-rajtok') frissitEloKiindulasok();
        if (targetId === 'attekinto-mod') renderAttekinto();
        if (targetId === 'rfid-mod') { renderRfidKapuk(); rfidOraIndit(); }
        if (targetId === 'nezok-mod') renderNezok();
        if (targetId === 'export-mod') renderExportList();
        if (targetId === 'torzs-lovasok') renderTorzsLovasokList();
        if (targetId === 'torzs-lovak') renderTorzsLovakList();
        if (targetId === 'bajnoksag-egyeni') renderEgyeniBajnoksag();
        if (targetId === 'bajnoksag-lo') renderLoRanglista();
        if (targetId === 'bajnoksag-teny') renderEvTenyesztoje();
        if (targetId === 'kezdolap') renderKezdolap();
        if (targetId === 'nyomtatvanyok-mod') renderNyomtatvanyok();
        if (targetId === 'felhasznalok-mod') renderFelhasznalokOldal();
        if (targetId === 'fo-mod') foModFulJogSzerint();
        if (targetId === 'bajnoksag-csapat') switchCsapatTab('csapat-rang', document.querySelector('#bajnoksag-csapat .tabs .tab-btn'));
        ujNavFrissit();
    }

    function switchMainTab(targetId, btn) { switchSidebarMode(targetId, btn || document.getElementById('btn-menu-fomod')); }

    function switchSubMode(mode, btn) {
        document.querySelectorAll('.sub-mode-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#fo-mod .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(mode).style.display = 'block';
        btn.classList.add('active');

        if (mode === 'verseny') {
            const selectedBib = document.getElementById('selectCompetitor').value;
            if (selectedBib && !isFormDirty('verseny-form-container')) {
                loadCompetitorData();
            }
        }
    }

    function refreshVersenyTabIfNeeded(bib) {
        const versenyTab = document.getElementById('verseny');
        if (!versenyTab || versenyTab.style.display !== 'block') return;
        const selectedBib = document.getElementById('selectCompetitor').value;
        if (!selectedBib || selectedBib !== bib) return;
        if (!isFormDirty('verseny-form-container')) {
            loadCompetitorData();
        }
    }

    function switchVersenyekTab(tabId, btn) {
        document.querySelectorAll('.verseny-tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#versenyek .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).style.display = 'block';
        if(btn) btn.classList.add('active');
    }

    // --- INFÓ MODAL (Körök / Részletek) ---
    function showCatInfo(dist, isPast = false) {
        const config = isPast ? mergeRaceConfig(viewingPastRaceData.raceConfig) : raceConfig;
        const baseDist = dist.replace('j', '');
        const catConf = config[baseDist];
        if(!catConf) return;
        
        document.getElementById('infoModalTitle').innerText = catNames[dist] + " Információk";
        let html = `<strong>Kategória rajtja:</strong><br><span style="font-size:1.5rem; color:var(--text); font-family:monospace;">${toTimeStr(toSec(catConf.h, catConf.m, catConf.s))}</span><br><br><strong>Körök távolságai:</strong><br><div style="display:inline-block; text-align:left; margin-top:5px;">`;
        if(catConf.laps && catConf.laps.length > 0) {
            catConf.laps.forEach((l, i) => {
                const piheno = i < catConf.laps.length - 1 ? ` <small style="color:var(--text-dim);">· utána ${String(getPihenoPerc(catConf, dist, i)).replace('.', ',')} perc pihenő</small>` : '';
                html += `<b>${i+1}. kör:</b> &nbsp;&nbsp;${l || '0'} km${piheno}<br>`;
            });
        } else {
            html += `Nincsenek körök beállítva.`;
        }
        html += `</div>`;
        document.getElementById('infoModalBody').innerHTML = html;
        document.getElementById('infoModal').style.display = 'flex';
    }

    function showFutureInfo(id) {
        const r = localRaces.jovo.find(x => x.id === id);
        if(!r) return;
        document.getElementById('infoModalTitle').innerText = r.name;
        let html = `<strong>Dátum:</strong> <span style="color:var(--text);">${r.date}</span><br><strong>Helyszín:</strong> <span style="color:var(--text);">${r.loc}</span><br><br><strong>Leírás:</strong><br><span style="color:var(--text);">${r.desc || 'Nincs leírás megadva.'}</span><br><br><strong>Kategóriák és Rajtidők:</strong><br><div style="text-align:left; display:inline-block; margin-top:5px;">`;
        
        const cfg = mergeRaceConfig(r.raceConfig);
        let hasCats = false;
        DIST_ORDER.forEach(d => {
            if(cfg[d] && cfg[d].h !== "") {
                html += `• ${catNames[d]}: <b style="color:var(--text);">${toTimeStr(toSec(cfg[d].h, cfg[d].m, cfg[d].s))}</b> <small>(${(cfg[d].laps||[]).length} kör)</small><br>`;
                hasCats = true;
            }
        });
        if(!hasCats) html += `<span style="color:var(--danger)">Még nincsenek távok kiírva.</span>`;
        html += `</div>`;
        document.getElementById('infoModalBody').innerHTML = html;
        document.getElementById('infoModal').style.display = 'flex';
    }

    // --- EXPORTÁLÁS MODUL ---
    function renderExportList() {
        const cont = document.getElementById('export-list-container');
        if (!cont) return;
        cont.innerHTML = '';
        
        if (localRaces.mult.length === 0) {
            cont.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Nincs múltbéli verseny rögzítve az exportáláshoz.</div>';
            return;
        }

        localRaces.mult.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach(r => {
            cont.innerHTML += `
            <!-- A #217346 az Excel márkaszíne, szándékosan fix - itt a kártya felső csíkja lesz. -->
            <div class="race-card" style="--status-color:#217346;">
                <div class="race-card-head">
                    <div class="race-card-title">${escapeHtml(r.name || 'Névtelen verseny')}</div>
                </div>
                <div class="race-card-meta">
                    ${r.date ? `<span>📅 <b>${escapeHtml(r.date)}</b></span>` : ''}
                    ${r.loc ? `<span>📍 <b>${escapeHtml(r.loc)}</b></span>` : ''}
                </div>
                <div class="race-card-foot">
                    <span class="race-entries"><b>${parseCompetitors(r.competitors).length}</b> nevezés</span>
                    <button class="calc-btn" style="background:#217346; color:#fff; border-color:#217346;" onclick="exportSpecificRaceToCSV('${r.id}')">📥 Letöltés Excelbe</button>
                </div>
            </div>`;
        });
    }

    // --- PIHENŐNAPOK (kötelező versenymentes időszak, 140. §) ---
    // Alap a ténylegesen megtett táv szerint: 54 km-ig 5, 106 km-ig 12, 126 km-ig 19, 146 km-ig 26,
    // fölötte 33 nap. Kiegészítő napok (140. § (2)): 20 km/h feletti átlag +7; második metabolikus
    // kiesés egy göngyölített éven belül +14, harmadik vagy további +60; harmadik vagy további
    // sántaság miatti kiesés +180; súlyos mozgásszervi sérülés +180, súlyos metabolikus +60.
    // Aki el sem indult (WD/DNS rajt előtt, vagy az előzetes vizsgálaton nem felelt meg): 0.
    function pihenoAlapNap(km) {
        if (km > 146) return 33;
        if (km > 126) return 26;
        if (km > 106) return 19;
        if (km > 54) return 12;
        return 5;
    }

    // A kiesési kódok egy versenyzőnél: a státusz + a kombinált kódok, egységes alakban (ME, GA, SIMUSCO...).
    function kiesesiKodok(c) {
        const st = String(c.status || '');
        const kodok = [st.replace(/^FTQ-/, ''), ...(c.extraCodes || [])];
        return new Set(kodok.map(k => String(k).replace(/\s+/g, '').toUpperCase()).filter(Boolean));
    }

    // Egy ló ME / GA kiesései a verseny előtti 365 napban (göngyölített év): a saját versenyeinkből
    // és - ha be van töltve - a szövetségi lóeredményekből (ott a kód szabad szöveg, pl. "GA 40km").
    // Ugyanazon a napon a saját adatunk az irányadó (ne számoljuk kétszer).
    function loKorabbiKiesesei(startNum, datum, kivevaRaceId, hivatalosSorok) {
        const eredmeny = { ME: 0, GA: 0 };
        if (!startNum || !datum) return eredmeny;
        const d0 = new Date(datum + 'T00:00:00'); d0.setDate(d0.getDate() - 365);
        const tol = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
        const sajatNapok = new Set();
        localRaces.mult.forEach(r => {
            if (!r.date || r.id === kivevaRaceId || r.date < tol || r.date >= datum) return;
            parseCompetitors(r.competitors).forEach(c => {
                if (String(c.startNum || '').trim() !== String(startNum)) return;
                sajatNapok.add(r.date);
                if (!c.isEliminated) return;
                const k = kiesesiKodok(c);
                if (k.has('ME') || k.has('SIMETA')) eredmeny.ME++;
                if (k.has('GA')) eredmeny.GA++;
            });
        });
        (hivatalosSorok || []).forEach(e => {
            const nap = String(e.date || '').replace(/\//g, '-');
            if (!nap || nap < tol || nap >= datum || sajatNapok.has(nap) || !e.status) return;
            const szoveg = String(e.penalty || '').toUpperCase();
            if (/\bME\b/.test(szoveg)) eredmeny.ME++;
            if (/\bGA\b/.test(szoveg)) eredmeny.GA++;
        });
        return eredmeny;
    }

    function pihenonapok(c, config, elozmeny) {
        const st = c.status || (c.isEliminated ? 'FTQ-ME' : 'Active');
        const laps = (c.laps || []).filter(Boolean);
        const lovagolt = laps.some(l => l.h || l.isComplete);
        const preVetBukott = !lovagolt && c.preVet && c.preVet.vetDecision && !/Továbbengedve|Passed|Active/i.test(c.preVet.vetDecision);
        const elindult = c.manualEntry
            ? !['WD', 'DNS'].includes(st)
            : (lovagolt || st === 'RET' || (c.isEliminated && !['WD', 'DNS'].includes(st) && !preVetBukott));
        if (!elindult) return 0;

        const nevleges = parseInt(String(c.dist || '').replace('j', ''), 10) || 0;
        // Gyors eredménynél nincs kör-adat: kiesettnél a megtett táv nem ismert, ilyenkor a legkisebb sáv.
        const km = c.manualEntry ? (c.isEliminated ? 0 : nevleges) : getCompletedKm(c, config);
        let nap = pihenoAlapNap(km);

        let atlag = 0;
        if (c.manualEntry) atlag = (c.totalTimeSec > 0 && km > 0) ? km / (c.totalTimeSec / 3600) : 0;
        else { const kesz = laps.filter(l => l.isComplete); const ut = kesz[kesz.length - 1]; atlag = ut ? (ut.rideSpd || 0) : 0; }
        if (atlag > 20) nap += 7;

        const kodok = kiesesiKodok(c);
        if (kodok.has('SIMUSCO')) nap += 180;
        if (kodok.has('SIMETA')) nap += 60;
        const e = elozmeny || { ME: 0, GA: 0 };
        if (c.isEliminated && kodok.has('ME')) nap += e.ME >= 2 ? 60 : (e.ME === 1 ? 14 : 0);
        if (c.isEliminated && kodok.has('GA') && e.GA >= 2) nap += 180;
        return nap;
    }

    function idoHhMmSs(sec) {
        if (!(sec > 0)) return '-';
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Az ExcelJS csak exportkor töltődik be (kb. 1 MB) - a versenyzők telefonján nem kell.
    let exceljsIgeret = null;
    function exceljsBetolt() {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (!exceljsIgeret) {
            exceljsIgeret = new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
                s.onload = () => window.ExcelJS ? res(window.ExcelJS) : rej(new Error('Az Excel-modul nem töltődött be.'));
                s.onerror = () => { exceljsIgeret = null; rej(new Error('Nem sikerült letölteni az Excel-modult (van internet?).')); };
                document.head.appendChild(s);
            });
        }
        return exceljsIgeret;
    }

    // Egy verseny eredménylistájának sorai (kategóriánként) - az Excel exporthoz, és a tesztekhez.
    function exportSorok(race, hivatalos = {}) {
        const comps = parseCompetitors(race.competitors);
        const config = mergeRaceConfig(race.raceConfig);
        const ranksInfo = calculateCurrentRanks(comps, config);
        return getActiveCategories(comps, config).map(cat => ({
            cat,
            cim: `${cat.replace('j', '')} km-es ${cat.endsWith('j') ? 'junior ' : ''}verseny`,
            sorok: comps.filter(c => c.dist === cat).sort(eredmenyRendezo(ranksInfo)).map(c => {
                const rInfo = ranksInfo[c.bib] || { rank: '-' };
                const kiesett = c.isEliminated;
                const fnr = !kiesett && c.status === 'FNR';
                const kesz = (c.laps || []).filter(l => l && l.isComplete);
                let ido = '-';
                if (!kiesett) {
                    if (c.manualEntry) ido = idoHhMmSs(c.totalTimeSec);
                    else if (kesz.length) {
                        const ut = kesz[kesz.length - 1];
                        ido = idoHhMmSs((c.dist === '20' || c.dist === '20j') && ut.vetSec > 0 ? ut.loopSec + ut.pulzusSec : ut.rideTime);
                    }
                } else {
                    ido = getElimText(c);
                }
                let megj = '0';
                if (fnr) megj = 'FNR';
                else if (kiesett) {
                    if (c.status && c.status.startsWith('FTQ-')) megj = c.status.replace('FTQ-', '');
                    else if (['WD', 'RET', 'DSQ'].includes(c.status)) megj = c.status;
                    else if (['Visszalépett', 'Retired', 'DNS'].includes(c.status)) megj = 'WD';
                    else megj = 'ELIM';
                    if ((c.extraCodes || []).length) megj += ' + ' + c.extraCodes.join(' + ');
                    const megjegyzes = (c.laps || []).slice().reverse().find(l => l && l.vetNotes);
                    if (megjegyzes) megj += ' (' + megjegyzes.vetNotes + ')';
                }
                let kategoria = 'Nyitott';
                if (cat.includes('j')) kategoria = 'Junior';
                else if (parseInt(cat, 10) >= 80) kategoria = 'Felnőtt';
                const sn = String(c.startNum || '').trim();
                return {
                    bib: String(c.bib), license: c.license || '', name: c.name || '', startNum: c.startNum || '',
                    horse: c.internal || '', club: c.club || '', kategoria,
                    // Hely: helyezettnél szám, kiesettnél és FNR-nél "-" (a hivatalos lista így kéri).
                    hely: (kiesett || fnr || typeof rInfo.rank !== 'number') ? '-' : rInfo.rank,
                    ido, buntetes: 0, megj, sargalap: '',
                    pihenonap: pihenonapok(c, config, loKorabbiKiesesei(sn, race.date, race.id, hivatalos[sn]))
                };
            })
        }));
    }

    // A tavlovasok.hu eredménylista-formátuma VALÓDI .xlsx fájlban. Korábban egy .xls kiterjesztésű
    // HTML ment ki: gépen az Excel "a fájl formátuma és kiterjesztése nem egyezik" üzenetet adott,
    // telefonon meg sem nyílt.
    async function exportSpecificRaceToCSV(id, megerositve = false) {
        const race = localRaces.mult.find(x => x.id === id);
        if(!race) { showToast("A verseny nem található!", true); return; }
        const comps = parseCompetitors(race.competitors);
        if(!comps.length) { showToast("Nincs exportálható adat ebben a versenyben!", true); return; }
        const figyelmeztetes = befejezetlenFigyelmeztetes(comps, mergeRaceConfig(race.raceConfig), 'a hivatalos listában is');
        if (figyelmeztetes && !megerositve) {
            showConfirm("Befejezetlen versenyzők", "Exportálod így is?" + figyelmeztetes, () => exportSpecificRaceToCSV(id, true));
            return;
        }

        showToast("Excel készítése...");
        let ExcelJS;
        try { ExcelJS = await exceljsBetolt(); }
        catch (e) { showToast(e.message, true); return; }

        // A lovak szövetségi eredményei a göngyölített éves kiesés-számításhoz (pihenőnap-pótlék).
        const startszamok = [...new Set(comps.map(c => String(c.startNum || '').trim()).filter(Boolean))];
        const hivatalos = {};
        await Promise.all(startszamok.map(sn => db.ref('horseResults/' + sanitizeKey(sn)).once('value')
            .then(snap => { const v = snap.val() || []; hivatalos[sn] = (Array.isArray(v) ? v : Object.values(v)).filter(Boolean); })
            .catch(() => { hivatalos[sn] = []; })));

        const raceName = race.name || "Eredmenyek";
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Távlovas versenyrendszer';
        wb.created = new Date();
        const ws = wb.addWorksheet('Eredmények', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
        const fejlec = ['Rajtszám', 'Igazolási szám', 'Versenyző', 'Ló Startszám', 'Ló', 'Egyesület', 'Kategória', 'Hely', 'Végeredmény (Idő)', 'Büntetőpont', 'Megj. (Kiesés)', 'Sárgalap', 'Pihenőnap'];
        ws.columns = [9, 14, 28, 12, 26, 26, 11, 7, 22, 11, 22, 9, 10].map(w => ({ width: w }));
        const keret = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        exportSorok(race, hivatalos).forEach((blokk, index) => {
            const cim = ws.addRow([raceName]); cim.font = { bold: true, size: 14 };
            const vrsz = ws.addRow([`${index + 1}.vrsz.-${blokk.cim}`]); vrsz.font = { bold: true, size: 12 };
            ws.addRow([]);
            ws.addRow(['www.tavlovasok.hu']);
            ws.addRow(['Elbírálás: Távlovaglás']);
            ws.addRow([]); ws.addRow([]);
            const fej = ws.addRow(fejlec);
            fej.eachCell(cell => {
                cell.font = { bold: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D2E9' } };
                cell.border = keret;
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            });
            blokk.sorok.forEach(s => {
                const sor = ws.addRow([s.bib, s.license, s.name, s.startNum, s.horse, s.club, s.kategoria, s.hely, s.ido, s.buntetes, s.megj, s.sargalap, s.pihenonap]);
                sor.eachCell({ includeEmpty: true }, (cell, col) => {
                    cell.border = keret;
                    cell.alignment = { vertical: 'middle', horizontal: [3, 5, 6, 11].includes(col) ? 'left' : 'center', wrapText: col === 11 };
                    if (col === 1 || col === 9) cell.font = { bold: true };
                });
            });
            ws.addRow([]); ws.addRow([]);
        });

        try {
            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = raceName.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') + '_Hivatalos_Eredmenyek.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            showToast("Eredmények sikeresen exportálva!");
        } catch (e) {
            showToast("Hiba az Excel készítésekor: " + e.message, true);
        }
    }

    // --- LISTÁK (Múlt / Jövő / Jelenlegi) ---
    function obBadge(r) {
        // nowrap + inline-block: keskeny kijelzőn a kötőjelnél kettétört ("OB-" / "FORDULÓ").
        return r && r.isObRound !== false ? `<span style="background:var(--primary-dim); color:var(--primary); font-size:0.7rem; font-weight:800; padding:3px 9px; border-radius:20px; margin-left:8px; vertical-align:middle; white-space:nowrap; display:inline-block;">🏆 OB-FORDULÓ</span>` : '';
    }

    // --- TÖLTÉS-JELZÉS ----------------------------------------------------------
    // A Firebase-figyelők első pillanatában még minden lista üres. Enélkül a felület azt
    // állítaná, hogy "nincs verseny rögzítve", holott csak még nem érkezett meg az adat -
    // ezért addig a végleges elrendezés csontvázát mutatjuk. (Az állapotjelző a globálisok
    // között van deklarálva, mert a figyelők előbb futnak, mint ez a szakasz.)
    function betoltoSor(szoveg) {
        return `<div class="betolto-sor"><span class="spinner"></span>${escapeHtml(szoveg || 'Betöltés…')}</div>`;
    }

    function skeletonVersenyKartyak(db) {
        return Array.from({ length: db }, () => `<div class="skeleton" aria-hidden="true">
            <div class="skeleton-sor cim"></div>
            <div class="skeleton-sor meta"></div>
            <div class="skeleton-sor chip"></div>
        </div>`).join('');
    }

    function skeletonEredmenyKartyak(db) {
        return Array.from({ length: db }, () => `<div class="skeleton" aria-hidden="true">
            <div class="skeleton-sor cim"></div>
            <div class="skeleton-sor meta"></div>
        </div>`).join('');
    }

    // --- VERSENY-KÁRTYA: egy közös renderelő a három állapotra ------------------
    // A státusz (élő / következő / lezárult) adja a felső csík színét és a pill szövegét,
    // a gombokat pedig az opts-ban kapja - így a kártya szerkezete egy helyen van.
    // A "KÖVETKEZŐ" csak a legközelebbi jövőbeli versenyre kerül (opts.cimke), a többi "TERVEZETT".
    const RACE_STATUS = {
        live: { osztaly: 'is-live',   cimke: 'ÉLŐ' },
        jovo: { osztaly: 'is-future', cimke: 'TERVEZETT' },
        mult: { osztaly: 'is-past',   cimke: 'LEZÁRULT' }
    };

    const HONAP_ROVID = ['JAN', 'FEBR', 'MÁRC', 'ÁPR', 'MÁJ', 'JÚN', 'JÚL', 'AUG', 'SZEPT', 'OKT', 'NOV', 'DEC'];
    const HET_NAPJA = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

    // Távok nevezésszámmal (a junior a saját nevén, ha van ilyen nevező)
    function raceCardTavok(cfg, comps) {
        const kiirt = DIST_ORDER.filter(d => cfg[d] && cfg[d].h !== '');
        const nevezett = ALL_CATS.filter(d => comps.some(c => c.dist === d));
        const tavok = ALL_CATS.filter(d => nevezett.includes(d) || (kiirt.includes(d) && !d.endsWith('j')));
        if (!tavok.length) return '';
        return `<div class="rc-tavok">${tavok.map(d => {
            const db = comps.filter(c => c.dist === d).length;
            return `<div class="rc-tav${db ? '' : ' is-empty'}"><b>${escapeHtml(catNames[d] || d + ' km')}</b><span>${db ? db + ' nevező' : 'nincs nevező'}</span></div>`;
        }).join('')}</div>`;
    }

    // Lezárt versenynél: távonként a győztes, és hányan teljesítették / estek ki
    function raceCardEredmeny(comps, cfg) {
        if (!comps.length) return '';
        const ranks = calculateCurrentRanks(comps, cfg);
        const gyoztesek = getActiveCategories(comps, cfg).map(d => {
            const gy = comps.find(c => c.dist === d && ranks[c.bib] && ranks[c.bib].rank === 1);
            return gy ? `<div class="rc-gyoztes"><span class="rc-gy-tav">${escapeHtml(catNames[d] || d)}</span><span>🥇 <b>${escapeHtml(gy.name)}</b>${gy.internal ? ` <small>· ${escapeHtml(gy.internal)}</small>` : ''}</span></div>` : '';
        }).join('');
        const teljesitette = comps.filter(c => teljesitetteE(c, cfg)).length;
        const kiesett = comps.filter(c => c.isEliminated).length;
        return `${gyoztesek ? `<div class="rc-gyoztesek"><div class="rc-szekcio-cim">Győztesek</div>${gyoztesek}</div>` : ''}
            <div class="rc-osszeg"><span><b>${comps.length}</b> nevező</span><span class="ok"><b>${teljesitette}</b> teljesítette</span>${kiesett ? `<span class="ki"><b>${kiesett}</b> kiesett / visszalépett</span>` : ''}</div>`;
    }

    // --- Az ÚJ DIZÁJN versenykártyája ---
    function raceCardHTML(r, kind, opts = {}) {
        const st = RACE_STATUS[kind] || RACE_STATUS.mult;
        // Az élő futamnál a nevezők és a kiírás nem a verseny-objektumban vannak, hanem a
        // globális állapotban - ezért lehet felülírni az opts-ból.
        const comps = opts.comps || parseCompetitors(r.competitors);
        const cfg = mergeRaceConfig(opts.raceConfig || r.raceConfig);
        const d = r.date ? new Date(r.date + 'T00:00:00') : null;
        const ervenyes = d && !isNaN(d);

        let idoSzoveg = '';
        if (kind === 'live') idoSzoveg = '<span class="rc-most">● Most zajlik</span>';
        else if (kind === 'jovo' && ervenyes) {
            const hatra = napKulonbseg(napIso(new Date()), r.date);
            idoSzoveg = hatra > 1 ? `még ${hatra} nap` : hatra === 1 ? 'holnap' : hatra === 0 ? 'ma' : '';
        }
        const hely = [r.loc ? '📍 ' + escapeHtml(r.loc) : '', ervenyes ? HET_NAPJA[d.getDay()] : ''].filter(Boolean).join(' · ');

        return `<article class="race-card rc ${st.osztaly}">
            <div class="rc-fo">
                <div class="rc-datum">${ervenyes
                    ? `<span class="rc-nap">${d.getDate()}</span><span class="rc-ho">${HONAP_ROVID[d.getMonth()]}</span><span class="rc-ev">${d.getFullYear()}</span>`
                    : '<span class="rc-ho">?</span>'}</div>
                <div class="rc-info">
                    <div class="rc-felso"><span class="race-status">${opts.cimke || st.cimke}</span>${r.isObRound !== false ? '<span class="rc-ob">🏆 OB-forduló</span>' : ''}${idoSzoveg ? `<span class="rc-hatra">${idoSzoveg}</span>` : ''}</div>
                    <h4 class="rc-cim">${escapeHtml(r.name || 'Névtelen verseny')}</h4>
                    ${hely ? `<div class="rc-hely">${hely}</div>` : ''}
                </div>
            </div>
            ${raceCardTavok(cfg, comps)}
            ${kind === 'mult' ? raceCardEredmeny(comps, cfg) : (comps.length ? '' : '<div class="rc-osszeg"><span>Nincs még nevezés</span></div>')}
            ${opts.fooGomb ? `<div class="rc-akcio">${opts.fooGomb}</div>` : ''}
            ${opts.adminGombok ? `<details class="rc-admin admin-only"><summary>⚙️ Kezelés</summary><div class="race-admin-controls">${opts.adminGombok}</div></details>` : ''}
        </article>`;
    }

    // --- A4 NYOMTATVÁNYOK (külön oldal - a menüben csak útban voltak) ---
    function renderNyomtatvanyok() {
        const sel = document.getElementById('nyomtat-verseny');
        if (!sel) return;
        const elozo = sel.value;
        const opciok = (liveRaceMeta ? [`<option value="live">ÉLŐ: ${escapeHtml(liveRaceMeta.name || 'élő verseny')}</option>`] : [])
            .concat(localRaces.mult.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.date || '')} · ${escapeHtml(r.name || '')}</option>`));
        sel.innerHTML = opciok.join('') || '<option value="">Nincs verseny</option>';
        if (elozo && [...sel.options].some(o => o.value === elozo)) sel.value = elozo;
        const nincsElo = !liveRaceMeta;
        document.querySelectorAll('.nyomtatvany-elo').forEach(b => { b.disabled = nincsElo; });
        const jel = document.getElementById('nyomtat-elo-jelzes');
        if (jel) jel.textContent = nincsElo ? 'Jelenleg nincs élő verseny - a nevezési lista, a rajtlista és a QR plakát az élő versenyhez készül.' : `Élő verseny: ${liveRaceMeta.name || ''}`;
    }

    // Az eredménylista a kiválasztott versenyből (élő vagy múltbéli) - a nyomtató a getAdatlapContext()-et
    // használja, ezért arra az időre átállítjuk a "megnézett múltbéli versenyt", majd visszaállítjuk.
    function nyomtatEredmenylista() {
        const v = (document.getElementById('nyomtat-verseny') || {}).value;
        if (!v) { showToast('Válassz versenyt!', true); return; }
        const regi = viewingPastRaceData;
        viewingPastRaceData = v === 'live' ? null : (localRaces.mult.find(r => r.id === v) || null);
        try { printEredmenyLista(); } finally { viewingPastRaceData = regi; }
    }


    function renderLocalRaces() {
        if (document.getElementById('kezdolap')?.classList.contains('active')) setTimeout(renderKezdolap, 0);
        const multCont = document.getElementById('v-mult-list');
        const jovoCont = document.getElementById('v-jovo-list');
        const jelenCont = document.getElementById('v-jelen-list');
        if(!multCont || !jovoCont || !jelenCont) return;

        const uresVagySkeleton = (van, szoveg, dbSkeleton) => van ? ''
            : (betoltesAllapot.races ? `<div style="text-align:center; padding: 20px; color: var(--text-dim);">${szoveg}</div>`
                                     : skeletonVersenyKartyak(dbSkeleton));

        multCont.innerHTML = uresVagySkeleton(localRaces.mult.length > 0, 'Nincs múltbéli verseny rögzítve.', 3);
        jovoCont.innerHTML = uresVagySkeleton(localRaces.jovo.length > 0, 'Nincs jövőbeli verseny rögzítve.', 2);

        if(liveRaceMeta) {
            jelenCont.innerHTML = raceCardHTML(liveRaceMeta, 'live', {
                comps: competitors, raceConfig: raceConfig,
                fooGomb: `<button class="calc-btn add-btn admin-only" onclick="switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'))">Ugrás az ÉLŐ Kezelőhöz</button>`,
                adminGombok: `<button class="edit-btn is-danger" onclick="forceMoveToPastFromLive()">🛑 Lezárás (Múltbélivé tétel)</button>`
            });
        } else {
            jelenCont.innerHTML = betoltesAllapot.live
                ? '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Jelenleg nincs élő verseny.</div>'
                : skeletonVersenyKartyak(1);
        }

        localRaces.mult.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach(r => {
            multCont.innerHTML += raceCardHTML(r, 'mult', {
                fooGomb: `<button class="calc-btn" onclick="openPublicPastRace('${r.id}')">📊 Eredmények megtekintése</button>`,
                adminGombok: `
                    <button class="edit-btn" onclick="openRaceModal('mult', '${r.id}')">Szerkesztés</button>
                    <button class="edit-btn is-info" onclick="forceMoveRace('mult', 'jovo', '${r.id}')">⏪ Vissza Jövőbelibe</button>
                    <button class="edit-btn is-success" onclick="forceMoveToLive('mult', '${r.id}')">▶️ Újra ÉLŐ-be</button>
                    <button class="edit-btn is-danger" onclick="deleteRace('mult', '${r.id}')">Törlés</button>`
            });
        });

        localRaces.jovo.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach((r, i) => {
            jovoCont.innerHTML += raceCardHTML(r, 'jovo', {
                cimke: i === 0 ? 'KÖVETKEZŐ' : undefined,
                fooGomb: `<button class="calc-btn" onclick="showFutureInfo('${r.id}')">ℹ️ Részletek megtekintése</button>`,
                adminGombok: `
                    <button class="edit-btn" onclick="openRaceModal('jovo', '${r.id}')">Szerkesztés</button>
                    <button class="edit-btn is-success" onclick="forceMoveToLive('jovo', '${r.id}')">▶️ Élesítés (ÉLŐ)</button>
                    <button class="edit-btn is-danger" onclick="deleteRace('jovo', '${r.id}')">Törlés</button>`
            });
        });
    }
    
    // --- VENDÉG NÉZET MÚLTBÉLI VERSENYEKHEZ ---
    // dist: ha meg van adva (pl. egy lovas/ló profiljából érkezünk), egyből azt a kategóriát
    // nyitja meg a szelektor helyett - l. goToRaceResults().
    function openPublicPastRace(id, dist = null) {
        const r = localRaces.mult.find(x => x.id === id);
        if(!r) return;
        viewingPastRaceData = r;
        pastAdatlapFilter = dist;
        document.getElementById('pastRaceModalTitle').innerText = r.name + " - Eredmények";
        switchSidebarMode('past-race-view', null);
        multVersenyMentes();
        renderPastAdatlapList();
    }

    function closePastRaceModal() {
        viewingPastRaceData = null;
        multVersenyMentes();
        switchSidebarMode('versenyek', document.getElementById('btn-menu-versenyek'));
    }

    function setPastAdatlapFilter(cat) { pastAdatlapFilter = cat; multVersenyMentes(); renderPastAdatlapList(); }

    function renderPastAdatlapList() {
        const cont = document.getElementById('pastRaceAdatlapList');
        if(!viewingPastRaceData) return;
        const comps = parseCompetitors(viewingPastRaceData.competitors);
        const config = mergeRaceConfig(viewingPastRaceData.raceConfig);
        let activeCats = getActiveCategories(comps, config);

        if (!pastAdatlapFilter || pastAdatlapFilter === 'all') {
            let html = `<div style="display:flex; flex-direction:column; gap:10px;">`;
            if (activeCats.length === 0) { html += `<p style="text-align:center; color:var(--text-dim);">Nincsenek adatok ebben a versenyben.</p>`; } 
            else { activeCats.forEach(cat => { html += `<button class="calc-btn cat-select-btn" onclick="setPastAdatlapFilter('${cat}')">${catNames[cat]}</button>`; }); }
            cont.innerHTML = html + `<button class="calc-btn" style="background:var(--card-3); color:var(--text); border:1px solid var(--border); margin-top:20px; font-size:0.9rem; padding:10px;" onclick="closePastRaceModal()">🔙 Vissza a versenyekhez</button></div>`;
        } else {
            let catComps = comps.filter(c => c.dist === pastAdatlapFilter);
            let total = catComps.length;
            let elim = catComps.filter(c => c.isEliminated).length;
            let qual = catComps.filter(c => teljesitetteE(c, config)).length;

            let elimPct = total > 0 ? ((elim/total)*100).toFixed(1) : 0;
            let qualPct = total > 0 ? ((qual/total)*100).toFixed(1) : 0;

            let html = `
                <div class="stats-header-container">
                    <div class="stats-top-row">
                        <div class="stat-box large">${catNames[pastAdatlapFilter]}</div>
                        <div class="stat-box small">Teljesítette:<span class="stat-val">${qual} (${qualPct}%)</span></div>
                        <div class="stat-box small">Kiesett:<span class="stat-val">${elim} (${elimPct}%)</span></div>
                    </div>
                    <div class="stats-ctrl-row">
                        <button class="stat-btn" onclick="setPastAdatlapFilter(null)">⮜ Vissza a kategóriákhoz</button>
                        <div class="mobile-break"></div>
                        <button class="stat-btn" onclick="showCatInfo('${pastAdatlapFilter}', true)" style="font-size:1.1rem; padding:4px 10px;">ℹ️</button>
                    </div>
                </div>
                ${renderTieWarningBanner(comps, pastAdatlapFilter)}
                <div id="pastAdatlapItemsContainer"></div>
            `;
            cont.innerHTML = html;
            
            const itemsCont = document.getElementById('pastAdatlapItemsContainer');
            let ranksInfo = calculateCurrentRanks(comps, config);

            catComps.sort(eredmenyRendezo(ranksInfo));

            catComps.forEach(c => {
                let info = ranksInfo[c.bib] || { rank: "-", gapStr: "" };
                let rankClass = c.isEliminated ? "kiesett" : (c.status === 'FNR' ? "fnr" : "");
                let rankDisplay = helyezesCimke(c, info.rank);
                let gapHtml = info.gapStr ? `<div class="adatlap-gap">Lemaradás: ${info.gapStr}</div>` : '';
                let speedStr = ""; let speedFlagHtml = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
                if (completedLaps.length > 0) {
                    let lastLap = completedLaps[completedLaps.length - 1];
                    speedStr = `Átlag: ${kmh(lastLap.rideSpd)} km/h`;
                    speedFlagHtml = getSpeedFlagBadgesHtml(c, completedLaps);
                }
                let speedHtml = speedStr ? `<div class="adatlap-speed-badge">${speedStr}</div>` : '';
                
                let statusObj = getCompLiveStatus(c, config);
                let liveStatusHtml = `<span class="adatlap-live-status" style="background:${statusObj.color}; color:${statusObj.textCol||'#fff'};">${statusObj.text}</span>`;

                itemsCont.innerHTML += `
                <div class="adatlap-card" onclick="openAdatlap('${c.bib}', true)">
                    <div class="adatlap-rank ${rankClass}">${rankDisplay}</div>
                    <div class="adatlap-info">
                        <div class="adatlap-name-row"><span class="adatlap-bib">${c.bib}</span> <span class="adatlap-name">${c.name}</span>${kovetettVersenyzoE(c) ? ' <span class="kovetett-jel" title="Követed">★</span>' : ''} ${liveStatusHtml}</div>
                        <div class="adatlap-horse">${c.internal || "Ismeretlen ló"}</div>
                    </div>
                    <div class="adatlap-right" style="display:flex; align-items:center; gap:10px;">
                        <button class="calc-btn" onclick="event.stopPropagation(); openVetHistory('${c.bib}')" style="background:var(--success); color:black; padding:6px 12px; margin:0; font-size:0.85rem; width:auto; border-radius:8px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🩺 Karton</button>
                        <div class="adatlap-arrow">❯</div>
                    </div>
                    <div class="adatlap-badges">${gapHtml}${speedHtml}${speedFlagHtml}</div>
                </div>`;
            });
        }
    }


    // --- MODAL (Új / Múlt / Jövő) Logika ---
    function openRaceModal(type, id = null) {
        document.getElementById('rm-id').value = id || '';
        document.getElementById('rm-type').value = type;
        modalRaceId = id; 
        
        let prefixTitle = type === 'mult' ? "Múltbéli" : "Jövőbeli";
        document.getElementById('raceModalTitle').innerText = id ? `${prefixTitle} verseny szerkesztése` : `Új ${prefixTitle.toLowerCase()} verseny felvitele`;
        
        if(!id) {
            document.getElementById('rm-tab-btn-kiiras').style.display = 'none';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'none';
            document.getElementById('rm-tab-btn-verseny').style.display = 'none';
            document.getElementById('rm-tab-btn-gyors').style.display = 'none';
        } else {
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
            document.getElementById('rm-tab-btn-gyors').style.display = type === 'jovo' ? 'none' : 'block';
            attachModalFirebaseListeners(id, type);
        }

        switchRmTab('rm-alap', document.getElementById('rm-tab-btn-alap'));

        if (id) {
            const race = localRaces[type].find(r => r.id === id);
            if (race) {
                document.getElementById('rm-name').value = race.name;
                document.getElementById('rm-loc').value = race.loc;
                document.getElementById('rm-date').value = race.date;
                document.getElementById('rm-desc').value = race.desc || '';
                document.getElementById('rm-isObRound').checked = race.isObRound !== false;
            }
        } else {
            document.getElementById('rm-name').value = '';
            document.getElementById('rm-loc').value = '';
            document.getElementById('rm-date').value = '';
            document.getElementById('rm-desc').value = '';
            document.getElementById('rm-isObRound').checked = true;
        }

        document.getElementById('raceModal').style.display = 'flex';
    }

    function switchRmTab(tabId, btn) {
        document.querySelectorAll('.rm-tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#rm-tab-bar .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).style.display = 'block';
        if(btn) btn.classList.add('active');
    }

    function saveRaceData() {
        const type = document.getElementById('rm-type').value;
        const name = document.getElementById('rm-name').value;
        let id = document.getElementById('rm-id').value;
        
        if(!name) { showToast("A verseny nevének megadása kötelező!", true); return; }
        
        if (!id) { id = generateSlug(name, document.getElementById('rm-date').value); }

        const raceData = {
            id: id, name: name, loc: document.getElementById('rm-loc').value, date: document.getElementById('rm-date').value, desc: document.getElementById('rm-desc').value,
            isObRound: document.getElementById('rm-isObRound').checked
        };
        
        db.ref('races/' + type + '/' + id).update(raceData).then(() => {
            document.getElementById('rm-id').value = id;
            modalRaceId = id;
            // Mentés után már nem "új" a verseny - a cím a szerkesztést mutassa.
            document.getElementById('raceModalTitle').innerText = `${type === 'mult' ? 'Múltbéli' : 'Jövőbeli'} verseny szerkesztése`;
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
            document.getElementById('rm-tab-btn-gyors').style.display = type === 'jovo' ? 'none' : 'block';
            attachModalFirebaseListeners(id, type);
            showAnimatedBtn('btn-rm-alap-mentes');
        }).catch(e => showToast("Hiba az adatok mentésekor: " + e.message, true));
    }

    function deleteRace(type, id) {
        showConfirm("Verseny törlése", "Biztosan törölni akarod ezt a versenyt a rendszerből?", () => {
            db.ref('races/' + type + '/' + id).remove();
        });
    }

    function closeRaceModal() {
        document.getElementById('raceModal').style.display = 'none';
        detachModalFirebaseListeners();
        modalRaceId = null; 
    }

    function showAnimatedBtn(btnId) {
        const btn = document.getElementById(btnId);
        if(btn && !btn.dataset.animating) {
            btn.dataset.animating = "true";
            const origText = btn.innerText;
            const origBg = btn.style.background;
            btn.innerText = 'Sikeresen mentve! ✅';
            btn.style.background = 'var(--success)';
            setTimeout(() => { 
                btn.innerText = origText; 
                btn.style.background = origBg; 
                delete btn.dataset.animating;
            }, 2000);
        }
    }

    // --- MODAL TARTALOM FIREBASE SZINKRON ---
    function attachModalFirebaseListeners(id, type) {
        if(modalRaceId && modalRaceId !== id) {
            const oldType = document.getElementById('rm-type').value || 'mult';
            db.ref('races/' + oldType + '/' + modalRaceId + '/raceConfig').off();
            db.ref('races/' + oldType + '/' + modalRaceId + '/competitors').off();
        }
        
        db.ref('races/' + type + '/' + id + '/raceConfig').on('value', snap => {
            modalRaceConfig = mergeRaceConfig(snap.val());
            renderRmKiiras();
        });
        db.ref('races/' + type + '/' + id + '/competitors').on('value', snap => {
            modalCompetitors = parseCompetitors(snap.val());
            updateRmCompetitorDisplays();
            updateRmGyorsCompetitorDisplays();
            const selectedBib = document.getElementById('rm-selectCompetitor').value;
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && activeEl.tagName === 'INPUT' && document.getElementById('rm-verseny').contains(activeEl);
            if (selectedBib && !isInputFocused) { loadRmCompetitorData(); }
        });
        db.ref('races/' + type + '/' + id + '/vets').on('value', snap => {
            modalVets = snap.val() ? Object.values(snap.val()) : [];
            updateRmVetDisplays();
        });
    }

    function detachModalFirebaseListeners() {
        if(modalRaceId) {
            const type = document.getElementById('rm-type').value || 'mult';
            db.ref('races/' + type + '/' + modalRaceId + '/raceConfig').off();
            db.ref('races/' + type + '/' + modalRaceId + '/competitors').off();
            db.ref('races/' + type + '/' + modalRaceId + '/vets').off();
        }
        modalRaceConfig = getEmptyRaceConfig();
        modalCompetitors = [];
        modalEditingBib = null;
        modalVets = [];
    
        if(modalRaceId) {
            const type = document.getElementById('rm-type').value || 'mult';
            db.ref('races/' + type + '/' + modalRaceId + '/raceConfig').off();
            db.ref('races/' + type + '/' + modalRaceId + '/competitors').off();
        }
        modalRaceConfig = getEmptyRaceConfig();
        modalCompetitors = [];
        modalEditingBib = null;
    }

    // --- KIÍRÁS: az élő (prefix '') és a versenyszerkesztő (prefix 'rm-') közös logikája ---
    function kiirasCfg(prefix) { return prefix === 'rm-' ? modalRaceConfig : raceConfig; }

    function kiirasKorszamValtas(prefix, dist, count) {
        const cfg = kiirasCfg(prefix)[dist];
        let laps = cfg.laps || [];
        const n = parseInt(count, 10);
        if (n > laps.length) { for (let i = laps.length; i < n; i++) laps.push(''); }
        else laps = laps.slice(0, n);
        cfg.laps = laps;
        // Pihenő csak a körök között van (az utolsó kör után cél), ezért eggyel kevesebb.
        if (cfg.holds) cfg.holds = laps.slice(0, -1).map((_, i) => (cfg.holds[i] !== undefined && cfg.holds[i] !== null ? cfg.holds[i] : ''));
        if (prefix === 'rm-') renderRmKiiras(); else renderKiiras();
    }
    function changeRmLapCount(dist, count) { kiirasKorszamValtas('rm-', dist, count); }

    // Egy mező módosítása (h/m/s, körtáv, pihenő) - azonnal frissíti a táv figyelmeztetését is,
    // nem csak mentés után.
    function kiirasMezo(prefix, dist, mezo, idx, val) {
        const cfg = kiirasCfg(prefix)[dist];
        if (!cfg) return;
        if (mezo === 'lap') { if (!cfg.laps) cfg.laps = []; cfg.laps[idx] = val; }
        else if (mezo === 'hold') { if (!cfg.holds) cfg.holds = (cfg.laps || []).slice(0, -1).map(() => ''); cfg.holds[idx] = val; }
        else cfg[mezo] = val;
        kiirasOsszegzoFrissit(prefix, dist);
    }
    function updateRmRaceConfig(dist, field, val) { kiirasMezo('rm-', dist, field, null, val); }
    function updateRmRaceLap(dist, idx, val) { kiirasMezo('rm-', dist, 'lap', idx, val); }

    function kiirasOsszegzoFrissit(prefix, dist) {
        const span = document.getElementById(prefix + 'kiiras-hiany-' + dist);
        if (!span) return;
        const h = kiirasHianyLeiras(kiirasCfg(prefix)[dist], dist);
        span.textContent = h ? '⚠️ ' + h : '';
        span.style.display = h ? '' : 'none';
    }

    // Rajtidő: óra 0-23, perc/mp 0-59 (korábban akár "080000" is elmenthető volt).
    function kiirasIdoErvenyes(cfg) {
        const ok = (v, max) => {
            const s = String(v === undefined || v === null ? '' : v).trim();
            return s === '' || (/^\d{1,2}$/.test(s) && parseInt(s, 10) <= max);
        };
        return ok(cfg.h, 23) && ok(cfg.m, 59) && ok(cfg.s, 59);
    }

    // Mentést akadályozó hibák (minden távra). Üres tömb = menthető.
    function kiirasHibak(config) {
        const hibak = [];
        DIST_ORDER.forEach(d => {
            const cfg = config[d];
            if (!cfg) return;
            const nev = catNames[d] || d + ' km';
            if (!kiirasIdoErvenyes(cfg)) hibak.push(`${nev}: hibás rajtidő (óra 0-23, perc és mp 0-59)`);
            (cfg.laps || []).forEach((l, i) => {
                if (String(l).trim() === '') return;
                const v = parseFloat(l);
                if (!(v > 0 && v <= 200)) hibak.push(`${nev}: hibás ${i + 1}. körtáv (${l})`);
            });
            (cfg.holds || []).forEach((h, i) => {
                if (String(h).trim() === '' || i >= (cfg.laps || []).length - 1) return;
                const v = parseFloat(h);
                if (!(v > 0 && v <= 120)) hibak.push(`${nev}: hibás pihenőidő a ${i + 1}. kör után (${h} perc)`);
            });
        });
        return hibak;
    }

    // Mit hiányol ez a táv? Csukott blokknál is ki kell írni, különben észrevétlen marad a
    // hiányzó körtáv - pont ez okozta a Husztót Kupánál a néma 0 pontot (l. getSilentZeroWarnings).
    // A pihenőidőnél az 53. § szabályait is jelzi (20-29 km-es kör után min. 30 perc, 30 km-nél
    // hosszabb kör után km-enként 1 perc, egynapos versenyen legfeljebb 60 perc).
    function kiirasHianyLeiras(cfg, dist) {
        const laps = (cfg && cfg.laps) || [];
        const ures = laps.filter(l => l === '' || l === null || l === undefined).length;
        const hianyok = [];
        if (!laps.length) hianyok.push('nincs kör megadva');
        else if (ures === laps.length) hianyok.push('nincs körtáv megadva');
        else if (ures) hianyok.push(`${ures} kör távja hiányzik`);
        const rajtUres = ['h', 'm', 's'].every(k => String((cfg && cfg[k]) || '').trim() === '');
        if (rajtUres) hianyok.push('nincs rajtidő');
        else if (cfg && !kiirasIdoErvenyes(cfg)) hianyok.push('hibás rajtidő');
        if (laps.some(l => String(l).trim() !== '' && !(parseFloat(l) > 0 && parseFloat(l) <= 200))) hianyok.push('hibás körtáv');
        if (cfg && dist) {
            for (let i = 0; i < laps.length - 1; i++) {
                const km = parseFloat(laps[i]);
                const perc = getPihenoPerc(cfg, dist, i);
                const min = km > 30 ? Math.ceil(km) : (km >= 20 ? 30 : 0);
                if (min && perc < min) hianyok.push(`${i + 1}. kör után min. ${min} perc pihenő kell`);
                if (perc > 60) hianyok.push(`${i + 1}. pihenő 60 percnél hosszabb`);
            }
            // 48. § (2): egy kör 20-40 km; 48. § (4): a táv szerinti legkevesebb körszám
            laps.forEach((l, i) => {
                const km = parseFloat(l);
                if (km > 0 && (km < 20 || km > 40)) hianyok.push(`${i + 1}. kör ${String(l).replace('.', ',')} km (20–40 km lehet, 48. §)`);
            });
            const nevleges = parseInt(String(dist).replace('j', ''), 10) || 0;
            const minKor = nevleges >= 140 ? 5 : nevleges >= 120 ? 4 : nevleges >= 60 ? 3 : nevleges >= 40 ? 2 : 1;
            if (laps.length && laps.length < minKor) hianyok.push(`${nevleges} km-hez legalább ${minKor} kör kell (48. § (4))`);
        }
        return hianyok.join(' · ');
    }

    // A nyitott/csukott állapotot meg kell jegyezni: a körszám-váltás újrarajzolja a listát,
    // és alapértelmezés szerint visszacsukná pont azt a blokkot, amiben az admin épp dolgozik.
    // Alapállapot: 80 km-ig nyitva, a hosszú távok csukva (8 táv nyitva már nem fér el).
    let kiirasNyitottTavok = null;

    function kiirasNyitvaE(d) {
        if (!kiirasNyitottTavok) {
            kiirasNyitottTavok = new Set(DIST_ORDER.filter(x => parseInt(x.replace('j', ''), 10) <= 80));
        }
        return kiirasNyitottTavok.has(d);
    }

    function kiirasToggle(d, nyitva) {
        kiirasNyitvaE(d);
        if (nyitva) kiirasNyitottTavok.add(d); else kiirasNyitottTavok.delete(d);
    }

    // Az élő kiírás (renderKiiras) és a verseny-szerkesztő modal (renderRmKiiras) ugyanazt a
    // szerkezetet rajzolja, csak más állapotot ír - ezért közös builder (p = mező-előtag).
    function kiirasTavBlokkHtml(d, cfg, p) {
        const lapCount = (cfg.laps || []).length;
        const hiany = kiirasHianyLeiras(cfg, d);
        const ertek = v => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
        const korInputok = (cfg.laps || []).map((lapDist, idx) =>
            `<input type="number" step="0.1" min="0.1" max="200" inputmode="decimal" placeholder="${idx + 1}. kör" value="${ertek(lapDist)}" style="width:65px;" oninput="kiirasMezo('${p}', '${d}', 'lap', ${idx}, this.value)">`
        ).join('');
        // Az utolsó kör után nincs pihenő (cél). Üres mező = alapérték (a placeholderben látszik).
        const pihenoInputok = (cfg.laps || []).slice(0, -1).map((_, idx) =>
            `<label class="piheno-mezo"><span>${idx + 1}. kör után</span>
                <input type="number" min="1" max="120" step="1" inputmode="numeric" placeholder="${alapPihenoPerc(d, idx, lapCount)}" value="${ertek(cfg.holds ? cfg.holds[idx] : '')}" oninput="kiirasMezo('${p}', '${d}', 'hold', ${idx}, this.value)"> perc
            </label>`
        ).join('');

        return `<details class="kiiras-card"${kiirasNyitvaE(d) ? ' open' : ''} ontoggle="kiirasToggle('${d}', this.open)">
            <summary>${catNames[d] || d + ' km'} Kategória<span class="kiiras-hiany" id="${p}kiiras-hiany-${d}"${hiany ? '' : ' style="display:none"'}>${hiany ? '⚠️ ' + hiany : ''}</span></summary>
            <div class="kiiras-tartalom">
                <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
                    <select class="admin-only kiiras-korszam" onchange="kiirasKorszamValtas('${p}', '${d}', this.value)">
                        ${[1,2,3,4,5,6,7,8].map(num => `<option value="${num}" ${lapCount === num ? 'selected' : ''}>${num} kör</option>`).join('')}
                    </select>
                </div>
                <label>Hivatalos Rajt:</label>
                <div class="time-group">
                    <input type="number" min="0" max="23" step="1" inputmode="numeric" placeholder="00" value="${ertek(cfg.h)}" oninput="kiirasMezo('${p}', '${d}', 'h', null, this.value); jump(this, '${p}kr_${d}_m')"> :
                    <input type="number" min="0" max="59" step="1" inputmode="numeric" id="${p}kr_${d}_m" placeholder="00" value="${ertek(cfg.m)}" oninput="kiirasMezo('${p}', '${d}', 'm', null, this.value); jump(this, '${p}kr_${d}_s')"> :
                    <input type="number" min="0" max="59" step="1" inputmode="numeric" id="${p}kr_${d}_s" placeholder="00" value="${ertek(cfg.s)}" oninput="kiirasMezo('${p}', '${d}', 's', null, this.value)">
                </div>
                <label>Körök távolságai (km):</label>
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">${korInputok}</div>
                ${lapCount > 1 ? `
                <label>Kötelező pihenőidő (perc):</label>
                <p class="field-hint" style="margin:2px 0 6px 0;">Üresen hagyva az alapérték: 40 perc, 100 km-től az utolsó pihenő 50 perc. Verseny közben is módosítható - mentéskor a már rögzített kiindulási idők újraszámolódnak.</p>
                <div class="piheno-sor">${pihenoInputok}</div>` : ''}
            </div>
        </details>`;
    }

    function renderRmKiiras() {
        const cont = document.getElementById('rm-kiirasContainer');
        if (!cont) return;
        cont.innerHTML = DIST_ORDER.filter(d => modalRaceConfig[d]).map(d => kiirasTavBlokkHtml(d, modalRaceConfig[d], 'rm-')).join('');
    }

    // A kiírás (körtáv, rajtidő, pihenő) változása után a versenyzők már rögzített köreit
    // újra kell számolni - különben a kiindulási idők és sebességek a régi kiírást tükröznék.
    // Tranzakció versenyzőnként, hogy a közben érkező beérkeztetés/orvosi mentések ne vesszenek el.
    // A "Gyors eredmény"-nyel (kör-adatok nélkül) rögzítetteket kihagyjuk.
    function versenyzokUjraszamolasa(utvonal, comps, config) {
        return Promise.all(comps.filter(c => c && !c.manualEntry).map(c =>
            db.ref(utvonal + '/' + c.bib).transaction(currentComp => {
                if (!currentComp || currentComp.manualEntry) return currentComp;
                const result = recalcCompetitorData(currentComp, config);
                delete result._timeWarnings;
                return result;
            })
        ));
    }

    function saveRmKiiras() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const hibak = kiirasHibak(modalRaceConfig);
        if (hibak.length) { showToast(hibak[0], true); return; }
        const type = document.getElementById('rm-type').value;
        const utvonal = 'races/' + type + '/' + modalRaceId;
        db.ref(utvonal + '/raceConfig').set(modalRaceConfig).then(() => {
            showAnimatedBtn('saveRmKiirasBtn');
            return versenyzokUjraszamolasa(utvonal + '/competitors', modalCompetitors, modalRaceConfig);
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
    }

    function saveRmVet() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const name = document.getElementById('rm-regVetName').value.trim().replace(/\s+/g, ' ');
        if(!name) { showToast("Add meg az orvos nevét!", true); return; }
        // Ugyanaz a duplikáció-szűrés, mint az élő orvoslistánál (saveVet).
        if (modalVets.some(v => v.name && v.name.toLowerCase() === name.toLowerCase())) {
            showToast("Ez az orvos már szerepel ennél a versenynél.", true);
            return;
        }
        const type = document.getElementById('rm-type').value;
        const id = Date.now().toString();
        db.ref('races/' + type + '/' + modalRaceId + '/vets/' + id).set({ id, name }).then(() => {
            vetTorzsbe(name); // a torzsadatba is, hogy legkozelebb elég rákeresni
            document.getElementById('rm-regVetName').value = '';
            showAnimatedBtn('rm-saveVetBtn');
        }).catch(e => showToast("Hiba az orvos mentésekor: " + e.message, true));
    }

    function deleteRmVet(id) {
        if(!modalRaceId) return;
        const type = document.getElementById('rm-type').value;
        showConfirm("Orvos törlése", "Biztosan törlöd ezt az állatorvost a verseny listájából?", () => {
            db.ref('races/' + type + '/' + modalRaceId + '/vets/' + id).remove();
        });
    }

    function updateRmVetDisplays() {
        const cont = document.getElementById('rm-vetListContainer'); if(!cont) return;
        cont.innerHTML = '';
        if(modalVets.length === 0) {
            cont.innerHTML = '<div style="color:var(--text-dim);">Nincs állatorvos rögzítve ehhez a versenyhez.</div>';
            return;
        }
        modalVets.sort((a,b) => a.name.localeCompare(b.name)).forEach(v => {
            cont.innerHTML += `<div class="competitor-item">
                <div style="flex:1;">${escapeHtml(v.name)}</div>
                <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteRmVet('${v.id}')">Törlés</button>
            </div>`;
        });
    }

    // --- RAJTSZÁM-ÜTKÖZÉS ---
    // Új versenyző (vagy rajtszám-csere) csak SZABAD rajtszámra kerülhet. Korábban a foglalt
    // számon lévő versenyzőt szó nélkül felülírta - élőben az új ember még a régi köreit és
    // eredményét is "megörökölte".
    function rajtszamFoglalo(comps, bib, sajatBib) {
        if (sajatBib && String(sajatBib) === String(bib)) return null;
        return (comps || []).find(c => c && String(c.bib) === String(bib)) || null;
    }

    // A rajtszám a Firebase-ben kulcs: . # $ [ ] / nem lehet benne.
    function rajtszamErvenyes(bib) { return /^[0-9A-Za-z_-]{1,10}$/.test(String(bib)); }

    // A nevezés közös mentése (élő és versenyszerkesztő). ut = '.../competitors/'.
    // - foglalt rajtszámra nem ír (akkor sem, ha közben egy másik eszköz foglalta el - tranzakció);
    // - rajtszám-cserénél előbb az újat menti, és csak siker után törli a régit;
    // - a régi rekord MINDEN mezője megmarad (köradatok, orvosi döntés, obPont, kézi helyezés...).
    function versenyzoMentes({ ut, comps, szerkesztettBib, mezok, gombId, utana }) {
        const bib = mezok.bib;
        if (!rajtszamErvenyes(bib)) { showToast('A rajtszám csak számot, betűt, kötőjelet tartalmazhat (max. 10 karakter).', true); return; }
        const foglalo = rajtszamFoglalo(comps, bib, szerkesztettBib);
        if (foglalo) { showToast(`A(z) ${bib}. rajtszám már foglalt: ${foglalo.name}. Adj meg másikat!`, true); return; }
        const sajatHelyen = !!szerkesztettBib && String(szerkesztettBib) === String(bib);
        const regiBib = szerkesztettBib && !sajatHelyen ? szerkesztettBib : null;
        const oldComp = (comps || []).find(c => c && String(c.bib) === String(szerkesztettBib || bib));
        const existingData = Object.assign({ startTime: { h: '', m: '', s: '' }, laps: [], isEliminated: false }, sajatHelyen || regiBib ? oldComp : {});
        let utkozott = false;
        db.ref(ut + bib).transaction(currentComp => {
            utkozott = false;
            if (currentComp && !sajatHelyen) { utkozott = true; return; }   // foglalt -> nem írunk
            const base = currentComp || existingData;
            return {
                ...base,
                ...mezok,
                startTime: base.startTime || { h: '', m: '', s: '' },
                laps: base.laps || [],
                isEliminated: base.isEliminated || false,
                // A nevezés csak egy pillanatfelvétel - ezek nélkül a mentés törölné az orvosi
                // döntést, ha az korábban már megvolt (idomodell-es-hibak.md, A rész).
                // null (nem undefined!) a biztonságos alap, mert a Firebase SDK undefined mezőértékre hibát dob.
                status: base.status || null,
                extraCodes: base.extraCodes || [],
                preVet: base.preVet || null
            };
        }).then(res => {
            if (utkozott || (res && res.committed === false)) {
                showToast(`A(z) ${bib}. rajtszámot közben más foglalta el - nem mentettem.`, true);
                return;
            }
            if (regiBib) db.ref(ut + regiBib).remove();
            // Ló/lovas törzsadat (mezőszinten, l. torzsFrissitesek) - csak sikeres mentés után.
            const torzs = torzsFrissitesek(mezok.startNum, mezok.internal, mezok.license, mezok.name, mezok.club);
            if (Object.keys(torzs).length) db.ref('/').update(torzs);
            showAnimatedBtn(gombId);
            utana();
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
    }

    function nevezesMezok(elotag) {
        const v = id => String(document.getElementById(elotag + id).value || '').trim();
        return {
            bib: v('regBib'), name: v('regName').replace(/\s+/g, ' '), startNum: v('regStartNum'),
            license: v('regLicense'), club: v('regClub').replace(/\s+/g, ' '), dist: v('regDist'), internal: v('regInternal').replace(/\s+/g, ' ')
        };
    }

    // --- MODAL: VERSENYZŐ FUNKCIÓK ---
    function saveRmCompetitor() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const type = document.getElementById('rm-type').value;
        const mezok = nevezesMezok('rm-');
        if (!mezok.bib || !mezok.name) { showToast("Név és rajtszám kötelező!", true); return; }
        versenyzoMentes({
            ut: 'races/' + type + '/' + modalRaceId + '/competitors/', comps: modalCompetitors,
            szerkesztettBib: modalEditingBib, mezok, gombId: 'rm-addCompBtn', utana: cancelRmEdit
        });
    }
    
    function editRmCompetitor(bib) {
        const comp = modalCompetitors.find(c => c.bib == bib);
        if(!comp) return;
        document.getElementById('rm-regBib').value = comp.bib;
        document.getElementById('rm-regName').value = comp.name;
        document.getElementById('rm-regStartNum').value = comp.startNum || '';
        document.getElementById('rm-regLicense').value = comp.license || '';
        document.getElementById('rm-regClub').value = comp.club || '';
        document.getElementById('rm-regDist').value = comp.dist;
        document.getElementById('rm-regInternal').value = comp.internal || '';
        modalEditingBib = comp.bib; 
        document.getElementById('rm-addCompBtn').innerText = "Mentés";
        document.getElementById('rm-cancelEditBtn').style.display = "block";
        document.getElementById('rm-deleteCompBtn').style.display = "block";
        document.getElementById('rm-versenyzok').scrollIntoView({ behavior: "smooth" });
    }
    
    function cancelRmEdit() {
        modalEditingBib = null;
        document.getElementById('rm-regBib').value = '';
        document.getElementById('rm-regName').value = '';
        document.getElementById('rm-regStartNum').value = '';
        document.getElementById('rm-regLicense').value = '';
        document.getElementById('rm-regClub').value = '';
        document.getElementById('rm-regInternal').value = '';
        document.getElementById('rm-addCompBtn').innerText = "Hozzáadás";
        document.getElementById('rm-cancelEditBtn').style.display = "none";
        document.getElementById('rm-deleteCompBtn').style.display = "none";
    }
    
    function deleteRmCompetitor() {
        if (!modalEditingBib || !modalRaceId) return;
        const type = document.getElementById('rm-type').value;
        showConfirm("Versenyző törlése", "Biztosan törölni akarod ezt a versenyzőt ebből a listából?", () => {
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + modalEditingBib).remove().then(() => {
                cancelRmEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }
    
    function updateRmCompetitorDisplays() {
        const list = document.getElementById('rm-competitorList'); list.innerHTML = '';
        const sel = document.getElementById('rm-selectCompetitor');
        const currentSelected = sel.value;
        sel.innerHTML = '<option value="">-- Válassz --</option>';
        
        modalCompetitors.sort((a,b) => parseInt(a.bib) - parseInt(b.bib)).forEach(c => {
            list.innerHTML += `<div class="competitor-item">
                <div style="flex:1; cursor:pointer;" onclick="switchRmTab('rm-verseny', document.getElementById('rm-tab-btn-verseny')); document.getElementById('rm-selectCompetitor').value='${c.bib}'; loadRmCompetitorData();">
                    <span class="competitor-bib">#${c.bib}</span> ${c.name} <b style="color:var(--primary); margin-left:10px;">${catNames[c.dist]}</b>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="edit-btn admin-only" onclick="editRmCompetitor('${c.bib}')">Módosítás</button>
                    <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteRmCompetitorDirect('${c.bib}')">Törlés</button>
                </div>
            </div>`;
            sel.innerHTML += `<option value="${c.bib}">#${c.bib} - ${c.name}</option>`;
        });
        if(currentSelected) sel.value = currentSelected;
    }

    function deleteRmCompetitorDirect(bib) {
        if (!modalRaceId) return;
        const type = document.getElementById('rm-type').value;
        showConfirm("Versenyző törlése", "Biztosan törölni akarod ezt a versenyzőt ebből a listából?", () => {
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + bib).remove().then(() => {
                if (modalEditingBib === bib) cancelRmEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }

    // ============================================================================
    // IDEIGLENES: "GYORS EREDMÉNY" - helyezés alapú rögzítés kör-/időadatok nélkül.
    // Akkor kell, ha a rendszer nem volt kint a helyszínen, és utólag csak a
    // helyezéseket kapjuk meg.
    // ============================================================================
    function saveRmGyorsCompetitor() {
        if (!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const type = document.getElementById('rm-type').value;

        const bib = document.getElementById('rm-gy-regBib').value;
        const name = document.getElementById('rm-gy-regName').value;
        const startNum = document.getElementById('rm-gy-regStartNum').value;
        const license = document.getElementById('rm-gy-regLicense').value;
        const club = document.getElementById('rm-gy-regClub').value;
        const dist = document.getElementById('rm-gy-regDist').value;
        const internal = document.getElementById('rm-gy-regInternal').value;
        const status = document.getElementById('rm-gy-status').value;
        const place = parseInt(document.getElementById('rm-gy-place').value, 10);
        const timeSec = toSec(document.getElementById('rm-gy-h').value, document.getElementById('rm-gy-m').value, document.getElementById('rm-gy-s').value);

        if (!String(bib).trim() || !String(name).trim()) { showToast("Név és rajtszám kötelező!", true); return; }
        if (!rajtszamErvenyes(String(bib).trim())) { showToast('A rajtszám csak számot, betűt, kötőjelet tartalmazhat (max. 10 karakter).', true); return; }

        // Foglalt rajtszámra nem írunk (a set() a teljes rekordot cserélné - egy időmért versenyző
        // köradatai is elvesztek így).
        const foglalo = rajtszamFoglalo(modalCompetitors, bib, modalGyorsEditingBib);
        if (foglalo) { showToast(`A(z) ${bib}. rajtszám már foglalt: ${foglalo.name}. Adj meg másikat!`, true); return; }
        const regiGyors = modalCompetitors.find(c => String(c.bib) === String(modalGyorsEditingBib || bib));
        if (regiGyors && !regiGyors.manualEntry && (regiGyors.laps || []).some(l => l && (l.h || l.oh))) {
            showToast(`${regiGyors.name} részletes köradatokkal szerepel - az Eredmények fülön szerkeszd.`, true);
            return;
        }

        // Helyezést csak a "versenyben / célba ért" státusz kaphat; FNR és kiesés helyezés nélkül.
        const helyezett = status === 'Active';
        if (helyezett && !isNaN(place)) {
            if (place < 1) { showToast('A helyezés legalább 1 legyen.', true); return; }
            const masok = modalCompetitors.filter(c => c.dist === dist && String(c.bib) !== String(modalGyorsEditingBib || bib));
            // A köradatokkal rögzítettek helyezése az időkből számolódik (calculateCurrentRanks) - egy
            // kézi helyezés ugyanazon a távon dupla helyezést adna velük (pl. két 2. hely).
            const idomert = masok.find(c => !c.manualEntry && !c.isEliminated && c.status !== 'FNR' && (c.laps || []).some(l => l && l.isComplete));
            if (idomert) { showToast(`Ezen a távon köradatokkal rögzített versenyző is van (pl. ${idomert.name}), az ő helyezése az időkből számolódik - kézi helyezés itt összeakadna vele. Az Eredmények fülön vedd fel köridőkkel.`, true); return; }
            const utkozo = masok.find(c => c.manualEntry && !c.isEliminated && c.status !== 'FNR' && c.manualPlace === place);
            if (utkozo) { showToast(`A(z) ${place}. hely ezen a távon már foglalt: ${utkozo.name}.`, true); return; }
        }

        const compData = {
            bib: String(bib).trim(), name: name.trim().replace(/\s+/g, ' '), dist: dist, internal: internal.trim(), startNum: startNum.trim(), license: license.trim(), club: club.trim(),
            status: status, isEliminated: !(status === 'Active' || status === 'FNR'),
            manualEntry: true,
            manualPlace: helyezett && !isNaN(place) ? place : null,
            totalTimeSec: timeSec > 0 ? timeSec : null,
            // A set() a teljes rekordot cseréli - az OB-pontról való lemondás (obPont: false) ne vesszen el egy javítással.
            obPont: regiGyors && regiGyors.obPont === false ? false : null,
            laps: []
        };

        const ut = 'races/' + type + '/' + modalRaceId + '/competitors/';
        const sajatHelyen = !!modalGyorsEditingBib && String(modalGyorsEditingBib) === String(compData.bib);
        const regiBib = modalGyorsEditingBib && !sajatHelyen ? modalGyorsEditingBib : null;
        let utkozott = false;
        db.ref(ut + compData.bib).transaction(currentComp => {
            utkozott = false;
            if (currentComp && !sajatHelyen) { utkozott = true; return; }
            return compData;
        }).then(res => {
            if (utkozott || (res && res.committed === false)) { showToast(`A(z) ${compData.bib}. rajtszámot közben más foglalta el - nem mentettem.`, true); return; }
            if (regiBib) db.ref(ut + regiBib).remove();
            // Ló/lovas törzsadat upsert (mezőszinten) - csak sikeres mentés után.
            const horseRiderUpdates = torzsFrissitesek(startNum, internal, license, name, club);
            if (Object.keys(horseRiderUpdates).length) db.ref('/').update(horseRiderUpdates);
            showAnimatedBtn('rm-gy-addBtn');
            cancelRmGyorsEdit();
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
    }

    function editRmGyorsCompetitor(bib) {
        const comp = modalCompetitors.find(c => c.bib == bib);
        if (!comp) return;
        document.getElementById('rm-gy-regBib').value = comp.bib;
        document.getElementById('rm-gy-regName').value = comp.name;
        document.getElementById('rm-gy-regStartNum').value = comp.startNum || '';
        document.getElementById('rm-gy-regLicense').value = comp.license || '';
        document.getElementById('rm-gy-regClub').value = comp.club || '';
        document.getElementById('rm-gy-regDist').value = comp.dist;
        document.getElementById('rm-gy-regInternal').value = comp.internal || '';
        document.getElementById('rm-gy-status').value = comp.status || 'Active';
        document.getElementById('rm-gy-place').value = comp.manualPlace || '';
        if (comp.totalTimeSec) {
            const t = comp.totalTimeSec;
            document.getElementById('rm-gy-h').value = Math.floor(t / 3600);
            document.getElementById('rm-gy-m').value = Math.floor((t % 3600) / 60);
            document.getElementById('rm-gy-s').value = t % 60;
        } else {
            document.getElementById('rm-gy-h').value = '';
            document.getElementById('rm-gy-m').value = '';
            document.getElementById('rm-gy-s').value = '';
        }
        modalGyorsEditingBib = comp.bib;
        document.getElementById('rm-gy-addBtn').innerText = "Mentés";
        document.getElementById('rm-gy-cancelBtn').style.display = "block";
        document.getElementById('rm-gy-deleteBtn').style.display = "block";
        document.getElementById('rm-gyors').scrollIntoView({ behavior: "smooth" });
    }

    function cancelRmGyorsEdit() {
        modalGyorsEditingBib = null;
        document.getElementById('rm-gy-regBib').value = '';
        document.getElementById('rm-gy-regName').value = '';
        document.getElementById('rm-gy-regStartNum').value = '';
        document.getElementById('rm-gy-regLicense').value = '';
        document.getElementById('rm-gy-regClub').value = '';
        document.getElementById('rm-gy-regInternal').value = '';
        document.getElementById('rm-gy-status').value = 'Active';
        document.getElementById('rm-gy-place').value = '';
        document.getElementById('rm-gy-h').value = '';
        document.getElementById('rm-gy-m').value = '';
        document.getElementById('rm-gy-s').value = '';
        document.getElementById('rm-gy-addBtn').innerText = "Hozzáadás";
        document.getElementById('rm-gy-cancelBtn').style.display = "none";
        document.getElementById('rm-gy-deleteBtn').style.display = "none";
    }

    function deleteRmGyorsCompetitor() {
        if (!modalGyorsEditingBib || !modalRaceId) return;
        const type = document.getElementById('rm-type').value;
        showConfirm("Eredmény törlése", "Biztosan törlöd ezt a gyorsan rögzített eredményt?", () => {
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + modalGyorsEditingBib).remove().then(() => {
                cancelRmGyorsEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }

    function deleteRmGyorsCompetitorDirect(bib) {
        if (!modalRaceId) return;
        const type = document.getElementById('rm-type').value;
        showConfirm("Eredmény törlése", "Biztosan törlöd ezt a gyorsan rögzített eredményt?", () => {
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + bib).remove().then(() => {
                if (modalGyorsEditingBib === bib) cancelRmGyorsEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }

    function updateRmGyorsCompetitorDisplays() {
        const cont = document.getElementById('rm-gyors-list');
        if (!cont) return;
        const gyorsComps = modalCompetitors.filter(c => c.manualEntry).sort((a, b) => (a.manualPlace || 999) - (b.manualPlace || 999));
        if (gyorsComps.length === 0) { cont.innerHTML = '<div style="color:var(--text-dim);">Még nincs gyorsan rögzített eredmény.</div>'; return; }
        cont.innerHTML = gyorsComps.map(c => {
            const placeStr = c.isEliminated ? getElimText(c) : (c.manualPlace ? c.manualPlace + '. hely' : 'nincs helyezés');
            const timeStr = c.totalTimeSec ? ' · ' + toTimeStr(c.totalTimeSec) : '';
            return `<div class="competitor-item">
                <div style="flex:1;">
                    <span class="competitor-bib">#${c.bib}</span> ${c.name} <b style="color:var(--primary); margin-left:10px;">${catNames[c.dist] || c.dist}</b>
                    <br><span style="color:var(--text-dim); font-size:0.85rem;">${placeStr}${timeStr}</span>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="edit-btn admin-only" onclick="editRmGyorsCompetitor('${c.bib}')">Módosítás</button>
                    <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteRmGyorsCompetitorDirect('${c.bib}')">Törlés</button>
                </div>
            </div>`;
        }).join('');
    }

    // --- MODAL: TELJES VERSENY (EREDMÉNYEK) ---
    // (A versenyző betöltése - loadRmCompetitorData - lejjebb van; itt korábban egy régi,
    // felülírt példánya is ült.) saveToDb=false: csak számol és kijelez, NEM ment - a puszta
    // kiválasztás / megnézés korábban az adatbázisba írt, és "Sikeresen mentve"-t mutatott.
    function calcRmVerseny(saveToDb = true) {
        const count = parseInt(document.getElementById('rm-lapCount').value);
        const bib = document.getElementById('rm-selectCompetitor').value;
        const rajt = toSec(document.getElementById('rm-vhR').value, document.getElementById('rm-vmR').value, document.getElementById('rm-vsR').value);
        if(!modalRaceId) return;

        // Előbb minden mezőt beolvasunk a DOM-ból, hogy a lenti tranzakció retry-jai (ha kellenek)
        // ugyanazokat az értékeket alkalmazzák, bármelyik "comp" objektumon hívjuk is meg.
        const startTime = { h: document.getElementById('rm-vhR').value, m: document.getElementById('rm-vmR').value, s: document.getElementById('rm-vsR').value };
        const statusVal = document.getElementById('rm-compStatusSelect').value;
        const lapValues = [];
        for (let i = 0; i < count; i++) {
            lapValues.push({
                d: document.getElementById(`rm-vd${i+1}`).value,
                h: document.getElementById(`rm-vh${i+1}`).value,
                m: document.getElementById(`rm-vm${i+1}`).value,
                s: document.getElementById(`rm-vs${i+1}`).value,
                oh: document.getElementById(`rm-voh${i+1}`).value,
                om: document.getElementById(`rm-vom${i+1}`).value,
                os: document.getElementById(`rm-vos${i+1}`).value,
            });
        }
        function applyForm(target) {
            target.startTime = startTime;
            target.status = statusVal;
            // A RECHECK és az FNR (teljesítette, helyezés nélkül) nem kiesés (l. az élő calcVerseny-t).
            target.isEliminated = !['Active', 'RECHECK', 'FNR'].includes(statusVal);
            lapValues.forEach((lv, i) => {
                if (!target.laps) target.laps = [];
                if (!target.laps[i]) target.laps[i] = {};
                Object.assign(target.laps[i], lv);
            });
            return target;
        }

        let comp = modalCompetitors.find(c => c.bib == bib);
        if (comp) applyForm(comp);

        if(rajt === 0) { document.getElementById('rm-res2').style.display='none'; return; }

        comp = recalcCompetitorData(comp, modalRaceConfig);
        let html = "";
        if (comp._timeWarnings && comp._timeWarnings.length) {
            html += `<div class="warning-banner level-warn"><span class="wb-icon">⚠️</span><span>Egy vagy több beírt idő szokatlanul távolinak tűnik az előzőhöz képest — ellenőrizd, nem gépeltél-e el egy számjegyet, mielőtt mented.</span></div>`;
        }
        let countLaps = comp.laps.length;
        for(let i=0; i<countLaps; i++) {
            let l = comp.laps[i];
            if(!l.isComplete) continue;
            let loopColor = l.loopSpd >= 16 ? 'var(--warning)' : 'var(--success)';
            let phaseColor = l.phaseSpd >= 16 ? 'var(--warning)' : 'var(--success)';
            let isFinalLap = (i === countLaps - 1);
            html += `<div class="plan-box" style="border-left-color:${loopColor}">
                <span class="plan-header" style="color:${loopColor}">${i+1}. KÖR</span>
                <div class="plan-data-row"><span class="plan-data-label">Kör idő:</span> <b style="color:var(--text);">${toTimeStr(l.loopSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Beérkezés:</span> <b style="color:var(--text);">${toTimeStr(l.arrSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Átlag:</span> <b style="color:${loopColor}">${l.loopSpd.toFixed(2)} km/h</b></div>
                ${l.vetSec > 0 ? `
                <div style="margin-top:6px; border-top:1px dashed var(--border); padding-top:6px;"></div>
                <div class="plan-data-row"><span class="plan-data-label">Orvosi idő:</span> <b style="color:var(--text);">${toTimeStr(isFinalLap ? (l.loopSec + l.pulzusSec) : l.phaseSec)}</b></div>
                ${!isFinalLap ? `<div class="plan-data-row"><span class="plan-data-label">Orvosi átlag:</span> <b style="color:${phaseColor}">${l.phaseSpd.toFixed(2)} km/h</b></div>` : ''}
                <div class="plan-data-row"><span class="plan-data-label">Pulzus idő:</span> <b style="color:var(--primary);">${toTimeStr(l.pulzusSec)}</b></div>
                ` : ""}
            </div>`;
        }
        
        if (comp.laps && comp.laps.length > 0 && comp.laps[0].isComplete) {
            let lastComplete = comp.laps.slice().reverse().find(x => x.isComplete);
            if (lastComplete) {
                let hasSpeeding = comp.laps.some(l => l.isComplete && (l.loopSpd >= 16 || l.phaseSpd >= 16));
                let avgColor = (hasSpeeding || lastComplete.rideSpd >= 16) ? 'var(--warning)' : 'var(--success)';
                let totalTime = ((comp.dist === "20" || comp.dist === "20j") && lastComplete.vetSec > 0) ? (lastComplete.loopSec + lastComplete.pulzusSec) : lastComplete.rideTime;
                html += `<div class="summary-total">
                    <strong style="color:var(--primary); font-size:1.1rem; display:block; margin-bottom:8px;">Összesített statisztika</strong>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:var(--text);">${toTimeStr(totalTime)}</b></div>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. átlagsebesség:</span> <b style="font-size:1.3rem; color:${avgColor}">${lastComplete.rideSpd.toFixed(2)} km/h</b></div>
                </div>`;
            }
        }
        document.getElementById('rm-res2').style.display='block'; document.getElementById('rm-res2').innerHTML = html;
        if (saveToDb && comp) {
            const type = document.getElementById('rm-type').value;
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + comp.bib).transaction(currentComp => {
                if (!currentComp) return currentComp;
                const result = recalcCompetitorData(applyForm(currentComp), modalRaceConfig);
                delete result._timeWarnings; // ideiglenes, kijelzésre való - nem mentjük el
                return result;
            });
            showAnimatedBtn('rm-btn-kiertel-mentes');
        }
    }

    // --- IDŐMODELL: ÉJFÉL KÖRÜLI ÁTFORDULÁS vs. ELGÉPELÉS (idomodell-es-hibak.md, B rész) ---
    // Egy nyers különbség (pl. vet - arr) negatív lehet, ha a második időpont éjfél után van.
    // Eldönti: hétköznapi éjféli átfordulásról van-e szó (a felkorrigált különbség < 12 óra),
    // vagy gyanús adatbeviteli hiba (pl. elgépelt óraérték).
    function resolveRollover(rawDiff) {
        if (rawDiff > 0) return { diff: rawDiff, suspicious: false };
        const rolled = rawDiff + 86400;
        if (rolled < 12 * 3600) return { diff: rolled, suspicious: false };
        return { diff: rolled, suspicious: true };
    }

    // --- ÚJ SZEREPKÖR FUNKCIÓK (RECALC DATA KÖZÖS MOTOR) ---
    function recalcCompetitorData(comp, config) {
        if (!comp) return comp;
        // Minden hívás elején tiszta lap - a figyelmeztetések csak az ÉPP MOST kiszámolt körökre vonatkoznak.
        comp._timeWarnings = [];
        function rollApply(rawDiff, tag) {
            const r = resolveRollover(rawDiff);
            if (r.suspicious) comp._timeWarnings.push(tag);
            return r.diff;
        }
        const baseDist = comp.dist.replace('j', '');
        const cfg = config[baseDist] || { h:'', m:'', s:'', laps:[] };
        let expectedLaps = cfg.laps ? cfg.laps.length : 1;
        let rajt = toSec(comp.startTime?.h || cfg.h, comp.startTime?.m || cfg.m, comp.startTime?.s || cfg.s);
        if (!comp.laps) comp.laps = [];

        // Ha sehol nincs rajtidő (sem a versenyzőnél, sem a kiírásban), korábban itt
        // azonnal kiléptünk. Emiatt a Beérkeztetés / Orvosi idő panelen felvitt idő
        // MENTŐDÖTT, de egyetlen származtatott érték sem készült el (arrSec, vetSec,
        // isComplete, pulzusSec), és az adatlap üresen maradt - úgy tűnt, mintha nem
        // frissülne. Rajtidő nélkül a kör-/összidő és a sebesség tényleg nem
        // számolható, de a rögzített időket és a pulzusidőt ki tudjuk tölteni.
        if (rajt === 0) {
            for (let i = 0; i < expectedLaps; i++) {
                let l = comp.laps[i] || { h:'', m:'', s:'', oh:'', om:'', os:'' };
                l.d = parseFloat(l.d) || parseFloat(cfg.laps[i]) || 0;
                const arr = toSec(l.h, l.m, l.s);
                const vet = toSec(l.oh, l.om, l.os);
                l.startSec = 0;
                l.arrSec = arr;
                l.vetSec = vet;
                l.isComplete = false; // rajtidő nélkül nincs értékelhető kör
                l.pulzusSec = (arr > 0 && vet > 0) ? rollApply(vet - arr, 'pulzus') : 0;
                comp.laps[i] = l;
            }
            return comp;
        }

        let curStart = rajt;
        let totalPure = 0;
        let totalD = 0;
        for (let i = 0; i < expectedLaps; i++) {
            let l = comp.laps[i] || { h:'', m:'', s:'', oh:'', om:'', os:'' };
            l.d = parseFloat(l.d) || parseFloat(cfg.laps[i]) || 0;
            const arr = toSec(l.h, l.m, l.s);
            const vet = toSec(l.oh, l.om, l.os);
            const isFinalLap = (i === expectedLaps - 1);
            l.startSec = curStart;
            l.arrSec = arr;
            l.vetSec = vet;
            l.isComplete = (l.d > 0 && arr > 0);
            if (!l.isComplete) {
                // A pulzusidő nem függ a körtávtól, csak a két rögzített időponttól -
                // ezért akkor is kiszámoljuk, ha a kör a hiányzó körtáv miatt még nem
                // "teljes" (különben az adatlapon és a legjobb pulzusidőnél elveszne).
                l.pulzusSec = (arr > 0 && vet > 0) ? rollApply(vet - arr, 'pulzus') : 0;
                comp.laps[i] = l;
                continue;
            }
            
            let loopTime = rollApply(arr - curStart, 'loop');

            let phaseTime; let pulzusTime = 0;
            if (isFinalLap) {
                // ÚJ LOGIKA 20 KM-hez: Az idő az Orvosi kapunál (VET) áll meg!
                if (comp.dist === "20" || comp.dist === "20j") {
                    phaseTime = vet > 0 ? rollApply(vet - curStart, 'phase') : loopTime;
                } else {
                    phaseTime = loopTime;
                }
                if(vet > 0) pulzusTime = rollApply(vet - arr, 'pulzus');
            } else {
                phaseTime = vet > 0 ? rollApply(vet - curStart, 'phase') : loopTime;
                pulzusTime = vet > 0 ? rollApply(vet - arr, 'pulzus') : 0;
            }
            
            l.loopSec = loopTime;
            l.phaseSec = phaseTime;
            l.pulzusSec = pulzusTime;
            l.loopSpd = l.d / (loopTime/3600);
            l.phaseSpd = l.d / (phaseTime/3600);
            // Admin által távonként konfigurált min (időtúllépés/OT kockázat) és max (sebesség/SP kockázat, 139. § (2))
            const speedT = speedThresholds[baseDist] || {};
            l.speedFlagMax = speedT.max != null && (l.loopSpd >= speedT.max || l.phaseSpd >= speedT.max);
            l.speedFlagMin = speedT.min != null && (l.loopSpd < speedT.min || l.phaseSpd < speedT.min);

            totalPure += phaseTime;
            totalD += l.d;
            l.rideTime = totalPure;
            l.rideSpd = totalD / (totalPure/3600);
            // Kötelező pihenő a kiírásból (53. §, alapból 40 perc, 100 km-től az utolsó 50) - korábban fix 40.
            // normalizálva 0-86399 közé, hogy éjfél körül ne "24:xx:xx"-ként jelenjen meg és a várakozó-státusz ne ragadjon be (P0/2)
            l.nextStart = ((vet > 0 ? vet : arr) + Math.round(getPihenoPerc(cfg, comp.dist, i) * 60)) % 86400;

            curStart = l.nextStart;
            comp.laps[i] = l;
        }
        return comp;
    }

    function getActiveLapIndex(comp, config) {
        if (!comp || !comp.laps) return 0;
        const baseDist = comp.dist.replace('j', '');
        const cfg = config[baseDist] || { laps: [] };
        let expectedLaps = cfg.laps ? cfg.laps.length : 1;
        
        for (let i = 0; i < expectedLaps; i++) {
            let l = comp.laps[i];
            if (!l || !l.h || l.h === '') return i;
            if (i < expectedLaps - 1 && (!l.oh || l.oh === '')) return i;
        }
        return expectedLaps - 1;
    }

    // A beérkeztetés és az orvosi idő űrlap ABBA a körbe ment, amelyik a megnyitáskor látszott
    // (data-kor), nem a mentés pillanatában újraszámolt aktív körbe. Az RFID kapu (rfid_kapu.py)
    // ugyanezeket a mezőket írja: ha közben beírta ennek a körnek az idejét, a kézi idő korábban
    // már a KÖVETKEZŐ körbe került (orvosi időnél egy még be sem érkezett körbe). Ha a mező a
    // megnyitás óta megváltozott (data-eredeti), mentés előtt rákérdezünk.
    function urlapKor(formId, comp) {
        const kor = parseInt(document.getElementById(formId).dataset.kor, 10);
        return kor >= 0 ? kor : getActiveLapIndex(comp, raceConfig);
    }

    // A kör beérkezési (elotag '') vagy orvosi (elotag 'o') ideje mp-ben, szövegként; '' = üres.
    function korIdoKulcs(l, elotag) {
        return (l && l[elotag + 'h']) ? String(toSec(l[elotag + 'h'], l[elotag + 'm'], l[elotag + 's'])) : '';
    }

    function urlapKorBeallit(form, idx, l, elotag) {
        form.dataset.kor = idx === null ? '' : idx;
        form.dataset.eredeti = idx === null ? '' : korIdoKulcs(l, elotag);
    }

    function kozbenBeirtakKerdes(bib, idx, mit, kozbenSec, sajatSec, felulir) {
        showConfirm('Közben beírták ezt az időt',
            `#${bib} ${idx + 1}. kör ${mit}: amióta megnyitottad, valaki más (pl. az RFID kapu) beírta: ${toTimeStr(kozbenSec)}.\n\n` +
            `Felülírod a te idődre (${toTimeStr(sajatSec)})?\n\n` +
            `Mégse: a beírt idő marad. A versenyzőt újra kiválasztva látod a mostani állapotot.`,
            felulir);
    }

    // --- BEÉRKEZTETÉS MÓD ---
    function loadBeerkeztetesData() {
        const bib = document.getElementById('sel-beerkeztetes').value;
        const form = document.getElementById('beerkeztetes-form');
        urlapKorBeallit(form, null);
        if(!bib) { form.style.display = 'none'; setFormDirty('beerkeztetes-form', false); return; }

        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getActiveLapIndex(comp, raceConfig);
        document.getElementById('bk-lap-title').innerText = `${idx + 1}. Kör Beérkeztetése`;
        let l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        urlapKorBeallit(form, idx, l, '');

        document.getElementById('bk-h').value = l.h || '';
        document.getElementById('bk-m').value = l.m || '';
        document.getElementById('bk-s').value = l.s || '';

        form.style.display = 'block';
        setFormDirty('beerkeztetes-form', false); // frissen betöltve: nincs mentetlen módosítás
    }

    function saveBeerkeztetesData(felulirhat = false) {
        const bib = document.getElementById('sel-beerkeztetes').value;
        const h = document.getElementById('bk-h').value, m = document.getElementById('bk-m').value, s = document.getElementById('bk-s').value;
        // Üres rajtszámmal a tranzakció a teljes competitors ágon futna le.
        if (!bib) { showToast('Válassz versenyzőt!', true); return; }

        const form = document.getElementById('beerkeztetes-form');
        const idx = urlapKor('beerkeztetes-form', competitors.find(c => c.bib == bib));
        const eredeti = form.dataset.eredeti || '';
        const sajat = String(toSec(h, m, s));
        let kozben = '';

        // Tranzakció: a szerveren lévő legfrissebb állapotot olvassa be és azon hajtja végre
        // ugyanezt a módosítást - ha közben más (pl. az orvos) is írt, nem veszik el az ő mentése.
        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            kozben = '';
            if (!currentComp.laps) currentComp.laps = [];
            if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
            const most = korIdoKulcs(currentComp.laps[idx], '');
            if (!felulirhat && most && most !== eredeti && most !== sajat) { kozben = most; return; }
            currentComp.laps[idx].h = h;
            currentComp.laps[idx].m = m;
            currentComp.laps[idx].s = s;
            const result = recalcCompetitorData(currentComp, raceConfig);
            delete result._timeWarnings; // ideiglenes, kijelzésre való (élőben már jelezve gépeléskor) - nem mentjük el
            return result;
        }).then(res => {
            if (res && res.committed === false) {
                if (kozben) kozbenBeirtakKerdes(bib, idx, 'beérkezés', Number(kozben), Number(sajat), () => saveBeerkeztetesData(true));
                return;
            }
            showAnimatedBtn('btn-bk-mentes');
            document.getElementById('sel-beerkeztetes').value = '';
            document.getElementById('bk-bibInput').value = ''; // <--- EZ TÖRLI A KERESŐT
            document.getElementById('beerkeztetes-form').style.display = 'none';
            setFormDirty('beerkeztetes-form', false); // elmentve -> jöhet megint az élő frissítés
            refreshVersenyTabIfNeeded(bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }
    
    // --- ORVOSI IDŐ MÓD ---
    function loadOrvosiIdoData() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const form = document.getElementById('orvosi-ido-form');
        urlapKorBeallit(form, null);
        if(!bib) { form.style.display = 'none'; setFormDirty('orvosi-ido-form', false); renderWarningBanner('orv-ido-recovery-warning', null); return; }

        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getActiveLapIndex(comp, raceConfig);
        document.getElementById('bk-vet-lap-title').innerText = `${idx + 1}. Kör Orvosi Idő`;
        let l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        urlapKorBeallit(form, idx, l, 'o');

        if(l.h && l.h !== '') {
            document.getElementById('orv-ido-arr-time').innerText = `Beérkezett: ${toTimeStr(toSec(l.h, l.m, l.s))} (Rögzítve)`;
            document.getElementById('orv-ido-arr-time').style.color = 'var(--success)';
        } else {
            document.getElementById('orv-ido-arr-time').innerText = `Versenyző még a pályán van! (Nincs beérkezési idő)`;
            document.getElementById('orv-ido-arr-time').style.color = 'var(--warning)';
        }

        document.getElementById('bk-v-h').value = l.oh || '';
        document.getElementById('bk-v-m').value = l.om || '';
        document.getElementById('bk-v-s').value = l.os || '';

        form.style.display = 'block';
        setFormDirty('orvosi-ido-form', false); // frissen betöltve: nincs mentetlen módosítás
        checkOrvosiIdoRecovery();
    }

    function saveOrvosiIdoData(felulirhat = false) {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const oh = document.getElementById('bk-v-h').value, om = document.getElementById('bk-v-m').value, os = document.getElementById('bk-v-s').value;
        if (!bib) { showToast('Válassz versenyzőt!', true); return; }

        const form = document.getElementById('orvosi-ido-form');
        const idx = urlapKor('orvosi-ido-form', competitors.find(c => c.bib == bib));
        const eredeti = form.dataset.eredeti || '';
        const sajat = String(toSec(oh, om, os));
        let kozben = '';

        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            kozben = '';
            if (!currentComp.laps) currentComp.laps = [];
            if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
            const most = korIdoKulcs(currentComp.laps[idx], 'o');
            if (!felulirhat && most && most !== eredeti && most !== sajat) { kozben = most; return; }
            currentComp.laps[idx].oh = oh;
            currentComp.laps[idx].om = om;
            currentComp.laps[idx].os = os;
            const result = recalcCompetitorData(currentComp, raceConfig);
            delete result._timeWarnings; // ideiglenes, kijelzésre való (élőben már jelezve gépeléskor) - nem mentjük el
            return result;
        }).then(res => {
            if (res && res.committed === false) {
                if (kozben) kozbenBeirtakKerdes(bib, idx, 'orvosi idő', Number(kozben), Number(sajat), () => saveOrvosiIdoData(true));
                return;
            }
            showAnimatedBtn('btn-bk-vet-mentes');
            document.getElementById('sel-orvosi-ido').value = '';
            document.getElementById('oi-bibInput').value = ''; // <--- EZ TÖRLI A KERESŐT
            document.getElementById('orvosi-ido-form').style.display = 'none';
            setFormDirty('orvosi-ido-form', false); // elmentve -> jöhet megint az élő frissítés
            refreshVersenyTabIfNeeded(bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }

    // --- ÁLLATORVOSOK FELVITELE (ÚJ FUNKCIÓK) ---
    function saveVet() {
        // Mint a versenyszerkesztőben (saveRmVet): a dupla szóköz se csináljon "új" orvost.
        const name = document.getElementById('regVetName').value.trim().replace(/\s+/g, ' ');
        if(!name) { showToast("Add meg az orvos nevét!", true); return; }
        if (liveVets.some(v => v.name && v.name.toLowerCase() === name.toLowerCase())) {
            showToast("Ez az orvos már szerepel ennél a versenynél.", true);
            return;
        }
        const id = Date.now().toString();
        db.ref('vets/' + id).set({ id: id, name: name });
        vetTorzsbe(name); // a torzsadatba is, hogy legkozelebb elég rákeresni
        document.getElementById('regVetName').value = '';
        showToast("Állatorvos sikeresen hozzáadva!");
    }

    // Új verseny indításakor az előző verseny orvosai ne maradjanak bent.
    // A törzsadat (vetsDb) érintetlen marad, tehát bármikor visszakereshetők.
    function clearLiveVets() {
        if (!liveVets.length) { showToast("Nincs mit törölni.", true); return; }
        showConfirm(
            "Orvoslista ürítése",
            `Törlöd mind a(z) ${liveVets.length} orvost EBBŐL a versenyből? ` +
            `A nevek a törzsadatban megmaradnak, később rákereséssel ` +
            `bármikor visszatehetők.`,
            () => {
                db.ref('vets').remove()
                    .then(() => showToast("Az orvoslista kiürítve."))
                    .catch(e => showToast("Hiba: " + e.message, true));
            }
        );
    }

    function deleteVet(id) {
        showConfirm("Orvos törlése", "Biztosan törlöd ezt az állatorvost a listából?", () => {
            db.ref('vets/' + id).remove();
        });
    }

    function renderVetList() {
        const cont = document.getElementById('vetListContainer'); if(!cont) return;
        cont.innerHTML = '';
        if(liveVets.length === 0) { cont.innerHTML = '<div style="color:var(--text-dim);">Nincs állatorvos rögzítve.</div>'; return; }
        liveVets.forEach(v => {
            cont.innerHTML += `<div class="competitor-item">
                <div style="flex:1;"><b>${v.name}</b></div>
                <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteVet('${v.id}')">Törlés</button>
            </div>`;
        });
    }

    function updateVetDropdowns() {
        const sel = document.getElementById('orv-vet-name'); if(!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">-- Válassz orvost --</option>';
        liveVets.forEach(v => { sel.innerHTML += `<option value="${v.name}">${v.name}</option>`; });
        if(currentVal) sel.value = currentVal;
    }

    // --- ORVOSI MÓD (ELŐZETES VIZSGÁLATTAL ÉS KÖRVÁLASZTÓVAL) ---
    function getVetLapIndex(comp) {
        if (!comp || !comp.laps) return -1; // A -1 jelenti az ELŐZETES vizsgálatot
        let idx = -1;
        for (let i = 0; i < comp.laps.length; i++) {
            // A legutolsó kört keressük, ahová a lovas már beérkezett
            if (comp.laps[i] && comp.laps[i].h && comp.laps[i].h !== '') {
                idx = i;
            }
        }
        return idx;
    }

    function loadOrvosiData() {
        const bib = document.getElementById('sel-orvosi').value;
        const form = document.getElementById('orvosi-form');
        if(!bib) { form.style.display = 'none'; orvosiModBib = null; renderWarningBanner('orv-recovery-warning', null); renderExtraCodesCheckboxes([]); return; }

        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getVetLapIndex(comp);
        let l = {};

        if (idx === -1) {
            // NINCS MÉG KÖR -> ELŐZETES ÁLLATORVOSI
            document.getElementById('orv-lap-title').innerText = `Előzetes Állatorvosi Vizsgálat (PRE-VET)`;
            document.getElementById('orv-arr-time').innerText = `Rajt előtti állapot`;
            document.getElementById('orv-arr-time').style.color = 'var(--primary)';
            document.getElementById('orv-vet-time').innerText = `-`;
            l = comp.preVet || {};
            renderWarningBanner('orv-recovery-warning', null);
        } else {
            // MÁR VAN KÖR
            l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
            document.getElementById('orv-lap-title').innerText = `${idx + 1}. Kör Orvosi Vizsgálata`;

            if(l.h && l.h !== '') {
                document.getElementById('orv-arr-time').innerText = `Beérkezés: ${toTimeStr(toSec(l.h, l.m, l.s))} (Rögzítve)`;
                document.getElementById('orv-arr-time').style.color = 'var(--success)';
            } else {
                document.getElementById('orv-arr-time').innerText = `Versenyző még a pályán van!`;
                document.getElementById('orv-arr-time').style.color = 'var(--warning)';
            }

            if(l.oh && l.oh !== '') {
                document.getElementById('orv-vet-time').innerText = `Orvosi idő: ${toTimeStr(toSec(l.oh, l.om, l.os))} (Rögzítve)`;
                document.getElementById('orv-vet-time').style.color = 'var(--primary)';
            } else {
                document.getElementById('orv-vet-time').innerText = `Orvosi idő még nincs rögzítve!`;
                document.getElementById('orv-vet-time').style.color = 'var(--warning)';
            }

            const baseDist = comp.dist.replace('j', '');
            const cfg = raceConfig[baseDist] || { laps: [] };
            const expectedLaps = cfg.laps ? cfg.laps.length : 1;
            const isFinalLap = (idx === expectedLaps - 1);
            renderWarningBanner('orv-recovery-warning', getRecoveryWarning(toSec(l.h, l.m, l.s), toSec(l.oh, l.om, l.os), isFinalLap, comp.dist));
        }

        // RE-CHECK VIZSGÁLAT: külön bejegyzés (laps[i].recheck) - nem írja felül az első vizsgálatot.
        // Ha a ló re-checkre vár, vagy már volt re-check vizsgálata, két fül jelenik meg; alapból a
        // re-check vizsgálat nyílik. A kiválasztott fül ugyanannál a lónál az élő frissítéskor megmarad.
        const vanRecheck = idx >= 0 && (comp.status === 'RECHECK' || !!l.recheck);
        // Az alapértelmezett fül a ló állapotából: ha az változik (pl. az első vizsgálat Re-check
        // döntéssel mentve), újra a megfelelő fül nyílik - különben a re-check felülírná az elsőt.
        const modKulcs = `${comp.bib}|${vanRecheck}|${comp.status || ''}`;
        if (orvosiModBib !== modKulcs) { orvosiModBib = modKulcs; orvosiRecheckMod = vanRecheck; }
        if (!vanRecheck) orvosiRecheckMod = false;
        document.getElementById('orv-mod-valaszto').style.display = vanRecheck ? 'flex' : 'none';
        document.getElementById('orv-mod-elso').classList.toggle('active', !orvosiRecheckMod);
        document.getElementById('orv-mod-recheck').classList.toggle('active', orvosiRecheckMod);
        if (orvosiRecheckMod) document.getElementById('orv-lap-title').innerText = `${idx + 1}. Kör – Re-check vizsgálat`;
        const vizsg = orvosiRecheckMod ? (l.recheck || {}) : l;

        // Re-check mezők + a javasolt idő / figyelmeztetés kiírása
        document.getElementById('orv-rch').value = l.rch || '';
        document.getElementById('orv-rcm').value = l.rcm || '';
        document.getElementById('orv-rcs').value = l.rcs || '';
        renderRecheckInfo(l);
        frissitRecheckLathatosag();

        // Adatok betöltése
        document.getElementById('orv-pulse').value = vizsg.pulse || '';
        document.getElementById('orv-hrri').value = vizsg.hrri || '';
        document.getElementById('orv-nyalka').value = vizsg.nyalka || '';
        document.getElementById('orv-crt').value = vizsg.crt || '';
        document.getElementById('orv-farizom').value = vizsg.farizom || '';
        document.getElementById('orv-vizhaztartas').value = vizsg.vizhaztartas || '';
        document.getElementById('orv-belhang').value = vizsg.belhang || '';
        document.getElementById('orv-mozgas').value = vizsg.mozgas || '';
        document.getElementById('orv-vet-name').value = vizsg.vetName || '';
        document.getElementById('orv-notes').value = vizsg.vetNotes || '';
        const rcTipusSel = document.getElementById('orv-rc-tipus');
        if (rcTipusSel) rcTipusSel.value = l.rcTipus || '';

        // --- HIBATŰRŐ STÁTUSZ BEÁLLÍTÁS ---
        // Az alapértelmezés MINDIG a zöld "Versenyben (Active)". Ha a versenyzőnek
        // még nincs mentett státusza (pl. frissen nevezett, status: null), vagy a
        // mentett érték ismeretlen, akkor sem szabad kiesésre állítani a legördülőt.
        let orvS = comp.status || (comp.isEliminated ? 'FTQ-ME' : 'Active');
        if (orvS === 'Passed') orvS = 'Active';
        if (orvS === 'Visszalépett' || orvS === 'Retired' || orvS === 'DNS') orvS = 'WD';
        if (orvS === 'Kiesett' || orvS === 'Eliminated') orvS = 'FTQ-ME';
        const orvSel = document.getElementById('orvStatusSelect');
        const orvExists = Array.from(orvSel.options).some(opt => opt.value === orvS);
        orvSel.value = orvExists ? orvS : 'Active';
        // Az első vizsgálat döntése (Re-check) a re-check vizsgálat után már nem írható át innen -
        // különben a ló státusza visszaállna re-checkre.
        const elsoZarolt = !orvosiRecheckMod && !!l.recheck;
        if (elsoZarolt) orvSel.value = 'RECHECK';
        orvSel.disabled = elsoZarolt;
        // ----------------------------------
        adjustVetDecisionColors(document.getElementById('orvStatusSelect'));
        // A re-check doboz láthatósága az ÚJ versenyző státuszából: fent még az előző versenyző
        // döntése (pl. Re-check) állt a legördülőben, így minden utána megnyitott lónál látszott.
        frissitRecheckLathatosag();
        renderExtraCodesCheckboxes(comp.extraCodes);

        form.style.display = 'block';
        setFormDirty('orvosi-form', false); // frissen betöltve: nincs mentetlen módosítás
        checkPulseWarning();
    }

    // Az orvosi döntés legördülőjének színe. Korábban a loadOrvosiData() BELSEJÉBEN volt, így az
    // index.html onchange-e nem érte el ("not defined" hiba), és a mögötte álló
    // frissitRecheckLathatosag() sem futott le - Re-check választásakor nem jelent meg az időmező.
    function adjustVetDecisionColors(sel) {
        if (!sel) return;
        const val = sel.value;
        if (val === 'Passed' || val === 'Active' || val === 'FNR') sel.style.color = 'var(--success)';
        else if (['WD', 'RET', 'RECHECK'].includes(val)) sel.style.color = 'var(--warning)';
        else sel.style.color = 'var(--danger)';
    }

    // Re-check típusai - a FEI orvosi lap (FEI Endurance Vet Gate Card) "Re-Inspection" oszlopa
    // szerint, a szabályzat megfelelő pontjaival.
    const RECHECK_TIPUSOK = {
        HR:   { rovid: 'HR',   nev: 'Pulzus miatt újra bemutatva', szabaly: '100. §' },
        REQ:  { rovid: 'REQ',  nev: 'Az orvos kérte', szabaly: '92. § (4)' },
        COMP: { rovid: 'COMP', nev: 'Kötelező ismételt vizsgálat', szabaly: '92. § (3), 101. §' }
    };

    // Kombinálható kiesési kódok checkbox-chip listája (hatralevo-javitasok_1.md, 4. pont)
    function renderExtraCodesCheckboxes(selected) {
        const cont = document.getElementById('orv-extra-codes');
        if (!cont) return;
        const sel = new Set(selected || []);
        cont.innerHTML = EXTRA_CODES.map(ec => `
            <label class="extra-code-chip ${sel.has(ec.code) ? 'checked' : ''}">
                <input type="checkbox" value="${ec.code}" ${sel.has(ec.code) ? 'checked' : ''} onchange="this.parentElement.classList.toggle('checked', this.checked)">
                ${ec.label}
            </label>
        `).join('');
    }
    function getCheckedExtraCodes() {
        const cont = document.getElementById('orv-extra-codes');
        if (!cont) return [];
        return Array.from(cont.querySelectorAll('input:checked')).map(i => i.value);
    }

    // --- RE-CHECK ---
    // Ha az állatorvos nem enged tovább azonnal, a lovat újra be kell mutatni.
    // A re-check a KIINDULÁS (nextStart) előtti utolsó 15 percben esedékes (92. § (3)-(4)):
    //     nextStart = (orvosi vagy beérkezés) + a kiírás szerinti pihenő   (recalcCompetitorData)
    //     re-check  = nextStart - 15 perc
    const RECHECK_ELOTTE_SEC = 15 * 60;

    function recheckJavasoltSec(l, pihenoSec = ALAP_PIHENO_PERC * 60) {
        const alap = toSec(l.oh, l.om, l.os) || toSec(l.h, l.m, l.s);
        if (!alap) return 0;
        // A mentett kiindulási idő már a kiírás szerinti pihenővel számolt.
        const nextStart = l.nextStart > 0 ? l.nextStart : (alap + pihenoSec) % 86400;
        return { nextStart, javasolt: (nextStart - RECHECK_ELOTTE_SEC + 86400) % 86400 };
    }

    // Egy versenyző aktuális re-check információja a nyilvános nézetekhez (adatlap, élő
    // kiindulások, matrica): melyik kör, milyen típus, mikor esedékes / mikor volt.
    function recheckInfo(c, config) {
        if (!c || c.status !== 'RECHECK') return null;
        const laps = c.laps || [];
        let idx = -1;
        laps.forEach((l, i) => { if (l && l.h) idx = i; });
        const l = idx >= 0 ? laps[idx] : (c.preVet || {});
        const baseDist = String(c.dist || '').replace('j', '');
        const cfg = (config && config[baseDist]) || {};
        const info = idx >= 0 ? recheckJavasoltSec(l, getPihenoPerc(cfg, c.dist, idx) * 60) : 0;
        const rogzitett = toSec(l.rch, l.rcm, l.rcs);
        return {
            kor: idx + 1, tipus: l.rcTipus ? RECHECK_TIPUSOK[l.rcTipus] : null,
            rogzitett: rogzitett > 0 ? rogzitett : 0,
            esedekes: info ? info.javasolt : 0,
            kiindulas: info ? info.nextStart : 0
        };
    }

    function recheckSzoveg(ri) {
        if (!ri) return '';
        const tipus = ri.tipus ? ` (${ri.tipus.rovid})` : '';
        if (ri.rogzitett) return `Re-check${tipus} ${toTimeStr(ri.rogzitett)}`;
        if (ri.esedekes) return `Re-check${tipus} ${toTimeStr(ri.esedekes)}-tól`;
        return `Re-check${tipus}`;
    }

    // Aktuális idő beírása egy óra/perc/mp mezőhármasba. A beérkeztetésnél és
    // az orvosi időnél is ez fut, hogy ne kelljen kézzel gépelni az időt.
    function setIdoNow(hId, mId, sId) {
        const n = new Date();
        const h = document.getElementById(hId);
        const m = document.getElementById(mId);
        const s = document.getElementById(sId);
        if (h) h.value = String(n.getHours()).padStart(2, '0');
        if (m) m.value = String(n.getMinutes()).padStart(2, '0');
        if (s) s.value = String(n.getSeconds()).padStart(2, '0');
        markFormDirtyFor(h || m || s);
    }

    function setRecheckNow() {
        setIdoNow('orv-rch', 'orv-rcm', 'orv-rcs');
        renderRecheckInfoFromForm();
    }

    // A re-check doboz csak akkor látszik, ha a ló RE-CHECK státuszban van
    // (mentve, vagy épp most állította át rá az orvos a legördülőben).
    function frissitRecheckLathatosag() {
        const box = document.getElementById('orv-recheck-box');
        if (!box) return;
        const sel = document.getElementById('orvStatusSelect');
        const bib = document.getElementById('sel-orvosi').value;
        const comp = competitors.find(c => c.bib == bib);
        const mentett = comp && comp.status === 'RECHECK';
        const kivalasztott = sel && sel.value === 'RECHECK';
        box.style.display = (mentett || kivalasztott || orvosiRecheckMod) ? 'block' : 'none';
    }

    let orvosiRecheckMod = false, orvosiModBib = null;
    function orvosiModValt(recheck) {
        orvosiRecheckMod = !!recheck;
        loadOrvosiData();
    }

    function clearRecheck() {
        ['orv-rch', 'orv-rcm', 'orv-rcs'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        renderRecheckInfoFromForm();
    }

    // A doboz szövege: rögzített re-check, vagy a javasolt idő; ha a javasolt
    // idő már elmúlt és nincs rögzítve, figyelmeztet (a ló nem jelent meg).
    function renderRecheckInfo(l) {
        const box = document.getElementById('orv-recheck-info');
        if (!box) return;
        const rc = toSec(l.rch, l.rcm, l.rcs);
        const info = recheckJavasoltSec(l);

        if (rc > 0) {
            box.innerText = info
                ? `Re-check rögzítve: ${toTimeStr(rc)}  (javasolt volt: ${toTimeStr(info.javasolt)})`
                : `Re-check rögzítve: ${toTimeStr(rc)}`;
            box.style.color = 'var(--success)';
            return;
        }
        if (!info) {
            box.innerText = 'Re-check: előbb beérkezési vagy orvosi idő kell.';
            box.style.color = 'var(--text-dim)';
            return;
        }
        const n = new Date();
        const mostSec = n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds();
        let elteltMp = mostSec - info.javasolt;
        if (elteltMp < -12 * 3600) elteltMp += 86400;   // éjfél-átfordulás

        if (elteltMp > 0) {
            box.innerText = `⚠ Re-check ideje ELMÚLT (${toTimeStr(info.javasolt)}), `
                + `még nincs rögzítve. Kiindulás: ${toTimeStr(info.nextStart)}`;
            box.style.color = 'var(--danger)';
        } else {
            box.innerText = `Re-check javasolt ideje: ${toTimeStr(info.javasolt)}  `
                + `(kiindulás: ${toTimeStr(info.nextStart)})`;
            box.style.color = 'var(--text-dim)';
        }
    }

    // A form aktuális mezőiből frissít (gombnyomás után, mentés nélkül).
    function renderRecheckInfoFromForm() {
        const bib = document.getElementById('sel-orvosi').value;
        const comp = competitors.find(c => c.bib == bib);
        if (!comp) return;
        const idx = getVetLapIndex(comp);
        const l = (idx === -1) ? (comp.preVet || {}) : ((comp.laps || [])[idx] || {});
        renderRecheckInfo(Object.assign({}, l, {
            rch: document.getElementById('orv-rch').value,
            rcm: document.getElementById('orv-rcm').value,
            rcs: document.getElementById('orv-rcs').value
        }));
    }

    function saveOrvosiData() {
        const bib = document.getElementById('sel-orvosi').value;

        const pulse = document.getElementById('orv-pulse').value;
        const hrri = document.getElementById('orv-hrri').value;
        const nyalka = document.getElementById('orv-nyalka').value;
        const crt = document.getElementById('orv-crt').value;
        const farizom = document.getElementById('orv-farizom').value;
        const vizhaztartas = document.getElementById('orv-vizhaztartas').value;
        const belhang = document.getElementById('orv-belhang').value;
        const mozgas = document.getElementById('orv-mozgas').value;
        const vetName = document.getElementById('orv-vet-name').value;
        const vetNotes = document.getElementById('orv-notes').value;
        const decision = document.getElementById('orvStatusSelect').value;
        const extraCodes = getCheckedExtraCodes();
        const rch = document.getElementById('orv-rch').value;
        const rcm = document.getElementById('orv-rcm').value;
        const rcs = document.getElementById('orv-rcs').value;
        const rcTipus = (document.getElementById('orv-rc-tipus') || {}).value || '';

        if (!bib) { showToast('Válassz versenyzőt!', true); return; }
        const recheckMod = orvosiRecheckMod && document.getElementById('orv-mod-valaszto').style.display !== 'none';
        // A vizsgáló orvos neve a hivatalos lap része (FEI vet card: "Vet. initials") - nélküle nem mentünk.
        if (!vetName) {
            showToast('Válaszd ki a vizsgáló állatorvost!', true);
            const vs = document.getElementById('orv-vet-name'); if (vs) vs.focus();
            return;
        }

        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            let idx = getVetLapIndex(currentComp);
            let targetObj, lapObj;

            if (idx === -1) {
                if (!currentComp.preVet) currentComp.preVet = {};
                targetObj = lapObj = currentComp.preVet;
            } else {
                if (!currentComp.laps) currentComp.laps = [];
                if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
                lapObj = currentComp.laps[idx];
                // Re-check vizsgálat: külön bejegyzés, az első vizsgálat adatai megmaradnak.
                if (recheckMod) { if (!lapObj.recheck) lapObj.recheck = {}; targetObj = lapObj.recheck; }
                else targetObj = lapObj;
            }
            // Az első vizsgálat javítása a re-check után: csak a mezők, a döntés és a státusz marad.
            const csakMezok = !recheckMod && idx >= 0 && !!lapObj.recheck;

            targetObj.pulse = pulse;
            targetObj.hrri = hrri;
            targetObj.nyalka = nyalka;
            targetObj.crt = crt;
            targetObj.farizom = farizom;
            targetObj.vizhaztartas = vizhaztartas;
            targetObj.belhang = belhang;
            targetObj.mozgas = mozgas;
            targetObj.vetName = vetName;
            targetObj.vetNotes = vetNotes;
            // Re-check idő és típus (HR / REQ / COMP - a FEI lap szerint; üresen hagyva törlődik) -
            // mindig a körnél, mert az első és a re-check vizsgálathoz is ugyanaz tartozik.
            lapObj.rch = rch;
            lapObj.rcm = rcm;
            lapObj.rcs = rcs;
            lapObj.rcTipus = rcTipus;

            // JAVÍTÁS: Itt is az 'Active' a zöld utat jelentő kód!
            if (csakMezok) {
                // a döntés és a státusz változatlan
            } else if (decision === 'Active' || decision === 'Passed') {
                currentComp.isEliminated = false;
                currentComp.status = 'Active';
                targetObj.vetDecision = "Továbbengedve";
                currentComp.extraCodes = [];
            } else if (decision === 'FNR') {
                // Teljesítette, minden vizsgálaton megfelelt, csak helyezést nem kap (II. melléklet) - nem kiesés.
                currentComp.isEliminated = false;
                currentComp.status = 'FNR';
                targetObj.vetDecision = "FNR";
                currentComp.extraCodes = [];
            } else if (decision === 'RECHECK') {
                // A re-check NEM kiesés: a ló versenyben marad, csak a
                // kiindulás előtt újra be kell mutatni az orvosnak.
                currentComp.isEliminated = false;
                currentComp.status = 'RECHECK';
                targetObj.vetDecision = "Re-check (újra bemutatandó)";
                currentComp.extraCodes = [];
            } else {
                currentComp.isEliminated = true;
                currentComp.status = decision;
                targetObj.vetDecision = decision;
                currentComp.extraCodes = extraCodes;
            }

            const result = recalcCompetitorData(currentComp, raceConfig);
            delete result._timeWarnings; // ideiglenes, kijelzésre való - nem mentjük el
            return result;
        }).then(() => {
            showAnimatedBtn('btn-orv-mentes');
            setFormDirty('orvosi-form', false); // elmentve -> jöhet megint az élő frissítés
            orvosiModBib = null;               // a következő megnyitás újra a ló állapotából dönt
            setTimeout(() => {
                document.getElementById('sel-orvosi').value = '';
                document.getElementById('orv-bibInput').value = '';
                document.getElementById('orvosi-form').style.display = 'none';
            }, 1000);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }

    // --- NYOMTATÁS MÓD (15x10cm FEKTETETT - FEKETE-FEHÉR HŐNYOMTATÓRA OPTIMALIZÁLVA) ---
    function loadNyomtatasData() {
        const bib = document.getElementById('sel-nyomtatas').value;
        const form = document.getElementById('nyomtatas-form');
        if(!bib) { form.style.display = 'none'; return; }
        
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let phases = (comp.laps || []).filter(l => l.arrSec > 0 || l.vetSec > 0);
        
        if (phases.length === 0) {
            document.getElementById('print-sticker').innerHTML = `<p style="color:var(--text); text-align:center;">Nincs rögzített adat.</p>`;
            form.style.display = 'block';
            return;
        }

        let lastIdx = phases.length - 1;
        let l = phases[lastIdx];
        
        // Kör indexek és idők
        let valodiKorSzam = comp.laps.indexOf(l) + 1; 
        let lastIdxReal = valodiKorSzam - 1;

        let baseDist = comp.dist.replace('j', '');
        let expectedLaps = (raceConfig[baseDist] && raceConfig[baseDist].laps) ? raceConfig[baseDist].laps.length : 1;
        let isFinalLap = (valodiKorSzam === expectedLaps);

        let arrStr = l.arrSec > 0 ? toTimeStr(l.arrSec) : '-';
        let inStr = l.vetSec > 0 ? toTimeStr(l.vetSec) : '-';
        let recStr = (l.arrSec > 0 && l.vetSec > 0) ? toTimeStr(l.pulzusSec > 0 ? l.pulzusSec : resolveRollover(l.vetSec - l.arrSec).diff) : '-';
        let outStr = (l.nextStart > 0 && !isFinalLap && !comp.isEliminated) ? toTimeStr(l.nextStart) : (isFinalLap ? 'CÉL' : '-');
        // Re-check esetén a kiindulás mellé a re-check ideje / típusa is kikerül.
        const ri = recheckInfo(comp, raceConfig);
        const recheckSor = ri ? `<div style="font-size: 8pt; font-weight: bold; margin-top: 0.5mm;">${escapeHtml(recheckSzoveg(ri))}</div>` : '';

        // --- SEBESSÉGEK ÉS IDŐK: ugyanaz a hivatalos számítás, mint az adatlapon és az eredménylistán ---
        // (Korábban a matrica saját képlettel, a pulzusidők nélkül számolt, így pl. 16,49 km/h-t írt
        // ugyanarra a versenyzőre, akinek az adatlapon 16,00 km/h állt.)
        const fmtSpeed = (v) => `${kmh(v)}<span style="font-size: 6.5pt; font-weight: normal;"> km/h</span>`;
        let lapTimeStr = l.isComplete && l.loopSec > 0 ? toTimeStr(l.loopSec) : '-';
        let lapSpeed = l.isComplete && l.loopSpd > 0 ? fmtSpeed(l.loopSpd) : '-';
        let avgSpeed = l.isComplete && l.rideSpd > 0 ? fmtSpeed(l.rideSpd) : '-';

        let raceNameStr = liveRaceMeta ? liveRaceMeta.name : "Élő Verseny";

        // --- HELYEZÉS ÉS LEMARADÁS ---
        let ranksInfo = calculateCurrentRanks(competitors, raceConfig);
        let myRankInfo = ranksInfo[comp.bib] || { rank: "-", gapStr: "" };
        let rankDisplay = comp.isEliminated ? "Kiesett" : helyezesCimke(comp, myRankInfo.rank);
        let gapDisplay = myRankInfo.gapStr ? myRankInfo.gapStr : "-";

        let distName = catNames[comp.dist] || (comp.dist + " km");
        // A "120 km Junior" 15pt-tel három sorba tört a keskeny TÁV oszlopban és
        // ráfolyt a KÖR blokkra - ezért a Junior jelzés külön, kisebb sorba kerül.
        let distMain = distName.replace(/\s*Junior\s*$/i, '');
        let distSub = /Junior\s*$/i.test(distName) ? 'JUNIOR' : '';
        // 4+ jegyű rajtszám 26pt-tel kilógott a cellából.
        let bibFont = String(comp.bib).length > 3 ? '18pt' : '26pt';

        // SZERKEZET: 145mm x 95mm. 
        let html = `
            <div style="width: 145mm; height: 95mm; border: 3px solid #000; padding: 2mm; box-sizing: border-box; background: #fff; color: #000; font-family: Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; margin: 0 auto; line-height: 1.2;">
                
                <div style="flex: 0 0 auto;">
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                        <tr>
                            <td style="width: 17%; border: 2px solid #000; text-align: center; background: #dddddd ; color: #000000; font-size: ${bibFont}; font-weight: bold; padding: 1mm; line-height: 1; white-space: nowrap; overflow: hidden;">#${comp.bib}</td>
                            <td style="width: 38%; padding-left: 2.5mm; padding-right: 2.5mm; vertical-align: top; overflow: hidden;">
                                <div style="text-align: center; background: #f0f0f0; padding: 1mm; margin-bottom: 1.5mm; border: 1px solid #000; border-radius: 3px; font-size: 10pt; font-weight: bold; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${raceNameStr}
                                </div>
                                <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase; line-height: 1.15; word-wrap: break-word; overflow-wrap: break-word;">${comp.name}</div>
                                <div style="font-size: 11pt; line-height: 1.15; margin-top: 1.2mm; padding-top: 1.2mm; border-top: 1px solid #999; word-wrap: break-word; overflow-wrap: break-word;">${comp.internal || "Ló neve hiányzik"}</div>
                            </td>
                            <td style="width: 45%; vertical-align: top;">
                                <table style="width: 100%; border-collapse: collapse; text-align: center; table-layout: fixed;">
                                    <tr style="background: #e0e0e0; font-size: 8pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">BEÉRK.</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">ORVOSI</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">PULZUSIDŐ</td>
                                    </tr>
                                    <tr style="font-size: 11pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${arrStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${inStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${recStr}</td>
                                    </tr>
                                    <tr style="background: #e0e0e0; font-size: 7.5pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">KÖR IDŐ</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">KÖR ÁTL.</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">ÖSSZ ÁTL.</td>
                                    </tr>
                                    <tr style="font-size: 9pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${lapTimeStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${lapSpeed}</td>
                                        <td style="border: 1px solid #000; padding: 1mm; white-space: nowrap;">${avgSpeed}</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </div>

                <div style="flex: 1 1 auto; margin: 1.5mm 0; min-height: 0;">
                    <table style="width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 1mm">
                        <tr style="background: #e0e0e0; color: #000; font-size: 8pt; text-transform: uppercase;">
                            <th style="border: 2px solid #000; padding: 1mm; width: 16%;">TÁV</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 20%;">ÁLLÁS</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 22%;">PULZUS (HR)</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 42%;">KLINIKAI PARAMÉTEREK</th>
                        </tr>
                        <tr>
                            <td style="border: 2px solid #000; padding: 0; height: 100%;">
                                <table style="width: 100%; height: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="background: #ffffff; border-bottom: 2px solid #000; text-align: center; vertical-align: middle; padding: 1mm;">
                                            <div style="font-size: 14pt; font-weight: bold; text-transform: uppercase; white-space: nowrap; line-height: 1.1;">${distMain}</div>
                                            ${distSub ? `<div style="font-size: 8pt; font-weight: bold; letter-spacing: 0.5px; margin-top: 0.5mm;">${distSub}</div>` : ''}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="text-align: center; vertical-align: middle;">
                                            <div style="font-size: 9pt; font-weight: bold; text-transform: uppercase; margin-bottom: 1mm;">KÖR</div>
                                            <div style="font-size: 19pt; font-weight: bold;">${valodiKorSzam}</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                            <td style="border: 2px solid #000; padding: 1mm; text-align: center; vertical-align: middle; background: #fafafa;">
                                <div style="font-size: 8pt; color: #000000; text-transform: uppercase;">Helyezés</div>
                                <div style="font-size: 20pt; font-weight: bold; margin-bottom: 2mm; white-space: nowrap; line-height: 1.1;">${rankDisplay}</div>
                                <div style="font-size: 8pt; color: #000000; text-transform: uppercase;">Lemaradás</div>
                                <div style="font-size: 10pt; font-weight: bold; margin-top: 1mm; white-space: nowrap;">${gapDisplay}</div>
                            </td>
                            <td style="border: 2px solid #000; padding: 1mm; text-align: center; vertical-align: middle;">
                                <div style="font-size: 8pt; color: #000000; text-transform: uppercase;">PULZUS</div>
                                <div style="font-size: 26pt; font-weight: bold; margin-bottom: 2mm;">${l.pulse || '-'}</div>
                                <div style="font-size: 8pt; color: #000000; text-transform: uppercase;">HRRI</div>
                                <div style="font-size: 16pt; font-weight: bold; margin-top: 1mm;">${l.hrri || '-'}</div>
                            </td>
                            <td style="border: 2px solid #000; padding: 0; vertical-align: top;">
                                <table style="width: 100%; height: 100%; border-collapse: collapse; text-align: center; table-layout: fixed;">
                                    <tr>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000; border-right: 1px solid #000; width: 50%;">
                                            <div style="font-size: 8pt; color: #000000; white-space: nowrap;">Nyálkahártya</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.nyalka || '-'}</div>
                                        </td>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000; width: 50%;">
                                            <div style="font-size: 8pt; color: #000000; white-space: nowrap;">Kapilláris (CRT)</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.crt || '-'}</div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000; border-right: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000; white-space: nowrap;">Vízháztartás</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.vizhaztartas || '-'}</div>
                                        </td>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000; white-space: nowrap;">Bélműködés</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.belhang || '-'}</div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 1.5mm; border-right: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000; white-space: nowrap;">Farizom / Nyereg</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.farizom || '-'}</div>
                                        </td>
                                        <td style="padding: 1.5mm; background: #ffffff;">
                                            <div style="font-size: 8pt; color: #000000;">Mozgás</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.mozgas || '-'}</div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </div>

                <div style="flex: 0 0 auto;">
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                        <tr>
                            <td style="width: 45%; border: 2px solid #000; background: #e0e0e0; padding: 1.5mm; text-align: center;">
                                <div style="font-size: 9pt; text-transform: uppercase;">Kimeneteli idő</div>
                                <div style="font-size: 24pt; font-weight: bold; letter-spacing: 1px; color: #000; line-height: 1.1;">
                                    ${outStr}
                                </div>
                                ${recheckSor}
                            </td>
                            <td style="width: 55%; padding-left: 2mm; vertical-align: middle;">
                                <div style="display: flex; justify-content: space-between; align-items: center; height: 100%;">
                                    <div style="flex: 1; padding-right: 2mm; overflow: hidden;">
                                        <div style="font-size: 10pt; line-height: 1.2; word-wrap: break-word; overflow-wrap: break-word;"><b>Orvos:</b> ${l.vetName || "-"}</div>
                                    </div>
                                    
                                    <div style="width: 42mm; flex-shrink: 0; border: 2px solid #000; background: #f4f4f4; color: #000; padding: 1.5mm; text-align: center; border-radius: 4px;">
                                        <div style="font-size: 7pt; text-transform: uppercase; margin-bottom: 0.5mm;">LÉGY KÉPBEN:</div>
                                        <div style="font-size: 7pt; text-transform: uppercase; margin-bottom: 0.5mm;">KÖVESD ÉLŐBEN!</div>
                                        <div style="font-size: 11pt; font-weight: 900;">end-ride.com</div>
                                        <div style="font-size: 6.5pt; margin-top: 0.5mm; font-style: italic;">Valós idejű állás és részletes adatok.</div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    </table>
                </div>
                
            </div>
        `;

        document.getElementById('print-sticker').innerHTML = html;
        form.style.display = 'block';
    }


    // --- SÖTÉT TÉMÁJÚ ÁLLATORVOSI KARTON (TÖRTÉNET) MODAL ---
    function openVetHistory(bib, silent = false) {
        let comp = null;
        let forras = 'live';   // a FEI orvosi lap nyomtatásához: melyik versenyből jön a versenyző

        // 1. Először keressük az élő versenyzők között (kivéve, ha épp egy múltbéli versenyt nézünk)
        if (!viewingPastRaceData && competitors && competitors.length > 0) {
            comp = competitors.find(c => c.bib == bib);
        }
        
        // 2. Ha nincs meg, akkor keressük a jelenleg megnyitott Múltbéli versenyben!
        // (parseCompetitors-t használjuk, mert a Firebase néha "lyukas" tömbként adja vissza
        // a competitors objektumot, és egy nyers Object.values/Array.isArray simán undefined
        // elemeket is beengedett volna -> emiatt nem nyílt meg a karton egyes versenyzőknél)
        if (!comp && viewingPastRaceData && viewingPastRaceData.competitors) {
            let pastArr = parseCompetitors(viewingPastRaceData.competitors);
            comp = pastArr.find(c => c.bib == bib);
            if (comp) forras = viewingPastRaceData.id;
        }

        if(!comp) {
            if (!silent) showToast("A versenyző orvosi adatai nem találhatók!", true);
            return;
        }

        let columns = [];
        if (comp.preVet && comp.preVet.pulse) {
            columns.push({ title: 'PRE', data: comp.preVet });
        }
        if (comp.laps && comp.laps.length > 0) {
            comp.laps.forEach((lap, i) => {
                if (lap.pulse || lap.vetDecision) {
                    columns.push({ title: `${i+1}. KÖR`, data: lap });
                }
                // A re-check vizsgálat külön oszlop (a re-check ideje és típusa a körnél van)
                if (lap.recheck) {
                    columns.push({ title: `${i+1}. RE-CHECK`, data: Object.assign({}, lap.recheck, { rch: lap.rch, rcm: lap.rcm, rcs: lap.rcs, rcTipus: lap.rcTipus }) });
                }
            });
        }

        if (columns.length === 0) {
            if (!silent) showToast("Még nincs rögzített orvosi adat ehhez a versenyzőhöz.", true);
            return;
        }

        let html = `
            <div data-live-view="vethistory" data-live-bib="${comp.bib}" class="vk-kartya" style="max-width: 850px;">
                <div class="vk-fej">
                    <div class="vk-nev">${comp.bib} | ${escapeHtml(comp.name)}</div>
                    <div class="vk-lo">${escapeHtml(comp.internal || "Ló neve hiányzik")}</div>
                </div>
                <div data-live-scroll class="vk-gorgeto">
                    <table class="vk-tabla" style="font-size:1rem;">
                        <tr>
                            <th style="width:30%;">Szakasz</th>
        `;

        columns.forEach(col => {
            html += `<th>${col.title}</th>`;
        });
        html += `</tr>`;

        const renderVetRowCustom = (label, valFn) => {
            let rowHtml = `<tr><td>${label}</td>`;
            columns.forEach(col => {
                rowHtml += `<td>${valFn(col)}</td>`;
            });
            rowHtml += `</tr>`;
            return rowHtml;
        };

        // 1. SOR: Pulzus idő
        html += renderVetRowCustom('Pulzus idő', col => {
            if (col.title === 'PRE') return '-';
            if (col.data.arrSec > 0 && col.data.vetSec > 0) return toTimeStr(col.data.vetSec - col.data.arrSec);
            return '-';
        });

        // 2. SOR: Pulzus / HRRI (Pre-nél csak a pulzus)
        html += renderVetRowCustom('Pulzus / HRRI', col => {
            let p = formatVetBadge(col.data.pulse);
            if (col.title === 'PRE') return p;
            let h = formatVetBadge(col.data.hrri);
            return `${p} / ${h}`;
        });

        // Klinikai paraméterek
        html += renderVetRowCustom('Nyálkahártya', col => formatVetBadge(col.data.nyalka));
        html += renderVetRowCustom('Kapilláris (CRT)', col => formatVetBadge(col.data.crt));
        html += renderVetRowCustom('Vízháztartás', col => formatVetBadge(col.data.vizhaztartas));
        html += renderVetRowCustom('Bélműködés', col => formatVetBadge(col.data.belhang));
        html += renderVetRowCustom('Farizom, nyereghely', col => formatVetBadge(col.data.farizom));
        html += renderVetRowCustom('Mozgás', col => formatVetBadge(col.data.mozgas));
        html += renderVetRowCustom('Állatorvos', col => escapeHtml(col.data.vetName));
        // Re-check: a FEI lap "Re-Inspection" oszlopa szerint (HR / REQ / COMP) + az időpont.
        html += renderVetRowCustom('Re-check', col => {
            const d = col.data;
            const t = toSec(d.rch, d.rcm, d.rcs);
            const tipus = d.rcTipus && RECHECK_TIPUSOK[d.rcTipus] ? RECHECK_TIPUSOK[d.rcTipus].rovid : '';
            const jel = [tipus, t > 0 ? toTimeStr(t) : ''].filter(Boolean).join(' ');
            return jel ? `<span style="color:var(--warning); font-weight:800;">${escapeHtml(jel)}</span>` : (d.vetDecision && /re-check/i.test(d.vetDecision) ? '<span style="color:var(--warning); font-weight:800;">esedékes</span>' : '-');
        });
        html += renderVetRowCustom('Döntés', col => escapeHtml(vetDontesSzoveg(col.data.vetDecision)));

        html += `
                    </table>
                </div>

                <div class="vk-lab sor">
                    <button class="calc-btn admin-only vk-fei" onclick="printFeiVetCard('${escapeHtml(forras)}', '${escapeHtml(comp.bib)}')">🖨️ FEI orvosi lap</button>
                    <button class="calc-btn vk-bezar" onclick="closeAdatlap()">Bezárás</button>
                </div>
            </div>
        `;

        document.getElementById('modalBody').innerHTML = html;
        document.getElementById('adatlapModal').style.display = 'flex';
    }

    // --- SÖTÉT TÉMÁHOZ IGAZÍTOTT "TELIBE SZÍNEZETT", CSUPA NAGYBETŰS BADGE ---
    function formatVetBadge(val) {
        if (!val || val === '-') return '-';
        
        // Itt alakítjuk át az összes bejövő értéket csupa nagybetűssé (pl. "Tiszta" -> "TISZTA", "a" -> "A")
        let upVal = val.toString().trim().toUpperCase(); 
        
        // Alapértelmezett: Szürke háttér, fekete betű
        let bg = '#999'; 
        let color = '#000'; 
        
        if (['A', 'OK', '1', 'NORMÁL', 'NORMAL', 'TISZTA'].includes(upVal)) { 
            bg = '#32D74B'; color = '#000'; 
        }
        else if (['B', '2', '+', '++', 'ENYHE'].includes(upVal)) { 
            bg = '#FF9F0A'; color = '#000'; 
        }
        else if (['C', 'D', '3', '4', 'KIESETT', 'ELIMINATED', 'NEM TISZTA', 'SÁNTA'].includes(upVal)) { 
            bg = '#FF453A'; color = '#000'; 
        }

        // Itt már a nagybetűs 'upVal'-t íratjuk ki a dobozba!
        return `<div style="background: ${bg}; color: ${color}; border-radius: 8px; padding: 6px 14px; display: inline-block; font-weight: 900; font-size: 1.1rem; min-width: 50px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.4);">${upVal}</div>`;
    }

    function vetDontesSzoveg(d) {
        if (!d) return '-';
        if (d === 'Továbbengedve' || d === 'Passed' || d === 'Active') return 'Továbbengedve';
        if (d === 'RECHECK' || /re-check/i.test(d)) return 'Re-check';
        if (d === 'FNR') return 'Teljesítette (FNR)';
        return getElimText({ isEliminated: true, status: d });
    }

    // ============================================================================
    // FEI ORVOSI LAP (FEI Endurance Vet Gate Card, 2023) - a rögzített orvosi adatokból,
    // a hivatalos FEI lap szerkezetében (fekvő A4). Kérésre nyomtatható, bármelyik idei
    // versenyre visszamenőleg (Versenyáttekintő fül > lovas keresése, vagy az orvosi kartonról).
    // forras: 'live' (élő verseny) vagy egy múltbéli verseny azonosítója.
    // ============================================================================
    function versenyForras(forras) {
        if (forras === 'live') {
            if (!liveRaceMeta) return null;
            return { meta: liveRaceMeta, comps: competitors, config: raceConfig };
        }
        const r = localRaces.mult.find(x => x.id === forras);
        if (!r) return null;
        return { meta: r, comps: parseCompetitors(r.competitors), config: mergeRaceConfig(r.raceConfig) };
    }

    function printFeiVetCard(forras, bib) {
        const v = versenyForras(forras);
        const c = v && v.comps.find(x => String(x.bib) === String(bib));
        if (!c) { showToast('A versenyző nem található ebben a versenyben.', true); return; }
        const rider = ridersCache[sanitizeKey(c.license || '')] || {};
        const horse = horsesCache[sanitizeKey(c.startNum || '')] || {};
        const baseDist = String(c.dist || '').replace('j', '');
        const cfg = v.config[baseDist] || { laps: [] };
        const korSzam = Math.max((cfg.laps || []).length, (c.laps || []).length, 1);
        const e = s => (s === undefined || s === null || s === '') ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const nagy = s => e(String(s || '').trim().toUpperCase());
        const ido = (h, m, s) => (String(h || '') === '' ? '' : `${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:${String(s || 0).padStart(2, '0')}`);
        const percMp = sec => sec > 0 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : '';
        const monogram = nev => String(nev || '').replace(/^dr\.?\s*/i, '').split(/\s+/).filter(Boolean).map(sz => sz[0].toUpperCase() + '.').join('');
        const megfelelt = d => {
            if (!d) return '';
            if (d === 'Továbbengedve' || d === 'Passed' || d === 'Active') return 'PASS';
            if (d === 'FNR') return 'PASS (FNR)';
            if (d === 'RECHECK' || /re-check/i.test(d)) return 'RE-INSP.';
            return 'FAIL ' + e(String(d).replace('FTQ-', ''));
        };
        const reInsp = l => {
            const t = toSec(l.rch, l.rcm, l.rcs);
            const tip = l.rcTipus && RECHECK_TIPUSOK[l.rcTipus] ? RECHECK_TIPUSOK[l.rcTipus].rovid : ((/re-check/i.test(l.vetDecision || '')) ? 'RE-INSP.' : '');
            return [tip, t > 0 ? toTimeStr(t) : ''].filter(Boolean).join(' ');
        };
        // A klinikai cellák a FEI lap oszlopsorrendjében. A "Farizom, nyereghely" nálunk egyetlen
        // érték, ezért a FEI lap két oszlopába (nyereg/hát/mar és izomtónus) is az kerül.
        const klinikai = l => `
            <td>${nagy(l.nyalka)}</td><td>${nagy(l.crt)}</td><td>${nagy(l.vizhaztartas)}</td><td>${nagy(l.belhang)}</td>
            <td>${nagy(l.farizom)}</td><td>${nagy(l.farizom)}</td><td>${nagy(l.mozgas)}</td>
            <td class="megj">${e(l.vetNotes)}</td><td>${e(reInsp(l))}</td><td>${megfelelt(l.vetDecision)}</td><td>${e(monogram(l.vetName))}</td>`;
        const uresKlinikai = `<td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="megj"></td><td></td><td></td><td></td>`;

        let sorok = '';
        const pre = c.preVet || {};
        sorok += `<tr class="blokk-eleje"><th class="szakasz" rowspan="1">FIRST HORSE INSPECTION<br><small>Előzetes vizsgálat</small></th>
            <td></td><td></td><td></td><td>${e(pre.pulse)}</td>${pre.pulse || pre.vetDecision ? klinikai(pre) : uresKlinikai}</tr>`;
        for (let i = 0; i < korSzam; i++) {
            const l = (c.laps || [])[i] || {};
            const vegso = i === korSzam - 1;
            const cim = vegso ? 'FINAL INSPECTION<br><small>Záróvizsgálat</small>' : `VET GATE ${i + 1}<br><small>${i + 1}. kör utáni kapu</small>`;
            const pulzusSec = l.pulzusSec > 0 ? l.pulzusSec : 0;
            const rv = l.recheck ? Object.assign({}, l.recheck, { rch: l.rch, rcm: l.rcm, rcs: l.rcs, rcTipus: l.rcTipus }) : null;
            sorok += `<tr class="blokk-eleje"><th class="szakasz" rowspan="${rv ? 3 : 2}">${cim}</th>
                <td>${e(ido(l.h, l.m, l.s))}</td><td>${e(ido(l.oh, l.om, l.os))}</td><td>${e(percMp(pulzusSec))}</td>
                <td>${e(l.pulse)}</td><td colspan="11" class="sorcimke">RECOVERY / regeneráció - pulzus a bemutatáskor</td></tr>
                <tr><td colspan="3" class="sorcimke">INSPECTION / vizsgálat (CRI = pulzus a felvezetés után)</td><td>${e(l.hrri)}</td>${l.pulse || l.vetDecision ? klinikai(l) : uresKlinikai}</tr>`
                + (rv ? `<tr><td colspan="3" class="sorcimke">RE-INSPECTION / újravizsgálat ${e(ido(l.rch, l.rcm, l.rcs))}</td><td>${e(rv.pulse)}</td>${klinikai(rv)}</tr>` : '');
        }

        const st = c.status || (c.isEliminated ? 'FTQ-ME' : 'Active');
        const kesz = (c.laps || []).filter(l => l && l.isComplete).length >= (cfg.laps || []).length && (cfg.laps || []).length > 0;
        const jel = b => b ? '☒' : '☐';
        const eredmenyek = [
            ['Qualified / Teljesítette', st === 'Active' && kesz],
            ['FTQ (ME)', st === 'FTQ-ME'],
            ['FTQ (GA)', st === 'FTQ-GA'],
            ['FTQ (MI)', st === 'FTQ-MI'],
            ['FTQ (other / egyéb)', /^FTQ-(SP|OT|FTC|SIMUSCO|SIMETA|CI)$/.test(st)],
            ['RET', st === 'RET'],
            ['DSQ', st === 'DSQ'],
            ['FNR', st === 'FNR'],
            ['WD', st === 'WD' || st === 'DNS']
        ];
        const klinikaiKimenet = [
            ['Sent for treatment / kezelésre küldve', false],
            ['Released to travel without further inspection', false],
            ['Minor injury / kisebb sérülés', st === 'FTQ-MI'],
            ['Serious injury / súlyos sérülés', st === 'FTQ-SIMUSCO' || st === 'FTQ-SIMETA'],
            ['Catastrophic injury / végzetes sérülés', st === 'FTQ-CI']
        ];
        const extra = (c.extraCodes || []).length ? ` + ${e(c.extraCodes.join(' + '))}` : '';
        // 83. § (1): a lapon a verseny után rögzíteni kell a megtett távot és a kötelező
        // versenymentes időszakot (140-141. §: a verseny napját követő naptól számít, a következő
        // rajt legkorábban az időszak lejártát követő napon lehet). Az előzmény (ismételt ME/GA) itt
        // csak a saját rendszer versenyeiből számol - a hivatalos Excel exportban a szövetségi is.
        const megtettKm = c.manualEntry ? (c.isEliminated ? 0 : (parseInt(baseDist, 10) || 0)) : getCompletedKm(c, v.config);
        const pihenoNap = pihenonapok(c, v.config, loKorabbiKiesesei(String(c.startNum || '').trim(), v.meta.date, v.meta.id));
        let kovetkezo = '';
        if (pihenoNap > 0 && v.meta.date) {
            const kd = new Date(v.meta.date + 'T00:00:00'); kd.setDate(kd.getDate() + pihenoNap + 1);
            kovetkezo = kd.getFullYear() + '-' + String(kd.getMonth() + 1).padStart(2, '0') + '-' + String(kd.getDate()).padStart(2, '0');
        }

        const html = `<!doctype html><html lang="hu"><head><meta charset="utf-8">
        <title>FEI orvosi lap - ${e(c.name)} - ${e(v.meta.name)}</title>
        <style>
            @page { size: A4 landscape; margin: 7mm; }
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; font-size: 9pt; }
            h1 { font-size: 14pt; margin: 0; letter-spacing: .5px; }
            .fej { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 2mm; margin-bottom: 2mm; }
            .fej small { font-size: 8pt; color: #333; }
            .adatok { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1mm 4mm; margin-bottom: 2mm; }
            .adat { border-bottom: 1px solid #000; padding: .6mm 0; min-height: 6mm; }
            .adat b { display: block; font-size: 6.5pt; text-transform: uppercase; color: #333; }
            .adat span { font-size: 10pt; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; table-layout: fixed; }
            th, td { border: 1px solid #000; padding: .8mm 1mm; text-align: center; vertical-align: middle; font-size: 8.5pt; }
            thead th { background: #e6e6e6; font-size: 6.6pt; line-height: 1.15; }
            th.szakasz { background: #f2f2f2; font-size: 7.5pt; text-align: left; width: 26mm; }
            th.szakasz small { font-weight: normal; font-size: 6.5pt; }
            td.sorcimke { font-size: 6.5pt; color: #444; text-align: left; font-style: italic; }
            td.megj { text-align: left; font-size: 7.5pt; }
            tr.blokk-eleje th, tr.blokk-eleje td { border-top: 2px solid #000; }
            .lab { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 2.5mm; }
            .doboz { border: 1.5px solid #000; padding: 1.5mm 2mm; }
            .doboz b { font-size: 7.5pt; text-transform: uppercase; }
            .doboz .opciok { display: flex; flex-wrap: wrap; gap: 1mm 4mm; margin-top: 1mm; font-size: 8.5pt; }
            .alairas { margin-top: 3mm; border-top: 1px solid #000; width: 70mm; font-size: 7pt; padding-top: .5mm; }
            .lab-jegy { margin-top: 2mm; font-size: 6.5pt; color: #444; }
            @media print { .nem-nyomtat { display: none; } }
        </style></head><body>
        <div class="fej">
            <div><h1>FEI ENDURANCE VET GATE CARD</h1><small>Állatorvosi lap - a FEI 2023-as vet card szerkezetében, a verseny rögzített adataiból</small></div>
            <div style="text-align:right;"><small>Rajtszám / Bib</small><div style="font-size:18pt; font-weight:900;">#${e(c.bib)}</div></div>
        </div>
        <div class="adatok">
            <div class="adat"><b>Horse name / Ló neve</b><span>${e(c.internal) || '&nbsp;'}</span></div>
            <div class="adat"><b>Horse FEI ID / Ló FEI száma</b><span>${e(horse.feiId) || '&nbsp;'}</span></div>
            <div class="adat"><b>Event / Verseny</b><span>${e(v.meta.name)}</span></div>
            <div class="adat"><b>Date and venue / Dátum, helyszín</b><span>${e(v.meta.date)} ${e(v.meta.loc)}</span></div>
            <div class="adat"><b>Athlete name / Lovas</b><span>${e(c.name)}</span></div>
            <div class="adat"><b>Athlete FEI ID / Lovas FEI száma</b><span>${e(rider.feiId) || '&nbsp;'}</span></div>
            <div class="adat"><b>Distance / Táv · Licence</b><span>${e(catNames[c.dist] || c.dist)}${c.license ? ' · ' + e(c.license) : ''}</span></div>
            <div class="adat"><b>Trainer / Edző</b><span>${e(rider.coach) || '&nbsp;'}</span></div>
        </div>
        <table>
            <thead><tr>
                <th class="szakasz">Inspection<br>Vizsgálat</th>
                <th>Arrival time<br>Beérkezés</th><th>Time into vet<br>Orvosi idő</th><th>Recovery<br>(min:mp)</th>
                <th>Heart rate<br>bpm</th><th>Mucous membr.<br>A-D</th><th>Capillary refill<br>1-4</th><th>Skin turgor<br>1-4</th>
                <th>Gut sounds<br>A-D</th><th>Girth / back / withers<br>A-C</th><th>Muscle tone<br>A-C</th><th>Gait<br>A-C</th>
                <th>Remarks<br>Megjegyzés</th><th>Re-Inspection<br>HR / REQ / COMP</th><th>Pass / Fail</th><th>Vet.<br>initials</th>
            </tr></thead>
            <tbody>${sorok}</tbody>
        </table>
        <div class="lab">
            <div class="doboz"><b>Ride result / Végeredmény</b>
                <div class="opciok">${eredmenyek.map(([n, b]) => `<span>${jel(b)} ${n}</span>`).join('')}</div>
                ${extra ? `<div style="margin-top:1mm; font-size:8pt;">Kombinált kódok: ${extra}</div>` : ''}
                <div class="alairas">Vet. signature / Állatorvos aláírása</div>
            </div>
            <div class="doboz"><b>Clinical outcome / Klinikai kimenet</b>
                <div class="opciok">${klinikaiKimenet.map(([n, b]) => `<span>${jel(b)} ${n}</span>`).join('')}</div>
            </div>
        </div>
        <div class="doboz" style="margin-top:2.5mm;"><b>Megtett táv / Distance completed:</b> ${megtettKm ? String(megtettKm).replace('.', ',') + ' km' : '-'}
            &nbsp;·&nbsp; <b>Kötelező versenymentes időszak / Mandatory rest period (140. §):</b> ${pihenoNap} nap${kovetkezo ? ` &nbsp;·&nbsp; legkorábbi következő rajt: <b>${kovetkezo}</b>` : ''}</div>
        <div class="lab-jegy">A "Farizom, nyereghely" értékelés a rendszerben egyetlen érték, ezért a "Girth/back/withers" és a "Muscle tone" oszlopba is az kerül.
            Re-Inspection: HR = pulzus miatt újra bemutatva (100. §), REQ = az orvos kérte (92. § (4)), COMP = kötelező (92. § (3), 101. §).
            Kinyomtatva: ${new Date().toLocaleString('hu-HU')}</div>
        <script>window.onload = function () { window.print(); };<\/script>
        </body></html>`;

        const win = window.open('', '_blank');
        if (!win) { showToast('A böngésző letiltotta a felugró ablakot - engedélyezd a nyomtatáshoz.', true); return; }
        win.document.write(html);
        win.document.close();
    }

    function escapeHtml(unsafe) {
        if(!unsafe || unsafe === '-') return '-';
        return unsafe.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- FŐ ÉLŐ VERSENY FUNKCIÓK ---
    function updateStatusLabel(toggleId, labelId) {
        const toggle = document.getElementById(toggleId);
        const label = document.getElementById(labelId);
        if (toggle.checked) {
            label.innerText = (labelId === 'orvStatusLabel') ? "Továbbengedve" : "Versenyben";
            label.style.color = 'var(--success)';
        } else {
            label.innerText = (labelId === 'orvStatusLabel') ? "Eliminated (Kiesett)" : "Kiesett";
            label.style.color = 'var(--danger)';
        }
    }

    function changeLapCount(dist, count) { kiirasKorszamValtas('', dist, count); }

    function renderKiiras() {
        const cont = document.getElementById('kiirasContainer');
        if (!cont) return;
        cont.innerHTML = DIST_ORDER.filter(d => raceConfig[d]).map(d => kiirasTavBlokkHtml(d, raceConfig[d], '')).join('');
    }

    function updateRaceConfig(dist, field, val) { kiirasMezo('', dist, field, null, val); }
    function updateRaceLap(dist, idx, val) { kiirasMezo('', dist, 'lap', idx, val); }

    // Élő kiírás mentése - verseny közben is: a pihenőidő vagy körtáv módosítása után minden
    // versenyző kiindulási idejét újraszámoljuk (l. versenyzokUjraszamolasa).
    function saveKiiras() {
        const hibak = kiirasHibak(raceConfig);
        if (hibak.length) { showToast(hibak[0], true); return; }
        db.ref('raceConfig').set(raceConfig).then(() => {
            showAnimatedBtn('saveKiirasBtn');
            showToast('Kiírás sikeresen mentve!');
            return versenyzokUjraszamolasa('competitors', competitors, raceConfig);
        }).catch(e => showToast('Hiba a mentéskor: ' + e.message, true));
    }

    // --- BEÁLLÍTÁSOK FÜL: design téma választó (kártyák) ---
    // A téma SZEMÉLYES beállítás: csak ezen az eszközön érvényes, nem írja
    // felül másokét. Az admin által beállított téma marad az alapértelmezés
    // (settings/uiTheme) mindenkinek, aki még nem választott magának.
    function setUiTheme(key) {
        uiTheme = applyTheme(key);
        localStorage.setItem('uiTheme', uiTheme);
        localStorage.setItem('uiThemeSajat', '1');
        renderThemeSwatches();
        showToast('Téma beállítva (csak ezen az eszközön).');
    }

    // Visszatérés a verseny közös témájához.
    function resetUiTheme() {
        localStorage.removeItem('uiThemeSajat');
        db.ref('settings/uiTheme').once('value').then(snap => {
            uiTheme = applyTheme(snap.val() || 'default');
            localStorage.setItem('uiTheme', uiTheme);
            renderThemeSwatches();
            showToast('Visszaálltál a verseny közös témájára.');
        }).catch(() => {});
    }

    // Csak adminnak: az alapértelmezett témát állítja mindenkinek, aki nem
    // választott magának sajátot.
    function setKozosUiTheme(key) {
        db.ref('settings/uiTheme').set(key)
            .then(() => showToast('Közös téma beállítva mindenkinek.'))
            .catch(e => showToast('Hiba: ' + e.message, true));
    }

    function temaSwatchHtml(t, aktiv, fn) {
        return `
            <div class="theme-swatch ${aktiv ? 'active' : ''}" onclick="${fn}('${t.key}')">
                <div class="theme-swatch-preview" style="background:linear-gradient(135deg, ${t.colors[1]} 0%, ${t.colors[2]} 100%);"><div class="dot" style="background:${t.colors[0]}; color:${t.colors[0]};"></div></div>
                <div class="theme-swatch-label">${t.label}</div>
                <div class="theme-swatch-check">✓ Aktív</div>
            </div>`;
    }

    function renderThemeSwatches() {
        const cont = document.getElementById('themeSwatchRow');
        if (cont) {
            cont.innerHTML = THEME_LIST
                .map(t => temaSwatchHtml(t, uiTheme === t.key, 'setUiTheme')).join('');
        }
        // Admin: a közös alapértelmezett téma külön sorban
        const kozos = document.getElementById('kozosThemeSwatchRow');
        if (kozos) {
            db.ref('settings/uiTheme').once('value').then(snap => {
                const kozosKulcs = ervenyesTemaKulcs(snap.val() || 'default');
                kozos.innerHTML = THEME_LIST
                    .map(t => temaSwatchHtml(t, kozosKulcs === t.key, 'setKozosUiTheme')).join('');
            }).catch(() => {});
        }
    }

    // --- BEÁLLÍTÁSOK FÜL: sebesség min/max távonként ---
    function saveSpeedThreshold(dist, kind, val) {
        const num = val === '' ? null : parseFloat(val);
        db.ref('settings/speedThresholds/' + dist + '/' + kind).set(isNaN(num) ? null : num)
            .catch(e => showToast('Hiba: ' + e.message, true));
    }

    function renderSpeedThresholds() {
        const cont = document.getElementById('speedThresholdContainer');
        if (!cont) return;
        const dists = ALL_CATS.slice().reverse();
        let html = `<div class="speed-threshold-head"><span>Táv</span><span>Minimum</span><span>Maximum</span></div>`;
        dists.forEach(d => {
            const t = speedThresholds[d] || {};
            html += `
            <div class="speed-threshold-row">
                <div class="std-label">${catNames[d]}</div>
                <input type="number" step="0.1" placeholder="—" value="${t.min ?? ''}" onchange="saveSpeedThreshold('${d}','min', this.value)">
                <input type="number" step="0.1" placeholder="—" value="${t.max ?? ''}" onchange="saveSpeedThreshold('${d}','max', this.value)">
            </div>`;
        });
        cont.innerHTML = html;
    }

    function editCompetitor(bib) {
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;
        document.getElementById('regBib').value = comp.bib;
        document.getElementById('regName').value = comp.name;
        document.getElementById('regStartNum').value = comp.startNum || '';
        document.getElementById('regLicense').value = comp.license || '';
        document.getElementById('regClub').value = comp.club || '';
        document.getElementById('regDist').value = comp.dist;
        document.getElementById('regInternal').value = comp.internal || '';
        editingBib = comp.bib; 
        document.getElementById('addCompBtn').innerText = "Mentés";
        document.getElementById('cancelEditBtn').style.display = "block";
        document.getElementById('deleteCompBtn').style.display = "block";
        document.getElementById('versenyzok').scrollIntoView({ behavior: "smooth" });
    }

    function cancelEdit() {
        editingBib = null;
        document.getElementById('regBib').value = '';
        document.getElementById('regName').value = '';
        document.getElementById('regStartNum').value = '';
        document.getElementById('regLicense').value = '';
        document.getElementById('regClub').value = '';
        document.getElementById('regInternal').value = '';
        document.getElementById('addCompBtn').innerText = "Hozzáadás";
        document.getElementById('cancelEditBtn').style.display = "none";
        document.getElementById('deleteCompBtn').style.display = "none";
    }

    function saveCompetitor() {
        const mezok = nevezesMezok('');
        if (!mezok.bib || !mezok.name) { showToast("Név és rajtszám kötelező!", true); return; }
        // Ütközésbiztos mentés (l. versenyzoMentes): foglalt rajtszámra nem ír - korábban az új
        // versenyző itt még a régi köreit és eredményét is megörökölte.
        versenyzoMentes({
            ut: 'competitors/', comps: competitors, szerkesztettBib: editingBib,
            mezok, gombId: 'addCompBtn', utana: cancelEdit
        });
    }

    function deleteCompetitor() {
        if (!editingBib) return;
        showConfirm("Élő versenyző törlése", "Biztosan törölni szeretnéd az élő versenyből?", () => {
            db.ref('competitors/' + editingBib).remove().then(() => {
                cancelEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }

    function updateCompetitorDisplays() {
        const list = document.getElementById('competitorList'); list.innerHTML = '';
        const sel = document.getElementById('selectCompetitor');
        const selBk = document.getElementById('sel-beerkeztetes');
        const selOrvIdo = document.getElementById('sel-orvosi-ido');
        const selOrv = document.getElementById('sel-orvosi');
        const selNyom = document.getElementById('sel-nyomtatas');

        const currentSelected = sel.value;
        const currBk = selBk ? selBk.value : "";
        const currOrvIdo = selOrvIdo ? selOrvIdo.value : "";
        const currOrv = selOrv ? selOrv.value : "";
        const currNyom = selNyom ? selNyom.value : "";

        const optBase = '<option value="">-- Válassz versenyzőt --</option>';
        sel.innerHTML = optBase;
        if(selBk) selBk.innerHTML = optBase;
        if(selOrvIdo) selOrvIdo.innerHTML = optBase;
        if(selOrv) selOrv.innerHTML = optBase;
        if(selNyom) selNyom.innerHTML = optBase;

        competitors.sort((a,b) => parseInt(a.bib) - parseInt(b.bib)).forEach(c => {
            list.innerHTML += `<div class="competitor-item">
                <div style="flex:1; cursor:pointer;" onclick="switchSubMode('verseny', document.getElementById('btn-verseny')); document.getElementById('selectCompetitor').value='${c.bib}'; loadCompetitorData();">
                    <span class="competitor-bib">#${c.bib}</span> ${c.name} <b style="color:var(--primary); margin-left:10px;">${catNames[c.dist]}</b>
                </div>
                <div style="display:flex; gap:5px;">
                    <button class="edit-btn admin-only" onclick="editCompetitor('${c.bib}')">Módosítás</button>
                    <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteCompetitorDirect('${c.bib}')">Törlés</button>
                </div>
            </div>`;
            const opt = `<option value="${c.bib}">#${c.bib} - ${c.name} (${catNames[c.dist]})</option>`;
            sel.innerHTML += opt;
            if(selBk) selBk.innerHTML += opt;
            if(selOrvIdo) selOrvIdo.innerHTML += opt;
            if(selOrv) selOrv.innerHTML += opt;
            if(selNyom) selNyom.innerHTML += opt;
        });

        if(currentSelected) sel.value = currentSelected;
        if(currBk && selBk) selBk.value = currBk;
        if(currOrvIdo && selOrvIdo) selOrvIdo.value = currOrvIdo;
        if(currOrv && selOrv) selOrv.value = currOrv;
        if(currNyom && selNyom) selNyom.value = currNyom;
    }

    function deleteCompetitorDirect(bib) {
        showConfirm("Élő versenyző törlése", "Biztosan törölni szeretnéd az élő versenyből?", () => {
            db.ref('competitors/' + bib).remove().then(() => {
                if (editingBib === bib) cancelEdit();
            }).catch(e => showToast("Hiba a törléskor: " + e.message, true));
        });
    }

    function loadCompetitorData() {
        const bib = document.getElementById('selectCompetitor').value;
        const formCont = document.getElementById('verseny-form-container');
        if (!bib) {
            formCont.style.display = 'none';
            document.querySelectorAll('#verseny-form-container input').forEach(i => i.value = '');
            document.getElementById('res2').style.display = 'none';
            return;
        }
        formCont.style.display = 'block';

        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        document.getElementById('totalDist').value = comp.dist;
        autoSetLaps('lapCount', 'totalDist', 'lapInputsContainer', 'v', false);

        // --- HIBATŰRŐ STÁTUSZ BEÁLLÍTÁS ---
        let s = comp.status || (comp.isEliminated ? 'FTQ-ME' : 'Active');
        if (s === 'Passed') s = 'Active';
        if (s === 'Kiesett' || s === 'Eliminated') s = 'FTQ-ME';
        if (s === 'Visszalépett' || s === 'Retired' || s === 'DNS') s = 'WD';
        let sel = document.getElementById('compStatusSelect');
        if (sel) {
            let exists = Array.from(sel.options).some(opt => opt.value === s);
            sel.value = exists ? s : 'Active';
        }
        // ----------------------------------

        const baseDist = comp.dist.replace('j', '');
        const cfg = raceConfig[baseDist] || { h:'', m:'', s:'', laps:[] };

        // HIÁNYZÓ IDŐK PÓTLÁSA A VERSENYKIÍRÁSBÓL
        if (comp.startTime && comp.startTime.h !== undefined && comp.startTime.h !== '') {
            document.getElementById('vhR').value = comp.startTime.h;
            document.getElementById('vmR').value = comp.startTime.m || '00';
            document.getElementById('vsR').value = comp.startTime.s || '00';
        } else {
            document.getElementById('vhR').value = cfg.h || '';
            document.getElementById('vmR').value = cfg.m || '';
            document.getElementById('vsR').value = cfg.s || '';
        }

        // A körtávakat a versenykiírásból töltjük, ha a versenyzőnél még
        // nincs saját érték - korábban üresen maradtak, és a kalkuláció
        // nem tudott mit kezdeni velük.
        const cfgLaps = cfg.laps || [];
        const lapsArr = comp.laps || [];
        for (let i = 0; i < cfgLaps.length; i++) {
            const idx = i + 1;
            const mezoD = document.getElementById(`vd${idx}`);
            if (!mezoD) continue;
            const l = lapsArr[i] || {};
            mezoD.value = l.d || cfgLaps[i] || '';
            document.getElementById(`vh${idx}`).value = l.h || ''; document.getElementById(`vm${idx}`).value = l.m || ''; document.getElementById(`vs${idx}`).value = l.s || '';
            document.getElementById(`voh${idx}`).value = l.oh || ''; document.getElementById(`vom${idx}`).value = l.om || ''; document.getElementById(`vos${idx}`).value = l.os || '';
        }
        
        setFormDirty('verseny-form-container', false); // frissen betöltve: nincs mentetlen módosítás
        calcVerseny(false);
    }

    function loadRmCompetitorData() {
        const bib = document.getElementById('rm-selectCompetitor').value;
        const formCont = document.getElementById('rm-verseny-form-container');
        if (!bib) {
            formCont.style.display = 'none';
            document.querySelectorAll('#rm-verseny-form-container input').forEach(i => i.value = '');
            document.getElementById('rm-res2').style.display = 'none';
            return;
        }
        formCont.style.display = 'block';
        
        const comp = modalCompetitors.find(c => c.bib == bib);
        if(!comp) return;

        document.getElementById('rm-totalDist').value = comp.dist;
        autoSetLaps('rm-lapCount', 'rm-totalDist', 'rm-lapInputsContainer', 'rm-v', true);

        // --- HIBATŰRŐ STÁTUSZ BEÁLLÍTÁS ---
        let s = comp.status || (comp.isEliminated ? 'FTQ-ME' : 'Active');
        if (s === 'Passed') s = 'Active';
        if (s === 'Kiesett' || s === 'Eliminated') s = 'FTQ-ME';
        if (s === 'Visszalépett' || s === 'Retired' || s === 'DNS') s = 'WD';
        let sel = document.getElementById('rm-compStatusSelect');
        if (sel) {
            let exists = Array.from(sel.options).some(opt => opt.value === s);
            sel.value = exists ? s : 'Active';
        }
        // ----------------------------------

        const baseDist = comp.dist.replace('j', '');
        const cfg = modalRaceConfig[baseDist] || { h:'', m:'', s:'', laps:[] };
        
        // HIÁNYZÓ IDŐK PÓTLÁSA A VERSENYKIÍRÁSBÓL
        if (comp.startTime && comp.startTime.h !== undefined && comp.startTime.h !== '') {
            document.getElementById('rm-vhR').value = comp.startTime.h;
            document.getElementById('rm-vmR').value = comp.startTime.m || '00';
            document.getElementById('rm-vsR').value = comp.startTime.s || '00';
        } else {
            document.getElementById('rm-vhR').value = cfg.h || '';
            document.getElementById('rm-vmR').value = cfg.m || '';
            document.getElementById('rm-vsR').value = cfg.s || '';
        }

        const lapsArr = comp.laps || [];
        lapsArr.forEach((l, i) => {
            const idx = i + 1;
            if(document.getElementById(`rm-vd${idx}`)) {
                if(l.d) document.getElementById(`rm-vd${idx}`).value = l.d;
                document.getElementById(`rm-vh${idx}`).value = l.h || ''; document.getElementById(`rm-vm${idx}`).value = l.m || ''; document.getElementById(`rm-vs${idx}`).value = l.s || '';
                document.getElementById(`rm-voh${idx}`).value = l.oh || ''; document.getElementById(`rm-vom${idx}`).value = l.om || ''; document.getElementById(`rm-vos${idx}`).value = l.os || '';
            }
        });
        
        calcRmVerseny(false);
    }
 
 
    function calcVerseny(saveToDb = true) {
        const count = parseInt(document.getElementById('lapCount').value);
        const bib = document.getElementById('selectCompetitor').value;
        const rajt = toSec(document.getElementById('vhR').value, document.getElementById('vmR').value, document.getElementById('vsR').value);

        // Előbb minden mezőt beolvasunk a DOM-ból, hogy a lenti tranzakció retry-jai (ha kellenek)
        // ugyanazokat az értékeket alkalmazzák, bármelyik "comp" objektumon hívjuk is meg.
        const startTime = { h: document.getElementById('vhR').value, m: document.getElementById('vmR').value, s: document.getElementById('vsR').value };
        const statusVal = document.getElementById('compStatusSelect').value;
        const distVal = document.getElementById('totalDist').value;
        const lapValues = [];
        for (let i = 0; i < count; i++) {
            lapValues.push({
                d: document.getElementById(`vd${i+1}`).value,
                h: document.getElementById(`vh${i+1}`).value,
                m: document.getElementById(`vm${i+1}`).value,
                s: document.getElementById(`vs${i+1}`).value,
                oh: document.getElementById(`voh${i+1}`).value,
                om: document.getElementById(`vom${i+1}`).value,
                os: document.getElementById(`vos${i+1}`).value,
            });
        }
        function applyForm(target) {
            // A TÁV is a form része. Enélkül a "Teljes verseny" nézetben
            // elvégzett távváltás soha nem mentődött el (a totalDist onchange
            // csak a körmezőket rajzolta újra), így a versenyző a régi távján
            // maradt, és a kalkuláció a régi kiírás köreivel/rajtidejével ment.
            target.dist = distVal;
            // A saját rajtidőt CSAK akkor mentjük, ha eltér a versenykiírástól.
            // Enélkül az első mentéskor "befagyott" a kiírásból betöltött idő,
            // és a versenyző később nem követte a kiírás módosítását. Így a
            // versenyző alapból a kiírást követi, és csak a tudatosan megadott
            // egyedi rajtidő (pl. késve induló lovas) marad meg.
            const cfgTav = raceConfig[String(distVal).replace('j', '')] || {};
            const egyezikAKiirassal =
                String(startTime.h || '') === String(cfgTav.h || '') &&
                String(startTime.m || '') === String(cfgTav.m || '') &&
                String(startTime.s || '') === String(cfgTav.s || '');
            if (egyezikAKiirassal) {
                delete target.startTime;
            } else {
                target.startTime = startTime;
            }
            target.status = statusVal;
            // A RECHECK nem kiesés: a ló versenyben van, csak újra be kell mutatni. Az FNR sem:
            // teljesítette, csak helyezést nem kap (II. melléklet).
            target.isEliminated = !['Active', 'RECHECK', 'FNR'].includes(statusVal);
            lapValues.forEach((lv, i) => {
                if (!target.laps) target.laps = [];
                if (!target.laps[i]) target.laps[i] = {};
                Object.assign(target.laps[i], lv);
            });
            // Rövidebb távra váltáskor (pl. 40 km -> 20 km) a régi, immár nem
            // létező körök adata ottmaradt a laps tömbben, és a kalkuláció
            // számolt is velük - ettől jöttek a hibás összesítések.
            if (target.laps && target.laps.length > count) {
                target.laps = target.laps.slice(0, count);
            }
            return target;
        }

        let comp = competitors.find(c => c.bib == bib);
        if (comp) applyForm(comp);

        if(rajt === 0) { document.getElementById('res2').style.display='none'; return; }

        // Futtatjuk a közös kalkulátort
        comp = recalcCompetitorData(comp, raceConfig);

        let html = "";
        if (comp._timeWarnings && comp._timeWarnings.length) {
            html += `<div class="warning-banner level-warn"><span class="wb-icon">⚠️</span><span>Egy vagy több beírt idő szokatlanul távolinak tűnik az előzőhöz képest — ellenőrizd, nem gépeltél-e el egy számjegyet, mielőtt mented.</span></div>`;
        }
        let countLaps = comp.laps.length;
        for(let i=0; i<countLaps; i++) {
            let l = comp.laps[i];
            if(!l.isComplete) continue;
            let loopColor = l.loopSpd >= 16 ? 'var(--warning)' : 'var(--success)';
            let phaseColor = l.phaseSpd >= 16 ? 'var(--warning)' : 'var(--success)';
            let isFinalLap = (i === countLaps - 1);

            html += `<div class="plan-box" style="border-left-color:${loopColor}">
                <span class="plan-header" style="color:${loopColor}">${i+1}. KÖR</span>
                <div class="plan-data-row"><span class="plan-data-label">Kör idő:</span> <b style="color:var(--text);">${toTimeStr(l.loopSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Beérkezés:</span> <b style="color:var(--text);">${toTimeStr(l.arrSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Átlag:</span> <b style="color:${loopColor}">${l.loopSpd.toFixed(2)} km/h</b></div>
                ${l.vetSec > 0 ? `
                <div style="margin-top:6px; border-top:1px dashed var(--border); padding-top:6px;"></div>
                <div class="plan-data-row"><span class="plan-data-label">Orvosi idő:</span> <b style="color:var(--text);">${toTimeStr(isFinalLap ? (l.loopSec + l.pulzusSec) : l.phaseSec)}</b></div>
                ${!isFinalLap ? `<div class="plan-data-row"><span class="plan-data-label">Orvosi átlag:</span> <b style="color:${phaseColor}">${l.phaseSpd.toFixed(2)} km/h</b></div>` : ''}
                <div class="plan-data-row"><span class="plan-data-label">Pulzus idő:</span> <b style="color:var(--primary);">${toTimeStr(l.pulzusSec)}</b></div>
                ` : ""}
            </div>`;
        }

        if (comp.laps && comp.laps.length > 0 && comp.laps[0].isComplete) {
            let lastComplete = comp.laps.slice().reverse().find(x => x.isComplete);
            if(lastComplete) {
                let hasSpeeding = comp.laps.some(l => l.isComplete && (l.loopSpd >= 16 || l.phaseSpd >= 16));
                let avgColor = (hasSpeeding || lastComplete.rideSpd >= 16) ? 'var(--warning)' : 'var(--success)';
                let totalTime = ((comp.dist === "20" || comp.dist === "20j") && lastComplete.vetSec > 0) ? (lastComplete.loopSec + lastComplete.pulzusSec) : lastComplete.rideTime;
                html += `<div class="summary-total">
                    <strong style="color:var(--primary); font-size:1.1rem; display:block; margin-bottom:8px;">Összesített statisztika</strong>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:var(--text);">${toTimeStr(totalTime)}</b></div>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. átlagsebesség:</span> <b style="font-size:1.3rem; color:${avgColor}">${lastComplete.rideSpd.toFixed(2)} km/h</b></div>
                </div>`;
            }
        }
        document.getElementById('res2').style.display='block'; document.getElementById('res2').innerHTML = html;

        if (saveToDb && comp) {
            db.ref('competitors/' + comp.bib).transaction(currentComp => {
                if (!currentComp) return currentComp;
                const result = recalcCompetitorData(applyForm(currentComp), raceConfig);
                delete result._timeWarnings; // ideiglenes, kijelzésre való - nem mentjük el
                return result;
            });
            setFormDirty('verseny-form-container', false); // elmentve -> jöhet megint az élő frissítés
            showAnimatedBtn('btn-kiertel-mentes');
        }
    }
    // --- ALAPOK ÉS SEGÉDFÜGGVÉNYEK ---
    function jump(c, n) { if (c.value.length >= 2) { const e = document.getElementById(n); if(e) e.focus(); } }

    // --- ÉLŐ PANELEK: MENTETLEN MÓDOSÍTÁS (l. a formDirty megjegyzését fent) ---
    function setFormDirty(formId, dirty) { formDirty[formId] = !!dirty; }
    function isFormDirty(formId) { return !!formDirty[formId]; }
    // Egy elemhez tartozó élő űrlapot jelöli módosítottnak. Azért kell külön hívni a
    // "Most" gombnál is, mert az programból írja a mezőket, a programból állított
    // .value pedig nem vált ki input eseményt.
    function markFormDirtyFor(el) {
        if (!el) return;
        ELO_FORMOK.forEach(id => {
            const f = document.getElementById(id);
            if (f && f.contains(el)) formDirty[id] = true;
        });
    }
    // Gépelés / választás az űrlapon belül -> mentetlen módosítás.
    ['input', 'change'].forEach(ev => document.addEventListener(ev, e => markFormDirtyFor(e.target), true));
    
    document.addEventListener('keydown', function(e) {
        if (e.target.tagName.toLowerCase() === 'input') {
            const elements = Array.from(document.querySelectorAll('input, select, button.calc-btn'))
                .filter(el => el.offsetWidth > 0 && !el.id.startsWith('vd') && !el.id.startsWith('td') && el.id !== 'loginUser' && el.id !== 'loginPass');
            const index = elements.indexOf(e.target);
            if (e.key === 'Enter') {
                if (e.target.id === 'loginUser' || e.target.id === 'loginPass') return; 
                e.preventDefault();
                if (index > -1 && index < elements.length - 1) elements[index + 1].focus();
            }
            else if (e.key === 'Backspace' && e.target.value === '') {
                if (e.target.id === 'loginUser' || e.target.id === 'loginPass') return; 
                e.preventDefault();
                if (index > 0) elements[index - 1].focus(); 
            }
        }
    });

    function toSec(h, m, s) { return (parseInt(h) || 0) * 3600 + (parseInt(m) || 0) * 60 + (parseInt(s) || 0); }
    function toTimeStr(s) {
        if(s<=0) return '-';
        const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sc = s % 60;
        return (h>0 ? h+":" : "0:") + String(m).padStart(2, '0') + ":" + String(sc).padStart(2, '0');
    }

    // --- SZABÁLYMEGFELELÉSI FIGYELMEZTETÉSEK (audit P0/3, P0/4, P0/5) ---
    // Ezek kizárólag vizuális jelzések a beérkeztető/orvos felé; a döntést (LP, recheck, FTQ-SP)
    // mindig az orvos/bíró hozza meg, a rendszer nem állít be automatikusan státuszt.
    function renderWarningBanner(containerId, warningObj) {
        const cont = document.getElementById(containerId);
        if (!cont) return;
        if (!warningObj) { cont.innerHTML = ''; return; }
        const icon = warningObj.level === 'danger' ? '🚨' : (warningObj.level === 'warn' ? '⚠️' : '✅');
        cont.innerHTML = `<div class="warning-banner level-${warningObj.level}"><span class="wb-icon">${icon}</span><span>${warningObj.text}</span></div>`;
    }

    // 97. § (2): normál körnél max 15, célban max 20 perc regenerációs (pulzus) idő -> LP javaslat felette.
    // 101. §: 10 percnél hosszabb pulzusidő esetén a következő kör előtt kötelező ismételt állatorvosi vizsgálat.
    // Bemutatási idő (97. § (2)): körök után 15, a célba érkezés után 20 perc. A 20 km-es
    // túraversenyen (21/A. § (2)) a cél után 30 perc áll rendelkezésre.
    function getRecoveryWarning(arrSec, vetSec, isFinalLap, dist) {
        if (!(arrSec > 0) || !(vetSec > 0)) return null;
        const roll = resolveRollover(vetSec - arrSec);
        if (roll.suspicious) {
            return { level: 'warn', text: `Pulzusidő: ${toTimeStr(roll.diff)} — szokatlanul távolinak tűnik az előző eseményhez képest. Ellenőrizd, nem gépeltél-e el egy számjegyet, mielőtt mented.` };
        }
        let rec = roll.diff;
        const tura20 = dist === '20' || dist === '20j';
        const limitMin = isFinalLap ? (tura20 ? 30 : 20) : 15;
        const limitSec = limitMin * 60;
        if (rec > limitSec) {
            return { level: 'danger', text: `Pulzusidő: ${toTimeStr(rec)} — túllépte a ${limitMin} perces limitet (${tura20 && isFinalLap ? '21/A. § (2)' : '97. § (2)'}). Kizárás regenerációs idő túllépése miatt: DSQ + LP kód (103. §).` };
        }
        if (rec > 600 && !isFinalLap) {
            return { level: 'warn', text: `Pulzusidő: ${toTimeStr(rec)} — 10 percnél hosszabb, a következő kör előtt kötelező ismételt állatorvosi vizsgálat (101. §).` };
        }
        return { level: 'ok', text: `Pulzusidő: ${toTimeStr(rec)} — rendben.` };
    }

    // 97. § (2): max. 64/perc pulzushatár.
    function checkPulseWarning() {
        const input = document.getElementById('orv-pulse');
        const cont = document.getElementById('orv-pulse-warning');
        if (!input || !cont) return;
        const val = parseFloat((input.value || '').replace(',', '.'));
        if (isNaN(val)) { cont.innerHTML = ''; return; }
        if (val > 64) {
            cont.innerHTML = `<div class="warning-banner level-danger" style="margin-top:8px; font-size:0.75rem; padding:8px 10px;"><span class="wb-icon">🚨</span><span>64 felett! (97. § (2)) Max. 2 bemutatás engedélyezett (100. §).</span></div>`;
        } else {
            cont.innerHTML = '';
        }
    }

    // Orvosi Idő (Vet gate) képernyő: élőben mutatja a pulzusidőt, ahogy gépelik.
    function checkOrvosiIdoRecovery() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const comp = competitors.find(c => c.bib == bib);
        if (!comp) { renderWarningBanner('orv-ido-recovery-warning', null); return; }

        const idx = urlapKor('orvosi-ido-form', comp);
        const l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        const arrSec = toSec(l.h, l.m, l.s);
        const vetSec = toSec(document.getElementById('bk-v-h').value, document.getElementById('bk-v-m').value, document.getElementById('bk-v-s').value);

        const baseDist = comp.dist.replace('j', '');
        const cfg = raceConfig[baseDist] || { laps: [] };
        const expectedLaps = cfg.laps ? cfg.laps.length : 1;
        const isFinalLap = (idx === expectedLaps - 1);

        renderWarningBanner('orv-ido-recovery-warning', getRecoveryWarning(arrSec, vetSec, isFinalLap, comp.dist));
    }

    // Beérkeztetés képernyő: élőben megbecsüli a kör átlagsebességét, ahogy az időt gépelik.
    // 139. § (2): a sebességhatárt egyetlen kör sem lépheti túl.
    function checkBeerkeztetesSpeed() {
        const cont = document.getElementById('bk-speed-warning');
        if (!cont) return;

        const bib = document.getElementById('sel-beerkeztetes').value;
        const comp = competitors.find(c => c.bib == bib);
        if (!comp) { cont.innerHTML = ''; return; }

        const baseDist = comp.dist.replace('j', '');
        const idx = urlapKor('beerkeztetes-form', comp);
        const cfg = raceConfig[baseDist] || { laps: [] };
        const savedLap = comp.laps && comp.laps[idx];
        const lapDist = parseFloat((savedLap && savedLap.d) || (cfg.laps && cfg.laps[idx]) || 0);

        let startSec;
        if (idx === 0) {
            startSec = toSec(
                comp.startTime && comp.startTime.h !== "" ? comp.startTime.h : cfg.h,
                comp.startTime && comp.startTime.m !== "" ? comp.startTime.m : cfg.m,
                comp.startTime && comp.startTime.s !== "" ? comp.startTime.s : cfg.s
            );
        } else {
            const prev = comp.laps && comp.laps[idx - 1];
            startSec = prev ? prev.nextStart : 0;
        }

        const arrSec = toSec(document.getElementById('bk-h').value, document.getElementById('bk-m').value, document.getElementById('bk-s').value);
        if (!(startSec > 0) || !(arrSec > 0) || !(lapDist > 0)) { cont.innerHTML = ''; return; }

        // A gyanús-idő ellenőrzés attól függetlenül fusson, hogy van-e beállítva sebességküszöb erre a távra.
        const roll = resolveRollover(arrSec - startSec);
        if (roll.suspicious) {
            cont.innerHTML = `<div class="warning-banner level-warn"><span class="wb-icon">⚠️</span><span>Ez az idő szokatlanul távolinak tűnik az előző eseményhez képest — ellenőrizd, nem gépeltél-e el egy számjegyet, mielőtt mented.</span></div>`;
            return;
        }

        const threshold = speedThresholds[baseDist] || {};
        if (threshold.min == null && threshold.max == null) { cont.innerHTML = ''; return; }

        const spd = lapDist / (roll.diff / 3600);
        cont.innerHTML = renderSpeedBannerHtml(spd, threshold);
    }

    // Közös figyelmeztető-sáv építő a min (időtúllépés/OT kockázat) és max (sebesség/SP kockázat) határokhoz.
    function renderSpeedBannerHtml(spd, threshold) {
        if (threshold.max != null && spd >= threshold.max) {
            return `<div class="warning-banner level-danger"><span class="wb-icon">🚨</span><span>Kör átlag: ${spd.toFixed(2)} km/h — a ${threshold.max} km/h-s maximum fölött (139. § (2)), sebesség miatti kiesés (FTQ-SP) kockázata.</span></div>`;
        }
        if (threshold.max != null && spd >= threshold.max - 1) {
            return `<div class="warning-banner level-warn"><span class="wb-icon">⚠️</span><span>Kör átlag: ${spd.toFixed(2)} km/h — közelít a ${threshold.max} km/h-s maximumhoz.</span></div>`;
        }
        if (threshold.min != null && spd < threshold.min) {
            return `<div class="warning-banner level-danger"><span class="wb-icon">🚨</span><span>Kör átlag: ${spd.toFixed(2)} km/h — a ${threshold.min} km/h-s minimum alatt, időtúllépés (FTQ-OT) kockázata.</span></div>`;
        }
        if (threshold.min != null && spd < threshold.min + 1) {
            return `<div class="warning-banner level-warn"><span class="wb-icon">⚠️</span><span>Kör átlag: ${spd.toFixed(2)} km/h — közelít a ${threshold.min} km/h-s minimumhoz.</span></div>`;
        }
        return '';
    }

    // A "Teljes verseny" nézetben a táv váltásakor a TELJES kiírást át kell
    // venni az új távról: a körök számát, a körtávokat ÉS a rajtidőt is.
    // (A puszta autoSetLaps() csak a körmezőket rajzolta újra, üresen, így a
    // versenyző a régi táv rajtidejével és távjaival maradt.)
    // A genLaps() minden körmezőt újragenerál, ezért a versenyző már rögzített
    // beérkezési/orvosi idejét vissza kell tölteni, különben eltűnne a képről.
    function versenyTavValtas() {
        autoSetLaps('lapCount', 'totalDist', 'lapInputsContainer', 'v');

        const dist = document.getElementById('totalDist').value;
        const cfg = raceConfig[String(dist).replace('j', '')] || {};
        const cfgLaps = cfg.laps || [];

        // Rajtidő az ÚJ táv kiírásából
        document.getElementById('vhR').value = cfg.h || '';
        document.getElementById('vmR').value = cfg.m || '';
        document.getElementById('vsR').value = cfg.s || '';

        const bib = document.getElementById('selectCompetitor').value;
        const comp = competitors.find(c => c.bib == bib);
        const lapsArr = (comp && comp.laps) || [];

        for (let i = 0; i < cfgLaps.length; i++) {
            const n = i + 1;
            const dEl = document.getElementById(`vd${n}`);
            if (!dEl) continue;
            const l = lapsArr[i] || {};
            // A körtáv az ÚJ kiírásból jön: a régi táv körtávja itt már
            // értelmetlen lenne.
            dEl.value = cfgLaps[i] || '';
            // A ténylegesen mért idők viszont a versenyzőé - megtartjuk.
            document.getElementById(`vh${n}`).value = l.h || '';
            document.getElementById(`vm${n}`).value = l.m || '';
            document.getElementById(`vs${n}`).value = l.s || '';
            document.getElementById(`voh${n}`).value = l.oh || '';
            document.getElementById(`vom${n}`).value = l.om || '';
            document.getElementById(`vos${n}`).value = l.os || '';
        }
        calcVerseny(false);
    }

 function autoSetLaps(countId, distId, contId, prefix, isModal = false) {
        const d = document.getElementById(distId).value;
        const baseDist = d.replace('j', '');
        let config = isModal ? modalRaceConfig : raceConfig;
        let expectedLaps = (config[baseDist] && config[baseDist].laps) ? config[baseDist].laps.length : 3;

        const s = document.getElementById(countId);
        let opts = '';
        for(let i=1; i<=10; i++) opts += `<option value="${i}">${i} kör</option>`;
        s.innerHTML = opts;
        s.value = expectedLaps;
        genLaps(countId, contId, prefix);
    }

    function genLaps(countId, contId, prefix) {
        const count = document.getElementById(countId).value;
        const container = document.getElementById(contId); container.innerHTML = '';
        for(let i = 1; i <= count; i++) {
            let html = `<div class="lap-card"><h4>${i}. KÖR</h4><label>Táv (km):</label><input type="number" id="${prefix}d${i}" step="0.1" placeholder="20">`;
            if(prefix !== 't') {
                html += `<label>Beérkezés:</label>
                         <div class="time-group">
                             <input type="number" id="${prefix}h${i}" oninput="jump(this, '${prefix}m${i}')" placeholder="00"> :
                             <input type="number" id="${prefix}m${i}" oninput="jump(this, '${prefix}s${i}')" placeholder="00"> :
                             <input type="number" id="${prefix}s${i}" oninput="jump(this, '${prefix}oh${i}')" placeholder="00">
                         </div>
                         <label>Orvosi (Vet):</label>
                         <div class="time-group">
                             <input type="number" id="${prefix}oh${i}" oninput="jump(this, '${prefix}om${i}')" placeholder="00"> :
                             <input type="number" id="${prefix}om${i}" oninput="jump(this, '${prefix}os${i}')" placeholder="00"> :
                             <input type="number" id="${prefix}os${i}" ${i<count ? `oninput="jump(this, '${prefix}h${i+1}')"` : ''} placeholder="00">
                         </div>`;
            }
            container.innerHTML += html + `</div>`;
        }
    }

    // --- ÉLŐ RENDSZER (ÓRA, VISSZASZÁMLÁLÁS) ---
    setInterval(() => {
        // FRISSÍTI AZ ÖSSZES ÓRÁT A KÉPERNYŐN EGYSZERRE
        const timeNow = new Date().toLocaleTimeString('hu-HU', { hour12: false });
        document.querySelectorAll('.liveClockText').forEach(el => el.innerText = timeNow);
        
        // Visszafelé kompatibilitás a régi adatlapos órához
        const clockEl = document.getElementById('liveClockText');
        if(clockEl) { clockEl.innerText = timeNow; }

        frissitEloKiindulasok();
        kezdolapVisszaszamlalas();
    }, 1000);

    // A következő rajtok / kimenetelek időrendben - az Élő Kiindulások, a TV mód és a kezdőlap közös adata.
    // diff: hány másodperc múlva (negatív = már indulnia kellett, legfeljebb 30 mp-ig marad a listán).
    function eloKiindulasAdatok(nowS) {
        let liveData = [];
        competitors.forEach(c => {
            if(c.isEliminated) return; 

            let baseDist = c.dist.replace('j', '');
            let expected = (raceConfig[baseDist] && raceConfig[baseDist].laps) ? raceConfig[baseDist].laps.length : 3;

            let completedLaps = (c.laps || []).filter(l => l.isComplete);
            let completedCount = completedLaps.length;

            if(completedCount >= expected) return; 

            let nextStartSec = 0;
            let label = "";

            if (completedCount === 0) {
                let startH = c.startTime && c.startTime.h !== "" ? c.startTime.h : (raceConfig[baseDist] ? raceConfig[baseDist].h : 0);
                let startM = c.startTime && c.startTime.m !== "" ? c.startTime.m : (raceConfig[baseDist] ? raceConfig[baseDist].m : 0);
                let startS = c.startTime && c.startTime.s !== "" ? c.startTime.s : (raceConfig[baseDist] ? raceConfig[baseDist].s : 0);

                nextStartSec = toSec(startH, startM, startS);
                label = "Rajt";
            } else {
                let last = completedLaps[completedLaps.length - 1];
                if(!last || !last.nextStart) return;
                nextStartSec = last.nextStart;
                label = "Kimenetel";
            }

            if (nextStartSec > 0) {
                let diff = nextStartSec - nowS; 
                if(diff < -43200) diff += 86400; 

                if(diff >= -30) {
                    liveData.push({ comp: c, diff: diff, nextStart: nextStartSec, label: label });
                }
            }
        });

        liveData.sort((a, b) => {
            if (a.diff >= 0 && b.diff >= 0) return a.diff - b.diff; 
            if (a.diff < 0 && b.diff >= 0) return 1; 
            if (a.diff >= 0 && b.diff < 0) return -1; 
            return b.diff - a.diff; 
        });
        return liveData;
    }

    // Az Élő Kiindulások lista (és a TV mód) kirajzolása. Másodpercenként fut, de fülváltáskor
    // azonnal is meghívjuk - korábban az első másodpercben csak a cím látszott.
    function frissitEloKiindulasok() {
        const live = document.getElementById('liveCountdownContainer');
        if (!live) return;

        // ÚJ: Az óra frissül, ha az Élő fülön vagyunk VAGY ha nyitva van a TV mód!
        const isEloRajtokActive = document.getElementById('elo-rajtok').classList.contains('active');
        const isFullscreenActive = document.getElementById('fullscreenLiveOverlay')?.classList.contains('active');
        if (!isEloRajtokActive && !isFullscreenActive) return;

        const now = new Date(); const nowS = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();

        let liveData = eloKiindulasAdatok(nowS);

        let formatLiveTime = (d) => {
            let isNeg = d < 0; let absD = Math.abs(d);
            const h = Math.floor(absD / 3600); const m = Math.floor((absD % 3600) / 60); const sc = absD % 60;
            let str = "";
            if (h > 0) {
                str = h + ":" + String(m).padStart(2, '0') + ":" + String(sc).padStart(2, '0');
            } else {
                str = String(m).padStart(2, '0') + ":" + String(sc).padStart(2, '0');
            }
            return isNeg ? "-" + str : str;
        };

        let html = "";
        liveData.forEach(item => {
            const d = item.diff;
            let blinkClass = "";
            if ( (d <= 120 && d > 115) || (d <= 60 && d > 55) || (d <= 15 && d > 10) || d < 0 ) { blinkClass = "warning"; }
            // Re-check: a kiindulás előtti utolsó 15 percben kell újra bemutatni (92. § (3)-(4)).
            const ri = recheckInfo(item.comp, raceConfig);
            const rcSor = ri ? `<br><small class="live-recheck">${escapeHtml(recheckSzoveg(ri))}</small>` : '';
            html += `<div class="live-item${ri ? ' is-recheck' : ''}"><div><b>#${item.comp.bib} ${escapeHtml(item.comp.name)}</b><br><small>${item.label}: ${toTimeStr(item.nextStart)}</small>${rcSor}</div><div class="live-time ${blinkClass}">${formatLiveTime(d)}</div></div>`;
        });
        live.innerHTML = html || `<div style="text-align:center; padding:20px; color:var(--text-dim);">${liveRaceMeta ? 'Most senki nem várakozik indulásra.' : 'Jelenleg nincs élő verseny.'}</div>`;
        const fullscreenContent = document.getElementById('fullscreenLiveContent');
        if (fullscreenContent && document.getElementById('fullscreenLiveOverlay')?.classList.contains('active')) {
            fullscreenContent.innerHTML = live.innerHTML;
        }
    }

    function enterLiveFullscreen() {
        const overlay = document.getElementById('fullscreenLiveOverlay');
        const content = document.getElementById('fullscreenLiveContent');
        const countdown = document.getElementById('liveCountdownContainer');
        if (!overlay || !content) return;
        content.innerHTML = countdown ? countdown.innerHTML : '<div style="text-align:center; padding:20px;">Nincs várakozó.</div>';
        overlay.classList.add('active');
        document.body.classList.add('fullscreen-active');
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    }

    function exitLiveFullscreen() {
        const overlay = document.getElementById('fullscreenLiveOverlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        document.body.classList.remove('fullscreen-active');
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
    }

    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
            // Most már BÁRMELYIK fülről azonnal kirakja a nagyképernyőt!
            enterLiveFullscreen();
            e.preventDefault();
            return;
        }

        if (e.key === 'Escape' && document.getElementById('fullscreenLiveOverlay')?.classList.contains('active')) {
            exitLiveFullscreen();
            e.preventDefault();
        }
    });

    // --- ADATLAPOK, RANGSOROLÁS ÉS ÁLLAPOTKÖVETÉS ---
    function getAdatlapContext() {
        if (viewingPastRaceData) {
            return {
                comps: viewingPastRaceData.competitors ? parseCompetitors(viewingPastRaceData.competitors) : [],
                config: mergeRaceConfig(viewingPastRaceData.raceConfig),
                name: viewingPastRaceData.name
            };
        }
        return { comps: competitors, config: raceConfig, name: liveRaceMeta ? liveRaceMeta.name : 'ÉLŐ' };
    }

    // Célba ért (teljesítette): nincs kiesve, és minden kört lefutott. A "Gyors eredmény"-nyel
    // (kör-adatok nélkül, utólag) rögzített, nem kiesett versenyző is ide tartozik - pl. a
    // VII. Husztót Kupa minden versenyzője így szerepel, és korábban 0% teljesítést mutatott.
    function teljesitetteE(c, config) {
        if (!c || c.isEliminated) return false;
        if (c.manualEntry) return true;
        const base = String(c.dist || '').replace('j', '');
        const vart = (config && config[base] && config[base].laps) ? config[base].laps.length : 3;
        return (c.laps || []).filter(l => l && l.isComplete).length >= vart;
    }

    function getCompLiveStatus(c, config) {
        if (c.isEliminated) return { text: getElimText(c), color: "var(--danger)", textCol: "#fff" };
        // FNR: teljesítette, minden vizsgálaton megfelelt, csak helyezést nem kap - zöld (II. melléklet).
        if (c.status === 'FNR') return { text: "Teljesítette (FNR)", color: "var(--success)", textCol: "#000" };
        // Re-check: a FEI lap "Re-Inspection"-je - a nyilvános listán is látszik, mikorra esedékes.
        if (c.status === 'RECHECK') return { text: recheckSzoveg(recheckInfo(c, config)), color: "#FF9F0A", textCol: "#000" };
        // "Gyors eredmény": utólag rögzített, célba ért versenyző - nincs köradata, de nem "Körön van".
        if (c.manualEntry) return { text: "Beérkezett", color: "var(--success)", textCol: "#000" };

        let baseDist = c.dist ? c.dist.replace('j', '') : '20';
        let expected = (config[baseDist] && config[baseDist].laps) ? config[baseDist].laps.length : 1;
        let laps = c.laps || [];

        let validLaps = laps.filter(l => l.arrSec > 0);
        let completed = validLaps.length;

        let nowSec = new Date().getHours()*3600 + new Date().getMinutes()*60 + new Date().getSeconds();

        if (completed === 0) {
            let startH = c.startTime && c.startTime.h !== "" ? c.startTime.h : (config[baseDist] ? config[baseDist].h : 0);
            let startM = c.startTime && c.startTime.m !== "" ? c.startTime.m : (config[baseDist] ? config[baseDist].m : 0);
            let startS = c.startTime && c.startTime.s !== "" ? c.startTime.s : (config[baseDist] ? config[baseDist].s : 0);
            let startSec = toSec(startH, startM, startS);

            let diff = startSec - nowSec;
            if (diff < -43200) diff += 86400;

            if (startSec > 0 && diff > -60) {
                return { text: "Rajtol", color: "#D4A373", textCol: "#000" };
            }
            return { text: "Körön van", color: "var(--primary)", textCol: "var(--on-primary, #fff)" };
        }

        let last = validLaps[completed - 1];

        if (completed >= expected) {
            if (!last.vetSec || last.vetSec === 0) return { text: "Célban (Orvosira vár)", color: "var(--warning)", textCol: "#000" };
            return { text: "Beérkezett", color: "var(--success)", textCol: "#000" };
        }

        if (last.arrSec > 0 && (!last.vetSec || last.vetSec === 0)) {
            return { text: "Megérkezett", color: "var(--warning)", textCol: "#000" };
        }

        if (last.nextStart) {
            // Éjfél körüli forduló-biztos összevetés (P0/2): a nyers nagyobb/kisebb reláció
            // önmagában hibás lenne, ha a virradat előtti/utáni idő keveredik.
            let diff = last.nextStart - nowSec;
            if (diff < -43200) diff += 86400;
            if (diff > 43200) diff -= 86400;
            if (diff > 0) return { text: "Várakozik", color: "var(--warning)", textCol: "#000" };
        }

        return { text: "Körön van", color: "var(--primary)", textCol: "var(--on-primary, #fff)" };
    }

    // 31. §: ha két, nem kiesett versenyző utolsó teljesített körének menetideje másodpercre
    // egyezik, és egyiküknek sincs finishOrder-je rögzítve, a rendszer nem tudja eldönteni,
    // ki ért be előbb - ezt jelezni kell a bíró felé, nem szabad csendben tömbindex szerint
    // dönteni (l. JAVITAS_bajnoki_pontszamitas.md, 3. pont).
    function getUnresolvedTieWarnings(comps, dist) {
        const catComps = comps.filter(c => c.dist === dist && !c.isEliminated && c.status !== 'FNR');
        const warnings = [];
        for (let i = 0; i < catComps.length; i++) {
            for (let j = i + 1; j < catComps.length; j++) {
                const a = catComps[i], b = catComps[j];
                const aLaps = (a.laps || []).filter(l => l.isComplete);
                const bLaps = (b.laps || []).filter(l => l.isComplete);
                if (!aLaps.length || !bLaps.length || aLaps.length !== bLaps.length) continue;
                const aTime = aLaps[aLaps.length - 1].rideTime;
                const bTime = bLaps[bLaps.length - 1].rideTime;
                if (aTime > 0 && aTime === bTime && !a.finishOrder && !b.finishOrder) {
                    warnings.push(`${a.name} és ${b.name}`);
                }
            }
        }
        return warnings;
    }

    function renderTieWarningBanner(comps, dist) {
        const warnings = getUnresolvedTieWarnings(comps, dist);
        if (!warnings.length) return '';
        return `<div class="warning-banner level-warn" style="margin-top:0; margin-bottom:15px;"><span class="wb-icon">⚠️</span><span>Holtverseny - a beérkezési sorrendet rögzíteni kell (31. §): ${warnings.join('; ')}</span></div>`;
    }

    function calculateCurrentRanks(comps, config) {
        let ranksInfo = {};
        ALL_CATS.forEach(dist => {
            let catComps = comps.filter(c => c.dist === dist);
            catComps.sort((a, b) => {
                // Sorrend: helyezettek, FNR (teljesítette, helyezés nélkül), kiesettek - l. eredmenyCsoport.
                const ga = eredmenyCsoport(a), gb = eredmenyCsoport(b);
                if (ga !== gb) return ga - gb;

                // IDEIGLENES: "Gyors eredmény" (kör-/időadatok nélküli, kézzel megadott helyezés) -
                // ha van manuálisan megadott helyezés, az dönt a lap-alapú összehasonlítás helyett.
                if (a.manualEntry && a.manualPlace && b.manualEntry && b.manualPlace) return a.manualPlace - b.manualPlace;
                if (a.manualEntry && a.manualPlace) return -1;
                if (b.manualEntry && b.manualPlace) return 1;

                let aLaps = (a.laps || []).filter(l => l.isComplete).length;
                let bLaps = (b.laps || []).filter(l => l.isComplete).length;
                if (aLaps !== bLaps) return bLaps - aLaps;
                
                let aLast = aLaps > 0 ? a.laps[aLaps-1] : null;
                let bLast = bLaps > 0 ? b.laps[bLaps-1] : null;
                
                let aTime = aLast ? aLast.rideTime : 0;
                let bTime = bLast ? bLast.rideTime : 0;

                // SPECIÁLIS LOGIKA 20 KM-HEZ: Az Orvosi (VET) idő alapján rangsorolunk!
                if (dist === "20" || dist === "20j") {
                    let aVet = aLast && aLast.vetSec > 0 ? aLast.vetSec : 999999;
                    let bVet = bLast && bLast.vetSec > 0 ? bLast.vetSec : 999999;
                    return aVet - bVet;
                }
                
                // 31. §: azonos tiszta lovaglási idő esetén nincs holtverseny - a célvonalon való
                // áthaladás sorrendje dönt. Ezt a finishOrder mező rögzíti (kisebb = korábban ért be);
                // ha egyik versenyzőnél sincs kitöltve, a sorrend egyelőre tömbindex szerinti marad
                // (l. a checkForUnresolvedTies() jelzését a versenyeredmény-nézetben).
                if (aTime === bTime && (a.finishOrder || b.finishOrder)) {
                    return (a.finishOrder || 999) - (b.finishOrder || 999);
                }
                return aTime - bTime;
            });
            
            let helySzamlalo = 0;
            catComps.forEach((c, index) => {
                let gapStr = "";
                let lastLapIndex = (c.laps || []).filter(l => l.isComplete).length - 1;
                if (lastLapIndex >= 0 && !c.isEliminated && c.status !== 'FNR') {
                    let sameLapComps = catComps.filter(x => x.status !== 'FNR' && x.laps && x.laps[lastLapIndex] && x.laps[lastLapIndex].isComplete);
                    
                    if (dist === "20" || dist === "20j") {
                        // 20km-nél az orvosi idők közötti különbség a lemaradás
                        let bestVet = Math.min(...sameLapComps.map(x => (x.laps[lastLapIndex].vetSec > 0 ? x.laps[lastLapIndex].vetSec : 999999)));
                        let myVet = c.laps[lastLapIndex].vetSec;
                        if (myVet > 0 && myVet > bestVet) gapStr = "+" + toTimeStr(myVet - bestVet);
                    } else {
                        // Többi távnál a menetidő alapján
                        let bestTime = Math.min(...sameLapComps.map(x => x.laps[lastLapIndex].rideTime));
                        let gap = c.laps[lastLapIndex].rideTime - bestTime;
                        if (gap > 0) gapStr = "+" + toTimeStr(gap);
                    }
                }
                // IDEIGLENES: "Gyors eredmény" esetén a kézzel megadott helyezés jelenik meg rangként,
                // nem a tömbindex - így pontosan azt mutatja, amit a felhasználó rögzített.
                // Az FNR nem kap helyezést (és nem is foglal el egyet).
                let rank;
                if (c.isEliminated) rank = "Kiesett";
                else if (c.status === 'FNR') rank = "FNR";
                else { helySzamlalo++; rank = (c.manualEntry && c.manualPlace) ? c.manualPlace : helySzamlalo; }
                ranksInfo[c.bib] = { rank: rank, gapStr: gapStr };
            });
        });
        return ranksInfo;
    }

    // includeEmpty=false: csak azok a távok, amelyekben VAN versenyző. Az
    // adatlap-listában egy üres kategória csak zavar (pl. ha az utolsó
    // versenyzőt is átváltottuk róla, a táv mégis ottmaradt, mert a
    // kiírásban szerepelt egy rajtidő).
    // includeEmpty=true: a kategóriaváltó modalhoz kell, mert oda üres
    // kategóriába is át kell tudni váltani.
    function getActiveCategories(comps, config, includeEmpty = false) {
        let active = [];
        ALL_CATS.forEach(d => {
            let hasComp = comps.some(c => c.dist === d);
            let baseDist = d.replace('j','');
            let hasConfig = config[baseDist] && config[baseDist].h !== '';
            if (hasComp || (includeEmpty && !d.includes('j') && hasConfig)) active.push(d);
        });
        return active;
    }

    function setAdatlapFilter(filter) {
        currentAdatlapFilter = filter;
        try { if (filter) sessionStorage.setItem('rps-adatlap-kat', filter); else sessionStorage.removeItem('rps-adatlap-kat'); } catch (e) {}
        renderAdatlapList();
    }

    function openCatSwapModal() {
        const ctx = getAdatlapContext();
        // Itt az üres (kiírt, de még nevezetlen) kategóriák is kellenek.
        let activeCats = getActiveCategories(ctx.comps, ctx.config, true);
        let html = "";
        activeCats.forEach(cat => {
            html += `<button class="calc-btn cat-select-btn kicsi" onclick="closeCatSwapModal(); setAdatlapFilter('${cat}')">${catNames[cat]}</button>`;
        });
        html += `<button class="cancel-btn" style="display:block; margin-top:20px;" onclick="closeCatSwapModal()">Bezárás</button>`;
        document.getElementById('catSwapModalBody').innerHTML = html;
        document.getElementById('catSwapModal').style.display = 'flex';
    }

    function closeCatSwapModal() { document.getElementById('catSwapModal').style.display = 'none'; }

    function renderAdatlapList() {
        const ctx = getAdatlapContext();
        const cont = document.getElementById('adatlapList'); 

        let titleEl = document.getElementById('adatlapok-title');
        titleEl.innerText = (viewingPastRaceData ? ctx.name + " Eredményei" : "Versenyzői Adatlapok");

        let activeCats = getActiveCategories(ctx.comps, ctx.config);

        if (!currentAdatlapFilter || currentAdatlapFilter === 'all') {
            let html = `<div style="display:flex; flex-direction:column; gap:10px; margin-top:0;">`;
            if (activeCats.length === 0) { html += `<p style="text-align:center; color:var(--text-dim);">Még nincs beállított kategória vagy versenyző.</p>`; } 
            else { activeCats.forEach(cat => { html += `<button class="calc-btn cat-select-btn" onclick="setAdatlapFilter('${cat}')">${catNames[cat]}</button>`; }); }
            cont.innerHTML = html + `</div>`;
        } else {
            let catComps = ctx.comps.filter(c => c.dist === currentAdatlapFilter);
            let total = catComps.length;
            let elim = catComps.filter(c => c.isEliminated).length;
            let qual = catComps.filter(c => teljesitetteE(c, ctx.config)).length;

            let elimPct = total > 0 ? ((elim/total)*100).toFixed(1) : 0;
            let qualPct = total > 0 ? ((qual/total)*100).toFixed(1) : 0;

            cont.innerHTML = `
                <div class="stats-header-container">
                    <div class="stats-top-row">
                        <div class="stat-box large">${catNames[currentAdatlapFilter]}</div>
                        <div class="stat-box small">Teljesítette:<span class="stat-val">${qual} (${qualPct}%)</span></div>
                        <div class="stat-box small">Kiesett:<span class="stat-val">${elim} (${elimPct}%)</span></div>
                    </div>
                    <div class="stats-ctrl-row">
                        <button class="stat-btn" onclick="setAdatlapFilter(null)">⮜ Kategóriák</button>
                        <button class="stat-btn" onclick="openCatSwapModal()">⇆</button>
                        <div class="mobile-break"></div>
                        <button class="stat-btn" onclick="showCatInfo('${currentAdatlapFilter}', ${viewingPastRaceData !== null})" style="font-size:1.1rem; padding:4px 10px;">ℹ️</button>
                        <div class="clock-display" id="liveClockText">--:--:--</div>
                    </div>
                </div>
                ${renderTieWarningBanner(ctx.comps, currentAdatlapFilter)}
                <div id="adatlapItemsContainer"></div>
            `;
            renderAdatlapItems(ctx);
        }
    }

    // Admin által (Beállítások fül) távonként beállított min/max alapján adja vissza a jelvényeket:
    // ⚠ SP = elérte/túllépte a maximumot (139. § (2), sebesség miatti kiesés kockázata)
    // ⚠ OT = a minimum alatt van (időtúllépés / FTQ-OT kockázata)
    function getSpeedFlagBadgesHtml(comp, completedLaps) {
        const baseDist = comp.dist ? comp.dist.replace('j', '') : null;
        const t = speedThresholds[baseDist] || {};
        const hasMax = completedLaps.some(l => l.speedFlagMax || (t.max != null && (l.loopSpd >= t.max || l.phaseSpd >= t.max)));
        const hasMin = completedLaps.some(l => l.speedFlagMin || (t.min != null && (l.loopSpd < t.min || l.phaseSpd < t.min)));
        // A sebesség-figyelmeztetések csak az adminnak látszanak: ezek belső
        // kockázatjelzések (SP = sebességtúllépés, OT = időtúllépés kockázata),
        // a döntést mindig a bíró/orvos hozza meg - a versenyzői listában
        // félreérthetőek lennének.
        let html = '';
        if (hasMax) html += `<span class="inline-flag danger admin-only">⚠ SP</span>`;
        if (hasMin) html += `<span class="inline-flag warning admin-only">⚠ OT</span>`;
        return html;
    }

    function renderAdatlapItems(ctx) {
        const cont = document.getElementById('adatlapItemsContainer'); if(!cont) return; cont.innerHTML = '';
        let filtered = ctx.comps.filter(c => c.dist === currentAdatlapFilter);
        let ranksInfo = calculateCurrentRanks(ctx.comps, ctx.config);

        filtered.sort(eredmenyRendezo(ranksInfo));

        // A TÁV legjobb átlagos pulzusideje - mindenkinek látszik.
        // Szándékosan a már kategóriára szűrt mezőnyből, nem az egész versenyből.
        const pulzusBajnok = legjobbPulzusIdo(filtered);

        filtered.forEach(c => {
            let info = ranksInfo[c.bib] || { rank: "-", gapStr: "" };
            let rankClass = c.isEliminated ? "kiesett" : (c.status === 'FNR' ? "fnr" : "");
            let rankDisplay = helyezesCimke(c, info.rank);
            let gapHtml = info.gapStr ? `<div class="adatlap-gap">Lemaradás: ${info.gapStr}</div>` : '';
            let speedStr = ""; let speedFlagHtml = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
            if (completedLaps.length > 0) {
                let lastLap = completedLaps[completedLaps.length - 1];
                speedStr = `Átlag: ${kmh(lastLap.rideSpd)} km/h`;
                // Admin állítja be távonként (Beállítások fül): max -> SP kockázat, min -> OT kockázat
                speedFlagHtml = getSpeedFlagBadgesHtml(c, completedLaps);
            }
            if (pulzusBajnok && pulzusBajnok.bib === String(c.bib)) {
                speedFlagHtml += `<span class="inline-flag pulzus" title="A táv legjobb átlagos pulzusideje: ${toTimeStr(pulzusBajnok.sec)} (${pulzusBajnok.korok} kör átlaga)">💚</span>`;
            }
            let speedHtml = speedStr ? `<div class="adatlap-speed-badge">${speedStr}</div>` : '';

            let statusObj = getCompLiveStatus(c, ctx.config);
            let liveStatusHtml = `<span class="adatlap-live-status" style="background:${statusObj.color}; color:${statusObj.textCol||'#fff'};">${statusObj.text}</span>`;

            cont.innerHTML += `
            <div class="adatlap-card" onclick="openAdatlap('${c.bib}')">
                <div class="adatlap-rank ${rankClass}">${rankDisplay}</div>
                <div class="adatlap-info">
                    <div class="adatlap-name-row"><span class="adatlap-bib">${c.bib}</span> <span class="adatlap-name">${c.name}</span>${kovetettVersenyzoE(c) ? ' <span class="kovetett-jel" title="Követed">★</span>' : ''} ${liveStatusHtml}</div>
                    <div class="adatlap-horse">${c.internal || "Ismeretlen ló"}</div>
                </div>
                <div class="adatlap-right" style="display:flex; align-items:center; gap:10px;">
                    ${viewingPastRaceData ? '' : szurkolasGombHtml(c.bib, true)}
                    <button class="calc-btn" onclick="event.stopPropagation(); openVetHistory('${c.bib}')" style="background:var(--success); color:black; padding:6px 12px; margin:0; font-size:0.85rem; width:auto; border-radius:8px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🩺 Karton</button>
                    <div class="adatlap-arrow">❯</div>
                </div>
                <div class="adatlap-badges">${gapHtml}${speedHtml}${speedFlagHtml}</div>
            </div>`;
        });
    }

    function openAdatlap(bib, isPast = false) {
        const ctx = getAdatlapContext();
        const c = ctx.comps.find(comp => comp.bib == bib); if(!c) return;

        // IDEIGLENES: "Gyors eredmény" (kör-/időadatok nélküli, kézzel rögzített helyezés) esetén
        // nincs kör-bontás amit meg lehetne jeleníteni - helyette egy egyszerű összefoglaló kártya.
        if (c.manualEntry) {
            const placeStr = c.isEliminated ? getElimText(c) : (c.manualPlace ? c.manualPlace + '. hely' : 'nincs rögzített helyezés');
            document.getElementById('modalBody').innerHTML = `
                <div data-live-view="adatlap" data-live-bib="${c.bib}" class="vk-kartya" style="max-width: 500px;">
                    <div class="vk-fej">
                        <div class="vk-nev">${c.bib} | ${escapeHtml(c.name)}</div>
                        <div class="vk-lo">${escapeHtml(c.internal || "Ló neve hiányzik")}</div>
                        <div class="vk-info"><span>🏁 <b>Táv:</b> ${catNames[c.dist] || (c.dist + ' km')}</span></div>
                    </div>
                    ${adatlapTamogatasHtml(c)}
                    <div style="padding: 24px; text-align:center;">
                        <p class="vk-halvany" style="font-size:0.82rem; margin-bottom:18px;">⚡ Gyorsan rögzített eredmény - nincsenek részletes kör-/időadatok.</p>
                        <div class="vk-gyors-hely">${placeStr}</div>
                        ${c.totalTimeSec ? `<div style="font-size:1.1rem;">Teljes menetidő: <b>${toTimeStr(c.totalTimeSec)}</b></div>` : ''}
                        ${c.club ? `<div class="vk-halvany" style="font-size:0.9rem; margin-top:10px;">${escapeHtml(c.club)}</div>` : ''}
                    </div>
                    <div class="vk-lab">
                        <button class="admin-only vk-obpont ${c.obPont !== false ? 'igen' : ''}" onclick="toggleObPont('${c.bib}')">${c.obPont !== false ? '🏆 OB-pontra jogosult' : '🚫 OB-pontról lemondva'} (kattints a váltáshoz)</button>
                        <button class="calc-btn vk-bezar" onclick="closeAdatlap()">Bezárás</button>
                    </div>
                </div>`;
            document.getElementById('adatlapModal').style.display = 'flex';
            return;
        }

        let baseDist = c.dist ? c.dist.replace('j', '') : '20';
        let distName = catNames[c.dist] || (c.dist + " km");
        let cfg = ctx.config[baseDist] || { h: '00', m: '00', s: '00', laps: [] };
        
        let startH = (c.startTime && c.startTime.h !== undefined && c.startTime.h !== "") ? c.startTime.h : (cfg.h || '00');
        let startM = (c.startTime && c.startTime.m !== undefined && c.startTime.m !== "") ? c.startTime.m : (cfg.m || '00');
        let startS = (c.startTime && c.startTime.s !== undefined && c.startTime.s !== "") ? c.startTime.s : (cfg.s || '00');
        let rajTidoStr = String(startH).padStart(2, '0') + ":" + String(startM).padStart(2, '0') + ":" + String(startS).padStart(2, '0');

        // ÚJ: Minden tervezett kört megjelenítünk, nem csak a befejezetteket!
        let expectedLapsCount = cfg.laps && cfg.laps.length > 0 ? cfg.laps.length : 1;
        let phases = [];
        for (let i = 0; i < expectedLapsCount; i++) {
            let lapObj = (c.laps && c.laps[i]) ? c.laps[i] : {};
            lapObj.d = lapObj.d || (cfg.laps && cfg.laps[i] ? cfg.laps[i] : '-');
            phases.push(lapObj);
        }

        let sameCatComps = ctx.comps.filter(x => x.dist === c.dist);
        let is20km = c.dist === '20' || c.dist === '20j';
        
        let ranks = [];
        let gaps = [];
        
        const getPhaseRankTime = (comp, idx) => {
            const lap = comp.laps && comp.laps[idx] ? comp.laps[idx] : null;
            if (!lap || !lap.isComplete) return Number.MAX_SAFE_INTEGER;
            let time = lap.rideTime;
            if (is20km && idx === (comp.laps || []).filter(l => l.isComplete).length - 1 && lap.vetSec > 0) {
                time = lap.loopSec + lap.pulzusSec;
            }
            return time;
        };

        phases.forEach((l, i) => {
            if (!l.isComplete) {
                ranks.push(null); gaps.push(null); return;
            }
            let phaseComps = sameCatComps.filter(x => x.laps && x.laps[i] && x.laps[i].isComplete);
            phaseComps.sort((a, b) => getPhaseRankTime(a, i) - getPhaseRankTime(b, i));
            let rank = phaseComps.findIndex(x => x.bib == c.bib) + 1;
            let bestTime = phaseComps.length > 0 ? getPhaseRankTime(phaseComps[0], i) : 0;
            let currentTime = getPhaseRankTime(c, i);
            let gap = currentTime - bestTime;
            ranks.push(rank);
            gaps.push(gap === 0 ? '-' : '+' + toTimeStr(gap));
        });

        if (c.isEliminated) {
            let lastCompletedIdx = phases.map(p => p.isComplete).lastIndexOf(true);
            if (lastCompletedIdx >= 0) {
                ranks[lastCompletedIdx] = `<span style="color:var(--danger); font-weight:bold;">Kiesett</span>`;
            }
        } else if (c.status === 'FNR') {
            // Teljesítette, de helyezés nélkül: a záró kör helyén "FNR" (zöld), nem helyezési szám.
            let lastCompletedIdx = phases.map(p => p.isComplete).lastIndexOf(true);
            if (lastCompletedIdx >= 0) ranks[lastCompletedIdx] = `<span style="color:var(--success); font-weight:bold;">FNR</span>`;
        }

        let html = `
            <div data-live-view="adatlap" data-live-bib="${c.bib}" class="vk-kartya" style="max-width: 900px;">
                <div class="vk-fej">
                    <div class="vk-nev">${c.bib} | ${escapeHtml(c.name)}</div>
                    <div class="vk-lo">${escapeHtml(c.internal || "Ló neve hiányzik")}</div>
                    <div class="vk-info"><span>🏁 <b>Táv:</b> ${distName}</span><span>⏱ <b>Rajtidő:</b> ${rajTidoStr}</span></div>
                </div>
                ${adatlapTamogatasHtml(c)}
                <div data-live-scroll class="vk-gorgeto">
                    <table class="vk-tabla">
                        <tr>
                            <th style="width:25%;">Szakasz</th>
        `;

        phases.forEach((_,i) => html += `<th>${i+1}. KÖR</th>`);
        html += `</tr>`;

        const renderDataRow = (label, valueFn) => {
            let row = `<tr><td>${label}</td>`;
            phases.forEach((l, i) => { row += `<td>${valueFn(l, i)}</td>`; });
            row += `</tr>`; return row;
        };

        html += renderDataRow('Táv (km)', l => `<b class="vk-tav">${l.d || '-'}</b>`);
        html += renderDataRow('Rajt', l => l.startSec > 0 ? toTimeStr(l.startSec) : "-");
        html += renderDataRow('Beérkezés', l => l.arrSec > 0 ? toTimeStr(l.arrSec) : "-");
        html += renderDataRow('Kör idő', l => l.loopSec > 0 ? toTimeStr(l.loopSec) : "-");
        // A nyilvános adatlapon nincs sebesség-színezés (a 16 km/h-s piros jelzés csak az admin
        // Versenyáttekintő fülén van, a minősítőkhöz).
        html += renderDataRow('Kör átlag km/h', l => l.loopSpd > 0 ? kmh(l.loopSpd) : "-");
        html += renderDataRow('Orvosi (Vet)', l => {
            if (!l.isComplete) return "-";
            if (is20km && l.vetSec > 0) return toTimeStr(l.loopSec + l.pulzusSec);
            return l.vetSec > 0 ? toTimeStr(l.vetSec) : "-";
        });
        html += renderDataRow('Pulzus idő', l => l.pulzusSec > 0 ? toTimeStr(l.pulzusSec) : "-");
        html += renderDataRow('Orvosi átlag km/h', l => l.phaseSpd > 0 ? kmh(l.phaseSpd) : "-");
        html += renderDataRow('Össz. menetidő', (l, i) => {
            if (!l.isComplete) return "-";
            let finalLap = i === phases.length - 1;
            if (is20km && finalLap && l.vetSec > 0) {
                return `<b>${toTimeStr(l.loopSec + l.pulzusSec)}</b>`;
            }
            return l.rideTime > 0 ? `<b>${toTimeStr(l.rideTime)}</b>` : "-";
        });
        html += renderDataRow('Össz. átlag km/h', (l, i) => {
            if (!l.isComplete) return "-";
            return l.rideSpd > 0 ? `<b>${kmh(l.rideSpd)}</b>` : "-";
        });
        html += renderDataRow('Helyezés', (l, i) => (typeof ranks[i] === 'string') ? ranks[i] : (ranks[i] ? `<b>${ranks[i]}.</b>` : "-"));
        html += renderDataRow('Lemaradás', (l, i) => gaps[i] ? `<span>${gaps[i]}</span>` : "-");

        html += `
                    </table>
                </div>
                <div class="vk-lab">
                    <button class="admin-only vk-obpont ${c.obPont !== false ? 'igen' : ''}" onclick="toggleObPont('${c.bib}')" title="Bajnoki (OB) pontszerzésre jogosult-e ez a versenyző - ha lemond, ennek a versenynek az eredménye nem számít bele az egyéni bajnokságba">${c.obPont !== false ? '🏆 OB-pontra jogosult' : '🚫 OB-pontról lemondva'} (kattints a váltáshoz)</button>
                    <button class="calc-btn vk-bezar" onclick="closeAdatlap()">Bezárás</button>
                </div>
            </div>`;
        
        document.getElementById('modalBody').innerHTML = html; 
        document.getElementById('adatlapModal').style.display = 'flex';
    }

    function closeAdatlap() { document.getElementById('adatlapModal').style.display = 'none'; }

    // A versenyzői adatlap tetején: a lovas és a ló követése, élő versenyen szurkolás
    function adatlapTamogatasHtml(c) {
        const gombok = [];
        if (c.license) gombok.push(kovetesGombHtml('lovas', c.license).replace(/(☆ Követés|★ Követed)/, m => m + ' – lovas'));
        if (c.startNum) gombok.push(kovetesGombHtml('lo', c.startNum).replace(/(☆ Követés|★ Követed)/, m => m + ' – ló'));
        if (!viewingPastRaceData) gombok.push(szurkolasGombHtml(c.bib));
        return gombok.filter(Boolean).length ? `<div class="adatlap-tamogatas">${gombok.join('')}</div>` : '';
    }

    // A nyitott adatlap / állatorvosi karton egyszeri renderés volt: ha közben bárki
    // rögzítette az időket (beérkeztetés, orvosi idő, orvosi döntés - akár másik
    // eszközről), a kint hagyott adatlap a régi adatokat mutatta, amíg be nem
    // zárták és újra meg nem nyitották. A kirajzolt kártya megjelöli magát
    // (data-live-view + data-live-bib), így innen újra tudjuk rajzolni. A jelölő a
    // #modalBody tartalmában van, ezért bármely más modal-tartalom automatikusan
    // "kikapcsolja" - nem írjuk felül más nézet tartalmát.
    function refreshOpenModalIfNeeded() {
        const modal = document.getElementById('adatlapModal');
        if (!modal || modal.style.display !== 'flex') return;
        const card = document.querySelector('#modalBody [data-live-view]');
        const bib = card ? card.dataset.liveBib : null;
        if (!bib) return;

        // Görgetési pozíció megőrzése, hogy a frissítés ne ugorjon vissza a tetejére.
        const oldScroll = document.querySelector('#modalBody [data-live-scroll]');
        const prevLeft = oldScroll ? oldScroll.scrollLeft : 0;
        const prevTop = modal.scrollTop;

        if (card.dataset.liveView === 'vethistory') openVetHistory(bib, true);
        else openAdatlap(bib);

        const newScroll = document.querySelector('#modalBody [data-live-scroll]');
        if (newScroll) newScroll.scrollLeft = prevLeft;
        modal.scrollTop = prevTop;
    }

    // --- ESZKÖZÖK ---
    // Kalkulátor-segédek: egy óra/perc/mp mezőhármas akkor "kitöltött", ha legalább egy mezőben
    // van érték - így a 00:00:00 (éjfél) is érvényes indulás (korábban a 0 = "üres" volt).
    function idoMezok(hId, mId, sId) {
        const ert = [hId, mId, sId].map(id => String(document.getElementById(id).value || '').trim());
        const kitoltott = ert.some(v => v !== '');
        const ok = kitoltott && /^\d{0,2}$/.test(ert[0]) && /^\d{0,2}$/.test(ert[1]) && /^\d{0,2}$/.test(ert[2])
            && (parseInt(ert[0] || '0', 10) <= 23) && (parseInt(ert[1] || '0', 10) <= 59) && (parseInt(ert[2] || '0', 10) <= 59);
        return { kitoltott, ok, sec: toSec(ert[0], ert[1], ert[2]) };
    }

    function kalkHiba(resId, szoveg) {
        const r = document.getElementById(resId);
        r.style.display = 'block';
        r.innerHTML = `<span style="color:var(--danger); font-weight:700;">${szoveg}</span>`;
    }

    function calcReszido() {
        const d = parseFloat(String(document.getElementById('dist1').value).replace(',', '.'));
        const t1 = idoMezok('rh1', 'rm1', 'rs1');
        const t2 = idoMezok('rh2', 'rm2', 'rs2');
        // Hiányos adatnál a régi eredmény nem maradhat kint, mintha az lenne az új.
        if (!(d > 0)) { kalkHiba('res1', 'Add meg a táv hosszát (km).'); return; }
        if (!t1.kitoltott || !t2.kitoltott) { kalkHiba('res1', 'Add meg az indulási és a beérkezési időt.'); return; }
        if (!t1.ok || !t2.ok) { kalkHiba('res1', 'Hibás időpont (óra 0-23, perc és mp 0-59).'); return; }
        const pihenoMezo = document.getElementById('reszido-piheno');
        const pihenoPerc = pihenoMezo && parseFloat(pihenoMezo.value) > 0 ? parseFloat(pihenoMezo.value) : ALAP_PIHENO_PERC;
        const roll = resolveRollover(t2.sec - t1.sec);
        const diff = roll.diff;
        if (!(diff > 0)) { kalkHiba('res1', 'A beérkezés nem lehet azonos az indulással.'); return; }
        const spd = d / (diff / 3600); const nextStart = (t2.sec + Math.round(pihenoPerc * 60)) % 86400;
        const warnHtml = roll.suspicious
            ? `<div class="warning-banner level-warn" style="margin-top:0; margin-bottom:12px;"><span class="wb-icon">⚠️</span><span>Ez az idő szokatlanul távolinak tűnik - ellenőrizd, nem gépeltél-e el egy számjegyet.</span></div>`
            : '';
        document.getElementById('res1').style.display = 'block';
        document.getElementById('res1').innerHTML = `${warnHtml}Átlagsebesség: <b style="color:${spd>=16.0?'var(--warning)':'var(--success)'}">${kmh(spd)} km/h</b><br>Menetidő: <b>${toTimeStr(diff)}</b><br><br><span style="color:var(--text-dim)">Kimeneteli idő (${String(pihenoPerc).replace('.', ',')} perc pihenő): <b style="color:var(--text);">${toTimeStr(nextStart)}</b></span>`;
    }

    function calcMinosites() {
        const d = parseFloat(String(document.getElementById('distJ').value).replace(',', '.'));
        const t1 = idoMezok('jh1', 'jm1', 'js1');
        if (!(d > 0)) { kalkHiba('res3', 'Add meg a kör hosszát (km).'); return; }
        if (!t1.kitoltott) { kalkHiba('res3', 'Add meg a rajt idejét.'); return; }
        if (!t1.ok) { kalkHiba('res3', 'Hibás időpont (óra 0-23, perc és mp 0-59).'); return; }
        document.getElementById('res3').style.display = 'block';
        document.getElementById('res3').innerHTML = `Szükséges beérkezési idő:<br><strong style="font-size:1.8rem; color:var(--success);">${toTimeStr((t1.sec + Math.ceil(d / (CALC_LIMIT / 3600))) % 86400)}</strong>`;
    }

    // --- TÖMEGES IMPORTÁLÁS FELUGRÓ ABLAKKAL ---
    function importCompetitorsFromPrompt(isModal) {
        // A böngésző saját beviteli ablakát dobja fel
        const jsonText = prompt("Kérlek, másold be ide (Ctrl+V vagy jobb klikk -> Beillesztés) a JSON kódot:");
        if (!jsonText || jsonText.trim() === "") return;

        let data;
        try { data = JSON.parse(jsonText.trim()); }
        catch (err) { showToast("Hibás a kód: nem érvényes JSON. Biztos, hogy az egészet kimásoltad?", true); return; }

        // Tömb ([{...}, {...}]) és objektum ({"12": {...}} vagy {"competitors": ...}) is jó -
        // korábban a tömböt "hibás kód"-nak mondta, pedig érvényes.
        let lista = data && data.competitors ? data.competitors : data;
        lista = Array.isArray(lista) ? lista.filter(Boolean) : (lista && typeof lista === 'object' ? Object.values(lista).filter(Boolean) : []);
        if (!lista.length) { showToast("A kód üres vagy nem tartalmaz versenyzőket!", true); return; }

        let ut, letezo;
        if (isModal) {
            if (!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
            const type = document.getElementById('rm-type').value || 'jovo';
            ut = 'races/' + type + '/' + modalRaceId + '/competitors/';
            letezo = modalCompetitors;
        } else {
            ut = 'competitors/';
            letezo = competitors;
        }

        // Soronkénti ellenőrzés: rajtszám, név, táv kötelező; foglalt rajtszámot NEM írunk felül.
        const hibak = [], utkozesek = [], jok = [], latott = new Set();
        const szoveg = v => String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ');
        lista.forEach((c, i) => {
            const bib = szoveg(c.bib !== undefined ? c.bib : c.rajtszam);
            const name = szoveg(c.name !== undefined ? c.name : c.nev);
            const dist = szoveg(c.dist !== undefined ? c.dist : c.tav).replace(/\s*km$/i, '');
            if (!bib || !rajtszamErvenyes(bib)) { hibak.push(`${i + 1}. tétel: hiányzó vagy hibás rajtszám`); return; }
            if (!name) { hibak.push(`#${bib}: hiányzó név`); return; }
            if (!ALL_CATS.includes(dist)) { hibak.push(`#${bib}: ismeretlen táv (${dist || 'üres'})`); return; }
            if (latott.has(bib)) { hibak.push(`#${bib}: kétszer szerepel`); return; }
            latott.add(bib);
            const foglalo = (letezo || []).find(x => String(x.bib) === bib);
            if (foglalo) { utkozesek.push(`#${bib} (${foglalo.name})`); return; }
            jok.push({
                bib, name, dist,
                license: szoveg(c.license), club: szoveg(c.club), startNum: szoveg(c.startNum),
                internal: szoveg(c.internal !== undefined ? c.internal : c.horse),
                startTime: { h: '', m: '', s: '' }, laps: [], isEliminated: false
            });
        });

        if (!jok.length) {
            const okok = hibak.concat(utkozesek.map(u => 'foglalt rajtszám: ' + u));
            showToast('Nincs felvehető versenyző. ' + okok.slice(0, 3).join('; '), true);
            return;
        }
        const osszegzes = `${jok.length} versenyző kerül felvételre.`
            + (utkozesek.length ? ` Kihagyva, mert a rajtszám már foglalt: ${utkozesek.join(', ')}.` : '')
            + (hibak.length ? ` Kihagyva hibás adat miatt: ${hibak.join('; ')}.` : '');
        showConfirm('Tömeges importálás', osszegzes, () => {
            const updates = {};
            jok.forEach(c => {
                updates[ut + c.bib] = c;
                // A lovas/ló törzs is frissül (mezőszinten), ahogy a kézi nevezésnél.
                Object.assign(updates, torzsFrissitesek(c.startNum, c.internal, c.license, c.name, c.club));
            });
            db.ref('/').update(updates).then(() => {
                showToast(`Sikeres importálás: ${jok.length} versenyző hozzáadva!`);
                if (isModal) updateRmCompetitorDisplays();
            }).catch(err => showToast("Hiba az adatbázis feltöltésekor: " + err.message, true));
        });
    }

    // A kapott mezőny legjobb ÁTLAGOS PULZUSIDEJE: a beérkezés és az orvosi kapura
    // állás között eltelt idő (l.pulzusSec) - ez mutatja meg, milyen gyorsan
    // regenerálódott a ló. Nem a leolvasott bpm értéket nézzük: az önmagában a
    // határértékhez való viszonyt mutatja, nem a teljesítményt.
    // Versenyzőnként az ÖSSZES mért körének ÁTLAGÁT számoljuk, nem a legjobb
    // egyetlen körét: egy szerencsés kör nem nyerheti meg a díjat az egész
    // versenyen végig egyenletesen jól regenerálódó ló elől.
    // MINDIG TÁVONKÉNT kell hívni (egy kategória versenyzőivel): a 20 km és a
    // 160 km nem összemérhető, egy közös "verseny legjobbja" díjat gyakorlatilag
    // mindig a legrövidebb táv vitt volna el.
    // Csak a versenyben lévő lovak befejezett köreit nézzük - a kiesett
    // lovak és az előzetes vizsgálat értékei nem versenyeznek ezért.
    function legjobbPulzusIdo(comps) {
        let legjobb = null;
        (comps || []).forEach(c => {
            if (c.isEliminated) return;
            let ossz = 0, merveK = 0;
            (c.laps || []).forEach(l => {
                if (!l || !l.isComplete) return;
                const sec = parseInt(l.pulzusSec);
                if (!sec || sec <= 0) return;
                ossz += sec;
                merveK++;
            });
            if (merveK === 0) return;
            const atlag = ossz / merveK;
            // Az összehasonlítás a kerekítetlen átlaggal megy (atlagRaw), a kerekített
            // sec csak a kijelzéshez kell - különben két közeli átlagnál a kerekítés
            // döntené el a díjat.
            if (!legjobb || atlag < legjobb.atlagRaw) {
                legjobb = { bib: String(c.bib), sec: Math.round(atlag), atlagRaw: atlag, korok: merveK, name: c.name, horse: c.internal };
            }
        });
        return legjobb;
    }

    // --- EREDMÉNYLISTA NYOMTATÁSA TÁVONKÉNT (nettó idő + átlagsebesség) ---
    function printEredmenyLista() {
        const ctx = getAdatlapContext();
        const comps = ctx.comps || [];
        if (!comps.length) { showToast("Nincs versenyző az eredménylistához!", true); return; }

        const config = ctx.config;
        const ranksInfo = calculateCurrentRanks(comps, config);
        const cats = getActiveCategories(comps, config);
        const raceName = ctx.name || (liveRaceMeta ? liveRaceMeta.name : "Élő Verseny");

        // Egy versenyző nettó ideje és átlagsebessége a befejezett körökből.
        // A 20 km-es táv külön szabály: ott az idő az orvosi kapunál áll meg.
        function eredmeny(c) {
            // "Gyors eredmény": nincs köradat, csak a kézzel megadott végidő (mint az Excel exportban).
            if (c.manualEntry && c.totalTimeSec > 0) {
                const km = parseInt(String(c.dist || '').replace('j', ''), 10) || 0;
                return { ido: idoHhMmSs(c.totalTimeSec), spd: km > 0 ? kmh(km / (c.totalTimeSec / 3600)) + ' km/h' : '-' };
            }
            const kesz = (c.laps || []).filter(l => l.isComplete);
            if (!kesz.length) return { ido: '-', spd: '-' };
            const utolso = kesz[kesz.length - 1];
            let sec = utolso.rideTime;
            if ((c.dist === "20" || c.dist === "20j") && utolso.vetSec > 0) {
                sec = utolso.loopSec + utolso.pulzusSec;
            }
            if (!sec || sec <= 0) return { ido: '-', spd: '-' };
            const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            const tav = kesz.reduce((ossz, l) => ossz + (parseFloat(l.d) || 0), 0);
            return {
                ido: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`,
                spd: tav > 0 ? kmh(tav / (sec / 3600)) + ' km/h' : '-'
            };
        }

        let html = `<html><head><title>Eredménylista - ${raceName}</title><style>
            body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; padding:15px; color:#000; background:#fff; font-size:13px; }
            .header-box { text-align:center; margin-bottom:18px; }
            h1 { margin:0; font-size:1.5rem; text-transform:uppercase; letter-spacing:1px; }
            h2 { margin:4px 0 0 0; color:#444; font-size:1.05rem; }
            table { width:100%; border-collapse:collapse; margin:10px 0 22px 0; border:2px solid #000; }
            th, td { border:1px solid #666; padding:6px 8px; text-align:left; }
            th { background:#e0e0e0; font-weight:bold; font-size:.82rem; text-transform:uppercase; text-align:center; }
            .cat-header { background:#d0d0d0; font-weight:bold; font-size:1.05rem; text-transform:uppercase;
                          padding:8px 10px; border-top:2px solid #000; border-bottom:2px solid #000; }
            .rank { font-weight:bold; font-size:1.15rem; text-align:center; width:7%; background:#f9f9f9; }
            .bib  { font-weight:bold; text-align:center; width:8%; }
            .num  { text-align:center; font-weight:bold; white-space:nowrap; }
            .out  { color:#a00; font-style:italic; }
            .badge-box { border:2px solid #000; padding:10px 14px; margin-bottom:18px; background:#f4f4f4; }
            .footer { margin-top:14px; text-align:right; font-size:.72rem; color:#666;
                      border-top:1px solid #ccc; padding-top:8px; }
            @media print { body { padding:0; } @page { margin:1cm; } }
        </style></head><body>
        <div class="header-box"><h1>${raceName}</h1><h2>EREDMÉNYLISTA / RESULTS</h2></div>`;

        cats.forEach(cat => {
            // Helyezettek, utánuk az FNR (teljesítette, helyezés nélkül), végül a kiesettek.
            const catComps = comps.filter(c => c.dist === cat).sort(eredmenyRendezo(ranksInfo));
            if (!catComps.length) return;

            // A legjobb átlagos pulzusidő távonkénti díja: minden kategóriának saját
            // győztese van, és a listán csak a 💚 jelöli - külön kiírt érték nélkül.
            const pulzusBajnok = legjobbPulzusIdo(catComps);

            html += `<table><tr><td colspan="8" class="cat-header">${catNames[cat] || cat}</td></tr>
                <tr><th>Hely</th><th>Rajtsz.</th><th>Versenyző</th><th>Ló</th>
                    <th>Egyesület</th><th>Nettó idő</th><th>Átlagseb.</th><th>Megjegyzés</th></tr>`;

            catComps.forEach(c => {
                const r = eredmeny(c);
                const kiesett = c.isEliminated;
                const fnr = !kiesett && c.status === 'FNR';
                const hely = kiesett ? '-' : (fnr ? 'FNR' : (ranksInfo[c.bib]?.rank ?? '-'));
                const pulzusJel = (pulzusBajnok && pulzusBajnok.bib === String(c.bib)) ? ' 💚' : '';
                html += `<tr${kiesett ? ' class="out"' : ''}>
                    <td class="rank">${hely}</td>
                    <td class="bib">${c.bib}</td>
                    <td>${c.name || ''}${pulzusJel}</td>
                    <td>${c.internal || ''}</td>
                    <td>${c.club || ''}</td>
                    <td class="num">${kiesett ? '-' : r.ido}</td>
                    <td class="num">${kiesett ? '-' : r.spd}</td>
                    <td>${kiesett ? (c.status || 'Kiesett') : (fnr ? 'Teljesítette, helyezés nélkül (FNR)' : '')}</td>
                </tr>`;
            });
            html += `</table>`;
        });

        html += `<div class="footer">💚 = a táv legjobb átlagos pulzusideje &nbsp;|&nbsp;
                 Generálva: <b>end-ride.com</b> &nbsp;|&nbsp;
                 ${new Date().toLocaleString('hu-HU')}</div>
                 <script>window.onload = function() { window.print(); }<\/script></body></html>`;

        const win = window.open('', '_blank');
        win.document.write(html);
        win.document.close();
    }

    // --- ADMIN: A4-ES LISTÁK NYOMTATÁSA (KÜLÖNVÁLASZTOTT NEVEZÉSI ÉS RAJTLISTA) ---
    function printVersenyLista(mode) {
        if (!competitors || competitors.length === 0) {
            showToast("Nincsenek versenyzők az élő versenyben!", true);
            return;
        }

        let raceName = liveRaceMeta ? liveRaceMeta.name : "Élő Verseny";
        let win = window.open('', '_blank');
        
        let html = `
        <html>
        <head>
            <title>${mode === 'rajt' ? 'Rajtlista' : 'Nevezési Lista'} - ${raceName}</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 15px; color: #000; background: #fff; font-size: 13px; }
                .header-box { text-align: center; margin-bottom: 20px; }
                h1 { margin: 0; font-size: 1.5rem; text-transform: uppercase; letter-spacing: 1px; }
                h2 { margin: 5px 0 0 0; color: #444; font-size: 1.1rem; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; border: 2px solid #000; }
                th, td { border: 1px solid #666; padding: 6px 8px; text-align: left; vertical-align: middle; }
                th { background: #e0e0e0; font-weight: bold; font-size: 0.85rem; text-transform: uppercase; text-align: center; }
                .cat-header { background: #d0d0d0; font-weight: bold; font-size: 1.1rem; text-transform: uppercase; padding: 8px 10px; border-top: 2px solid #000; border-bottom: 2px solid #000; }
                .bib-cell { font-weight: bold; font-size: 1.2rem; text-align: center; width: 10%; background: #f9f9f9; }
                .time-cell { font-weight: bold; font-size: 1.1rem; text-align: center; width: 15%; background: #fff; }
                .footer { margin-top: 20px; text-align: right; font-size: 0.75rem; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
                @media print { 
                    body { padding: 0; }
                    @page { margin: 1cm; }
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header-box">
                <h1>${raceName}</h1>
                <h2>${mode === 'rajt' ? 'HIVATALOS RAJTLISTA / START LIST' : 'NEVEZÉSI LISTA / ENTRY LIST'}</h2>
            </div>
            <table>
        `;

        // Távok kigyűjtése és csökkenő sorrendbe rakása (80, 60, 40, 20)
        let dists = [...new Set(competitors.map(c => c.dist))].sort((a,b) => parseInt(b) - parseInt(a));

        dists.forEach(d => {
            let comps = competitors.filter(c => c.dist === d).sort((a, b) => parseInt(a.bib) - parseInt(b.bib));
            if (comps.length === 0) return;

            let catName = catNames[d] || `${d} km`;
            let baseDist = d.replace('j', '');
            
            // Valós rajtidő lekérése a "Versenykiírás" beállításokból
            let startStr = "Nincs megadva";
            if (raceConfig[baseDist] && raceConfig[baseDist].h !== undefined && raceConfig[baseDist].h !== '') {
                let h = raceConfig[baseDist].h.toString().padStart(2,'0');
                let m = raceConfig[baseDist].m.toString().padStart(2,'0');
                let s = raceConfig[baseDist].s.toString().padStart(2,'0');
                startStr = `${h}:${m}:${s}`;
            }

            let catHeaderContent = `${catName} KATEGÓRIA`;

            html += `
                <tr>
                    <td colspan="4" class="cat-header">${catHeaderContent}</td>
                </tr>
            `;

            if (mode === 'rajt') {
                // RAJTLISTA: Idő az első, nincs igazolási szám, nincs klub
                html += `
                <tr>
                    <th>Indulás ideje</th>
                    <th>Rajtszám</th>
                    <th>Versenyző neve</th>
                    <th>Ló neve</th>
                </tr>`;

                comps.forEach(c => {
                    html += `<tr>
                        <td class="time-cell">${startStr}</td>
                        <td class="bib-cell">#${c.bib}</td>
                        <td style="font-size: 1.05rem;"><b>${c.name}</b></td>
                        <td style="font-size: 1.05rem;"><b>${c.internal || '-'}</b></td>
                    </tr>`;
                });
            } else {
                // NEVEZÉSI LISTA: A korábbi részletes nézet
                html += `
                <tr>
                    <th>Rajtszám</th>
                    <th>Versenyző</th>
                    <th>Ló</th>
                    <th>Egyesület</th>
                </tr>`;

                comps.forEach(c => {
                    html += `<tr>
                        <td class="bib-cell">#${c.bib}</td>
                        <td><b>${c.name}</b> ${c.license ? `<br><small style="color:#555;">Ig: ${c.license}</small>` : ''}</td>
                        <td><b>${c.internal || '-'}</b> ${c.startNum ? `<br><small style="color:#555;">Startszám: ${c.startNum}</small>` : ''}</td>
                        <td>${c.club || '-'}</td>
                    </tr>`;
                });
            }
        });

        html += `
            </table>
            <div class="footer">
                Generálva: <b>end-ride.com</b>
            </div>
            <script>window.onload = function() { window.print(); }</script>
        </body></html>`;

        win.document.write(html);
        win.document.close();
    }

    // --- ADMIN: QR KÓD PLAKÁT NYOMTATÁSA A VERSENYHEZ ---
    function printQRCodeFlyer() {
        let win = window.open('', '_blank');
        
        let html = `
        <html>
        <head>
            <title>QR Kód Plakát - end-ride.com</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; text-align: center; padding: 40px 20px; color: #000; background: #fff; }
                h1 { font-size: 3.5rem; text-transform: uppercase; margin-bottom: 10px; color: #000000; letter-spacing: 2px; }
                h2 { font-size: 2rem; color: #000000; margin-top: 0; margin-bottom: 50px; font-weight: normal; }
                .qr-container { margin: 40px auto; padding: 20px; border: 8px solid #000; display: inline-block; border-radius: 20px; background: #fff; box-shadow: 0 10px 30px rgba(0, 0, 0, 0); }
                img { width: 450px; height: 450px; display: block; }
                p { font-size: 1.8rem; font-weight: bold; margin-top: 50px; color: #000000; }
                .url-box { font-size: 3rem; font-weight: 900; margin-top: 20px; color: #000000; display: inline-block; padding: 15px 40px; border-radius: 15px; letter-spacing: 2px; }
                @media print { 
                    body { padding: 0; }
                    .qr-container { box-shadow: none; }
                }
            </style>
        </head>
        <body>
            <h1>Légy képben!</h1>
            <h2><b>Kövesd a futamot élőben, percről percre!</b></h2>
            
            <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=https://end-ride.com" alt="QR Code">
            </div>
            
            <p>Szkenneld be a telefonoddal, vagy írd be a böngészőbe:</p>
            <div class="url-box">end-ride.com</div>

            <script>
                // Egy pici késleltetés, hogy a QR kód képe biztosan betöltsön az internetről nyomtatás előtt
                setTimeout(() => { window.print(); }, 800);
            </script>
        </body>
        </html>`;

        win.document.write(html);
        win.document.close();
    }

    // --- GYORS KERESÉS (RAJTSZÁM ALAPJÁN) SZINKRONIZÁLÁSA A DROPDOWN LISTÁKKAL ---
    function syncBibInputToSelect(inputId, selectId) {
        const inputVal = document.getElementById(inputId).value.toString().trim();
        const selectEl = document.getElementById(selectId);
        if (!selectEl) return;

        // Ha törlöd a számot a mezőből, csukja be az adatlapot (ugorjon alapra)
        if (inputVal === '') {
            selectEl.value = "";
            selectEl.dispatchEvent(new Event('change'));
            return;
        }

        let found = false;
        // Végigmegyünk a legördülő lista elemein, és keressük az egyezést
        for (let i = 0; i < selectEl.options.length; i++) {
            if (selectEl.options[i].value === inputVal) {
                selectEl.selectedIndex = i;
                found = true;
                break;
            }
        }

        // Ha megtalálta a beírt rajtszámot, automatikusan rákattint helyetted!
        if (found) {
            selectEl.dispatchEvent(new Event('change'));
        }
    }

    // --- KIESÉSI STÁTUSZ SZÖVEGGÉ ALAKÍTÁSA ---
    // A rövid kódok (a multi-select checkbox listában is ezek szerepelnek, l. EXTRA_CODES)
    const EXTRA_CODES = [
        { code: "ME", label: "Metabolikus (ME)" },
        { code: "GA", label: "Sántaság (GA)" },
        { code: "MI", label: "Kisebb sérülés (MI)" },
        { code: "SP", label: "Sebesség (SP)" },
        { code: "OT", label: "Időtúllépés (OT)" },
        { code: "SI MUSCO", label: "Súlyos mozgásszervi (SI MUSCO)" },
        { code: "SI META", label: "Súlyos metabolikus (SI META)" },
        // Kizárás (DSQ) mellé jelölhető okok - II. számú melléklet
        { code: "LP", label: "Regenerációs idő túllépése (LP)" },
        { code: "UW", label: "Súlykorlát (UW)" },
        { code: "HNP", label: "Ló bemutatása elmaradt (HNP)" },
        { code: "HA", label: "Kegyetlenség (HA)" },
        { code: "HYPO", label: "Hyposzenzitivitás (HYPO)" },
    ];

    function getElimText(c) {
        if (!c || !c.isEliminated) return "";
        const s = c.status;
        let base = "Kiesett (ELIM)";
        if (s === "WD" || s === "Visszalépett" || s === "DNS") base = "Visszalépett (WD)";
        else if (s === "RET" || s === "Retired") base = "Feladta (RET)";
        else if (s === "DSQ") base = "Kizárva (DSQ)";
        else if (s === "FNR") base = "Hely. nélkül (FNR)";
        else if (s === "FTQ-SP") base = "Kiesett: Sebesség (SP)";
        else if (s === "FTQ-GA") base = "Kiesett: Sántaság (GA)";
        else if (s === "FTQ-ME") base = "Kiesett: Metabolikus (ME)";
        else if (s === "FTQ-MI") base = "Kiesett: Kisebb sérülés (MI)";
        else if (s === "FTQ-SIMUSCO") base = "Kiesett: Súlyos mozgásszervi (SI MUSCO)";
        else if (s === "FTQ-SIMETA") base = "Kiesett: Súlyos metabolikus (SI META)";
        else if (s === "FTQ-CI") base = "Kiesett: Végzetes (CI)";
        else if (s === "FTQ-OT") base = "Kiesett: Időtúllépés (OT)";
        else if (s === "FTQ-FTC") base = "Kiesett: Befejezetlen (FTC)";
        else if (s === "DNS") base = "Nem jelent meg (DNS)";

        // Kombinálható kiesési kódok (pl. sántaság ÉS időtúllépés egyszerre) - additív, a fő kód mellett
        if (c.extraCodes && c.extraCodes.length) {
            base += " + " + c.extraCodes.join(" + ");
        }
        return base;
    }
    
    // ============================================================================
    // BAJNOKI PONTSZÁMÍTÁS (bajnoki-pontszamitas.md) - egyéni/ló/csapat/klub bontás
    // ============================================================================

    function toggleObPont(bib) {
        const ctx = getAdatlapContext();
        const comp = ctx.comps.find(c => c.bib == bib);
        if (!comp) return;
        const newVal = !(comp.obPont !== false);
        const path = viewingPastRaceData
            ? 'races/mult/' + viewingPastRaceData.id + '/competitors/' + bib + '/obPont'
            : 'competitors/' + bib + '/obPont';
        db.ref(path).set(newVal).then(() => {
            showToast(newVal ? '🏆 Jogosult az OB-pontra' : '🚫 Lemondva az OB-pontról');
        }).catch(e => showToast('Hiba: ' + e.message, true));
    }

    // --- A magyar bajnokság pontrendszere (III. sz. melléklet). Index 0 = 1. hely, index 23 = 24. hely. ---
    const CHAMPIONSHIP_POINTS = {
        band140_160: [125,115,107,101,97,94,91,88,85,82,80,78,77,76,75,75,75,75,75,75,75,75,75,75],
        band120_139: [100,91,84,79,76,73,70,67,64,61,58,56,54,52,50,49,48,47,46,45,45,45,45,45],
        band100_119: [85,77,72,69,66,63,60,57,54,51,48,46,44,42,40,39,38,37,36,35,35,35,35,35],
        band80_99:   [75,68,63,60,57,54,51,48,46,44,42,40,38,36,34,32,30,28,27,26,25,25,25,25],
        band50_79:   [60,54,51,48,45,43,41,39,37,35,33,31,29,27,26,25,24,23,22,21,20,20,20,20],
        band40_49:   [45,42,39,36,34,32,30,28,26,24,22,20,19,18,17,16,15,14,13,12,11,10,10,10]
    };

    function getPoints(band, place) {
        if (!band || !place || place < 1) return 0;
        const arr = CHAMPIONSHIP_POINTS[band];
        if (!arr) return 0;
        return arr[Math.min(place, 24) - 1] || 0;
    }

    // A sáv a ténylegesen megtett km alapján dől el, nem a nevezési kategória szerint.
    function getPointBand(totalKm) {
        if (totalKm >= 140) return 'band140_160';
        if (totalKm >= 120) return 'band120_139';
        if (totalKm >= 100) return 'band100_119';
        if (totalKm >= 80) return 'band80_99';
        if (totalKm >= 50) return 'band50_79';
        if (totalKm >= 40) return 'band40_49';
        return null;
    }

    // Nincs Magyar Távhajtó Bajnokság - nem lesznek távhajtó versenyzők.
    const CHAMPIONSHIP_CLASSES = {
        tavlovas: { label: 'Magyar Távlovas Bajnokság', sub: '80–160 km, felnőtt', distKeys: ['80', '100', '120', '140', '160'], maxHorses: 2 },
        rovid:    { label: 'Magyar Rövidtávú Távlovas Bajnokság', sub: '40–60 km, bármilyen korú', distKeys: ['40', '60'], maxHorses: 2 },
        junior:   { label: 'Magyar Junior Bajnokság', sub: '80–120 km, junior', distKeys: ['80j', '100j', '120j'], maxHorses: 2 },
    };

    // --- Csapatbajnokság törzsadatai (Firebase) ---
    let teamsCache = {};
    let externalResultsCache = {};
    let bajnokavatasDatumCache = {};

    function getBajnokavatasDatum(year) {
        return (bajnokavatasDatumCache && bajnokavatasDatumCache[year]) || (year + '-12-31');
    }

    // window(year) = [ bajnokavatasDatum[year-1] + 1 nap, bajnokavatasDatum[year] ] - l. terv 3.2.
    // Minden bajnoki ranglista (egyéni, ló, klub, csapat) ugyanezt az ablakot használja az évhez,
    // hogy egységes legyen a "bajnoki év" fogalma - alapból ez gyakorlatilag a naptári évet adja ki.
    function getChampionshipWindow(year) {
        const prevDate = getBajnokavatasDatum(year - 1);
        const d = new Date(prevDate + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        const startDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        return { start: startDate, end: getBajnokavatasDatum(year) };
    }

    function isDateInWindow(dateStr, win) {
        return !!dateStr && dateStr >= win.start && dateStr <= win.end;
    }

    function getAvailableChampionshipYears() {
        const years = new Set([new Date().getFullYear()]);
        localRaces.mult.forEach(r => { if (r.date) years.add(parseInt(r.date.slice(0, 4), 10)); });
        Object.values(externalResultsCache).forEach(e => { if (e.date) years.add(parseInt(e.date.slice(0, 4), 10)); });
        return Array.from(years).filter(y => !isNaN(y)).sort((a, b) => b - a);
    }

    function populateYearSelect(selectId, currentYear) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const years = getAvailableChampionshipYears();
        if (!years.includes(currentYear)) years.unshift(currentYear);
        years.sort((a, b) => b - a);
        sel.innerHTML = years.map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}. bajnoki év</option>`).join('');
    }

    // Egy versenyző adott versenyen, adott kategóriában teljesített (befejezett köreinek) km-összege -
    // ez adja a pontsáv alapját is, és ez alapján összegződik a ló-ranglista is (176. §).
    function getCompletedKm(comp, cfg) {
        const baseDist = comp.dist ? comp.dist.replace('j', '') : null;

        // IDEIGLENES: "Gyors eredmény" (kör-adatok nélküli, kézzel rögzített helyezés) esetén nincs
        // kör-bontás, amiből összegezni lehetne - ha nem esett ki, a kategória névleges távját vesszük.
        if (comp.manualEntry) {
            return comp.isEliminated || !baseDist ? 0 : parseInt(baseDist, 10);
        }

        const distCfg = baseDist && cfg ? cfg[baseDist] : null;
        if (!distCfg || !distCfg.laps) return 0;
        let km = 0;
        (comp.laps || []).forEach((l, i) => {
            if (l && l.isComplete) {
                const d = parseFloat(distCfg.laps[i]);
                if (!isNaN(d)) km += d;
            }
        });
        return Math.round(km * 100) / 100;
    }

    // Az összes múltbéli verseny összes eredményét egy lapos listává alakítja - ez a közös alap
    // minden bajnoki számításhoz (egyéni, ló-ranglista, klub bontás, csapat jogosultság).
    function getAllPastRaceRows() {
        let rows = [];
        localRaces.mult.forEach(race => {
            const comps = parseCompetitors(race.competitors);
            if (!comps.length) return;
            const cfg = mergeRaceConfig(race.raceConfig);
            const ranks = calculateCurrentRanks(comps, cfg);
            comps.forEach(c => {
                const baseDist = c.dist ? c.dist.replace('j', '') : null;
                if (!baseDist) return;
                const rInfo = ranks[c.bib];
                const place = (!c.isEliminated && rInfo && typeof rInfo.rank === 'number') ? rInfo.rank : null;
                // trim(): régi felvitelekben sok név/klub végén szóköz vagy tab maradt ("PANNOVA HORSES Kft.\t"),
                // ami a klub-bontásban külön egyesületnek, a listában furcsa névnek látszott.
                rows.push({
                    raceId: race.id, raceDate: race.date || '', raceName: race.name, isObRound: race.isObRound !== false,
                    bib: c.bib, name: String(c.name || '').trim(), license: String(c.license || '').trim(), club: String(c.club || '').trim(),
                    startNum: String(c.startNum || '').trim(), horseName: String(c.internal || '').trim(),
                    dist: c.dist, km: parseInt(baseDist, 10),
                    completedKm: getCompletedKm(c, cfg), place: place, isEliminated: !!c.isEliminated,
                    status: c.status || (c.isEliminated ? 'FTQ-ME' : 'Active'), extraCodes: c.extraCodes || [],
                    obPont: c.obPont !== false
                });
            });
        });
        return rows;
    }

    // "Néma nulla": egy OB-fordulón nem esett ki, van helyezése, mégis completedKm === 0 (pl.
    // hiányzó kör-adat vagy körtáv a raceConfig-ban) - ilyenkor 0 pontot kap, jelzés nélkül.
    // Ez csak figyelmeztet, adatot nem ír és nem blokkol (l. JAVITAS_bajnoki_pontszamitas.md, 4. pont).
    function getSilentZeroWarnings() {
        return getAllPastRaceRows().filter(r => r.isObRound && !r.isEliminated && r.place != null && r.completedKm === 0);
    }

    function renderSilentZeroWarningBanner() {
        const warnings = getSilentZeroWarnings();
        if (!warnings.length) return '';
        return warnings.map(r => `<div class="warning-banner level-warn" style="margin-top:0; margin-bottom:10px;"><span class="wb-icon">⚠️</span><span>${r.raceName}, ${r.km} km – ${r.name}: nincs megtett km (hiányzó kör-adat vagy körtáv), ezért 0 pontot kap.</span></div>`).join('');
    }

    // --- TÖRZSADATOK: lovas/ló profil (összes eddigi versenyeredmény - nem csak OB-forduló, ez egy
    // személyes előzmény-nézet, nem bajnoki számítás) ---
    function getRiderHistory(license) {
        return getAllPastRaceRows().filter(r => r.license === license).sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || ''));
    }

    function getHorseHistory(startNum) {
        return getAllPastRaceRows().filter(r => r.startNum === startNum).sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || ''));
    }

    // Bezárja az épp nyitott profil/pontkereső popupot, és a versenynek pont az eredmény-nézetére
    // ugrik (ugyanaz, mint a Versenyek listánál a "📊 Eredmények megtekintése" gomb).
    function goToRaceResults(raceId, dist) {
        closeAdatlap();
        openPublicPastRace(raceId, dist);
    }

    // ============================================================================
    // LOVAS / LÓ PROFIL ABLAK
    // Az #adatlapModal generikus #modalBody-jába rajzol. Három eredményforrást tud
    // váltogatni, és a lovas <-> ló kereszthivatkozáshoz saját "vissza" veremmel dolgozik
    // (nem böngésző-history). A hivatalos eredményeket csak nyitáskor tölti - 449 sort nem
    // érdemes folyamatosan szinkronban tartani egy terepen lévő tableten.
    // ============================================================================

    let profilAllapot = null;       // { tipus:'lovas'|'lo', id, ev, forras }
    let profilElozmeny = [];        // kereszthivatkozás-verem a "vissza" gombhoz
    const profilHivatalosCache = {}; // 'lovas:12770' -> eredménysorok (egy nyitás = egy olvasás)

    // Üres mező helyett gondolatjel, de a 0 valódi érték (pl. büntetőpont), azt ki kell írni.
    function profilErtek(v) {
        if (v === 0) return '0';
        if (v === true) return 'van';
        if (v === false) return 'nincs';
        if (v === null || v === undefined || v === '') return '–';
        if (Array.isArray(v)) return v.length ? escapeHtml(v.join(', ')) : '–';
        return escapeHtml(String(v));
    }

    function profilSor(cimke, ertek) {
        return `<div class="profil-sor"><span class="profil-cimke">${cimke}</span><span class="profil-ertek">${ertek}</span></div>`;
    }

    // "GIGANTIK(87802)" / "Stephanie Kunz (K19711)" -> a zárójeles azonosító nélküli név
    function profilPartnerNev(nyers) {
        return String(nyers || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function openRiderProfile(license) { profilNyitas('lovas', license, false); }
    function openHorseProfile(startNum) { profilNyitas('lo', startNum, false); }
    // Kereszthivatkozás a profilon belül: az előzőt a verembe tesszük, hogy legyen hova visszalépni.
    function profilUgras(tipus, id) { profilNyitas(tipus, id, true); }

    // Igaz, amíg a hivatalos eredménylista tölt. Cache-ből nyitott profilnál egy pillanatig sem
    // igaz, így nem villan fel fölöslegesen a jelzés.
    let profilTolt = false;

    function profilBetoltesIndit() {
        const { tipus, id } = profilAllapot;
        profilTolt = !profilHivatalosCache[tipus + ':' + id];
        renderProfil();                                    // azonnal, a cache-ből
        profilHivatalosBetoltes().then(() => {             // majd a hivatalos eredményekkel
            profilTolt = false;
            renderProfil();
        });
    }

    function profilNyitas(tipus, id, veremre) {
        if (veremre && profilAllapot) profilElozmeny.push(profilAllapot);
        else if (!veremre) profilElozmeny = [];
        // ev: null + evAuto: true = "a legutóbbi aktív éve", amíg a felhasználó nem választ mást.
        profilAllapot = { tipus: tipus, id: String(id), ev: null, evAuto: true, forras: 'magyar', ful: 'eredmenyek' };
        document.getElementById('adatlapModal').style.display = 'flex';
        profilBetoltesIndit();
    }

    function profilVissza() {
        const elozo = profilElozmeny.pop();
        if (!elozo) return;
        profilAllapot = elozo;
        profilBetoltesIndit();
    }

    function profilForrasValt(forras) { if (profilAllapot) { profilAllapot.forras = forras; renderProfil(); } }
    // Ha a felhasználó maga választ évet, onnantól nem írjuk felül az automatikával.
    function profilEvValt(ev) { if (profilAllapot) { profilAllapot.ev = ev; profilAllapot.evAuto = false; renderProfil(); } }

    function profilHivatalosBetoltes() {
        if (!profilAllapot) return Promise.resolve([]);
        const { tipus, id } = profilAllapot;
        const kulcs = tipus + ':' + id;
        if (profilHivatalosCache[kulcs]) return Promise.resolve(profilHivatalosCache[kulcs]);
        const node = (tipus === 'lovas' ? 'riderResults/' : 'horseResults/') + sanitizeKey(id);
        return db.ref(node).once('value').then(snap => {
            const val = snap.val() || [];
            profilHivatalosCache[kulcs] = (Array.isArray(val) ? val : Object.values(val)).filter(Boolean);
            return profilHivatalosCache[kulcs];
        }).catch(() => { profilHivatalosCache[kulcs] = []; return []; });
    }

    // --- A nyers források közös kártya-alakra hozva -------------------------------
    // Kifelé két forrás látszik: "Magyar" (a saját lebonyolítás + a szövetség hivatalos listája
    // összefésülve, l. profilMagyarEredmenyek) és "Nemzetközi" (FEI). A felhasználónak nem kell
    // tudnia, melyik eredmény melyik adatbázisból jött - egy verseny egy kártya.
    function profilSajatEredmenyek() {
        const { tipus, id } = profilAllapot;
        const sorok = tipus === 'lovas' ? getRiderHistory(id) : getHorseHistory(id);
        const renumbered = renumberWithoutForeign(getAllPastRaceRows());
        const cache = {};
        return sorok.map(r => {
            // A helyezésért ténylegesen kapott bajnoki pont (lónál a lovasa kapta) - l. getObPontInfo()
            const ob = getObPontInfo(r, renumbered, cache);
            return {
                ev: (r.raceDate || '').slice(0, 4),
                datum: r.raceDate, verseny: r.raceName, alcim: catNames[r.dist] || r.dist, szint: '',
                hely: r.place, indulok: null, kiesett: r.isEliminated,
                statuszSzoveg: getElimText({ isEliminated: true, status: r.status, extraCodes: r.extraCodes }),
                partnerNev: tipus === 'lovas' ? r.horseName : r.name,
                partnerId: tipus === 'lovas' ? r.startNum : r.license,
                ido: '', sebesseg: null, buntetes: null,
                obPont: ob.points, obHely: ob.place, obOsztaly: ob.classKey, obMegj: ob.note, obKlon: ob.klon || 0,
                raceId: r.raceId, dist: r.dist, kmKulcs: r.km
            };
        });
    }

    function profilHivatalosEredmenyek() {
        const { tipus, id } = profilAllapot;
        const sorok = profilHivatalosCache[tipus + ':' + id] || [];
        return sorok.map(e => {
            // A competition a verseny nevével kezdődik ("VII. Husztót Kupa 2.vrsz.-60 km..."),
            // a kártyafejlécben viszont csak a versenyszám kell alcímnek.
            const teljes = e.competition || '';
            const alcim = (e.event && teljes.startsWith(e.event)) ? teljes.slice(e.event.length).trim() : teljes;
            const helySzam = /^\d+$/.test(String(e.place || '').trim()) ? parseInt(e.place, 10) : null;
            // A partner mezőnevei importonként eltérnek: a régi (v4) sorokban partnerName/partnerId,
            // a 2023-2026-os importban lovasnál horseName/horseId, lónál riderName/license.
            const partnerNev = e.partnerName || (tipus === 'lovas' ? e.horseName : e.riderName) || '';
            const partnerAzon = e.partnerId || (tipus === 'lovas' ? e.horseId : e.license) || '';
            // Olyan versenynél, ami nincs a saját rendszerünkben (pl. 2025 előtti), a III. melléklet
            // szerinti, a hivatalos helyezéshez tartozó pontot mutatjuk. A szövetség "minPoints"
            // mezője (minősítő pont) más képlettel készül, azt szándékosan nem írjuk ki.
            const km = parseFloat(e.distanceKm) || 0;
            const tablazatPont = (helySzam && !e.status && getPointBand(km)) ? getPoints(getPointBand(km), helySzam) : null;
            return {
                obPont: tablazatPont, obHely: helySzam, obMegj: '', obTablazat: true,
                ev: e.year || (e.date || '').slice(0, 4),
                datum: (e.date || '').replace(/\//g, '-'), verseny: e.event, alcim: alcim, szint: e.level || '',
                hely: helySzam, indulok: e.starters, kiesett: !!e.status,
                statuszSzoveg: [e.status, e.note && e.note !== '0' ? e.note : ''].filter(Boolean).join(' · '),
                partnerNev: profilPartnerNev(partnerNev), partnerId: partnerAzon,
                ido: e.time && /^\d/.test(e.time) ? e.time : '', sebesseg: null,
                buntetes: e.penalty, raceId: null, dist: null,
                kmKulcs: parseFloat(e.distanceKm) || null
            };
        });
    }

    // FEI: lovasnál license, lónál horseStartNum szerint
    function profilFeiEredmenyek() {
        const { tipus, id } = profilAllapot;
        return Object.values(externalResultsCache)
            .filter(e => tipus === 'lovas' ? e.license === id : e.horseStartNum === id)
            .map(e => ({
                ev: (e.date || '').slice(0, 4),
                datum: e.date, verseny: e.event || e.raceName || 'Nemzetközi verseny',
                alcim: [e.venue, e.country].filter(Boolean).join(', '),
                szint: e.source === 'FEI' ? 'FEI' : 'nemzetközi',
                hely: (e.place === null || e.place === undefined || e.place === '') ? null : parseInt(e.place, 10),
                indulok: null, kiesett: !!e.status, statuszSzoveg: e.status || '',
                partnerNev: e.horseName, partnerId: e.horseStartNum,
                ido: e.score && /^\d+:\d/.test(e.score) ? e.score : (e.rideTime || ''),
                sebesseg: e.avgSpeed || (e.score && /^\d+[.,]\d+$/.test(String(e.score)) ? e.score : null),
                obPont: null, buntetes: null, raceId: null, dist: null,
                km: e.distanceKm
            }));
    }

    // A magyar eredmények két adatbázisból jönnek: a saját lebonyolításunkból (races/mult - ez az
    // igazság forrása, innen át lehet ugrani a verseny eredménylistájára) és a szövetség hivatalos
    // listájából (riderResults/horseResults - 2023-tól, indulószám / minősítő pont / idő). Ugyanaz a
    // rajt mindkettőben szerepelhet, ezért dátum + táv (és ha van, a partner azonosítója) alapján
    // összefésüljük: a saját sor marad, a hivatalosból csak azt vesszük át, amit az tud pluszban.
    function profilMagyarEredmenyek() {
        const eredmeny = profilSajatEredmenyek();
        const kulcs = r => (r.datum || '') + '|' + (r.kmKulcs || '');

        const csoport = new Map();
        eredmeny.forEach(r => {
            const k = kulcs(r);
            if (!csoport.has(k)) csoport.set(k, []);
            csoport.get(k).push(r);
        });

        profilHivatalosEredmenyek().forEach(h => {
            const lista = csoport.get(kulcs(h)) || [];
            const par = lista.find(r => !r.hivatalosIs && r.partnerId && h.partnerId && String(r.partnerId) === String(h.partnerId))
                || lista.find(r => !r.hivatalosIs);
            if (!par) { eredmeny.push(h); return; }

            // Kiegészítés, nem felülírás: ami a saját adatban megvan, az marad.
            if (par.indulok == null) par.indulok = h.indulok;
            if (!par.ido) par.ido = h.ido;
            // A bajnoki pont mindig a saját számításból jön (obPont), a hivatalosból nem vesszük át.
            if (!par.buntetes || par.buntetes === '0') par.buntetes = h.buntetes;
            if (!par.szint) par.szint = h.szint;
            if (!par.partnerNev) { par.partnerNev = h.partnerNev; par.partnerId = h.partnerId; }
            par.hivatalosIs = true;
        });

        return eredmeny;
    }

    function profilEredmenyKartya(r, tipus) {
        const helyOsztaly = r.kiesett || r.hely == null
            ? 'hely-kiesett'
            : (r.hely === 1 ? 'hely-1' : r.hely === 2 ? 'hely-2' : r.hely === 3 ? 'hely-3' : 'hely-tobbi');
        const helySzoveg = (r.kiesett || r.hely == null)
            ? (r.statuszSzoveg || 'Nincs helyezés')
            : `${r.hely}. hely`;

        // A saját versenynél át lehet ugrani a verseny eredménylistájára.
        const versenyCimke = escapeHtml(r.verseny || '–');
        const versenyHtml = r.raceId
            ? `<span class="name-link" onclick="goToRaceResults('${escapeHtml(r.raceId)}', '${escapeHtml(r.dist)}')">${versenyCimke}</span>`
            : versenyCimke;

        // Kereszthivatkozás: lovas kártyáján a ló neve kattintható és fordítva.
        const partnerTipus = tipus === 'lovas' ? 'lo' : 'lovas';
        const partnerHtml = r.partnerNev
            ? (r.partnerId
                ? `<span class="name-link" onclick="profilUgras('${partnerTipus}', '${escapeHtml(r.partnerId)}')">${escapeHtml(r.partnerNev)}</span>`
                : escapeHtml(r.partnerNev))
            : '';

        const also = [];
        if (r.ido) also.push(escapeHtml(r.ido));
        if (r.sebesseg) also.push(escapeHtml(r.sebesseg) + ' km/h');
        if (r.buntetes) also.push('büntető ' + escapeHtml(r.buntetes));
        if (r.km) also.push(escapeHtml(r.km) + ' km');

        // A helyezésért kapott bajnoki pont (III. melléklet) - a régi "min.pont" helyén.
        let pontHtml = '';
        if (r.obPont > 0) {
            const osztaly = r.obOsztaly ? CHAMPIONSHIP_CLASSES[r.obOsztaly].label.replace('Magyar ', '').replace(' Bajnokság', ' OB') + (r.obKlon ? ` · ${r.obKlon + 1}. sor` : '') : '';
            const masHely = r.obHely != null && r.hely != null && r.obHely !== r.hely ? `OB-hely: ${r.obHely}.` : '';
            const reszlet = r.obTablazat ? 'III. melléklet' : [osztaly, masHely].filter(Boolean).join(' · ');
            pontHtml = `<div class="eredmeny-pont">🏆 ${escapeHtml(r.obPont)} pont${reszlet ? ` <span class="eredmeny-pont-reszlet">(${escapeHtml(reszlet)})</span>` : ''}</div>`;
        } else if (r.obMegj) {
            pontHtml = `<div class="eredmeny-pont nulla">0 pont <span class="eredmeny-pont-reszlet">(${escapeHtml(r.obMegj)})</span></div>`;
        }

        return `<div class="eredmeny-kartya">
            <div class="eredmeny-fej">
                <div>
                    <div class="eredmeny-verseny">${versenyHtml}</div>
                    ${r.alcim ? `<div class="eredmeny-alcim">${escapeHtml(r.alcim)}</div>` : ''}
                </div>
                <div class="eredmeny-jobb">${r.szint ? escapeHtml(r.szint) + '<br>' : ''}${escapeHtml(r.datum || '')}</div>
            </div>
            <div class="eredmeny-torzs">
                <div>
                    <span class="eredmeny-hely ${helyOsztaly}">${escapeHtml(helySzoveg)}</span>
                    ${r.indulok ? `<span class="eredmeny-indulok"> / ${escapeHtml(r.indulok)} induló</span>` : ''}
                </div>
                <div class="eredmeny-jobb-oszlop">
                    ${partnerHtml ? `<div class="eredmeny-partner">${partnerHtml}</div>` : ''}
                    ${pontHtml}
                    ${also.length ? `<div>${also.join(' · ')}</div>` : ''}
                </div>
            </div>
        </div>`;
    }

    // --- Törzsadat blokkok ---------------------------------------------------------
    function profilLicencHtml(adat) {
        const ev = String(adat.licenceYear || '').trim();
        if (!ev) return `<span class="profil-licenc lejart">nincs érvényes licenc</span>`;
        const lejart = parseInt(ev, 10) < new Date().getFullYear();
        const szakag = adat.licenceDisciplineShown ? ` (${escapeHtml(adat.licenceDisciplineShown)})` : '';
        return `<span class="profil-licenc ${lejart ? 'lejart' : 'ervenyes'}">${lejart ? '⚠️ ' : ''}${escapeHtml(ev)}</span>${szakag}`;
    }

    function profilLovasTorzsadat(adat, license) {
        let html = `<div class="profil-adatok">
            ${profilSor('Igazolási szám', profilErtek(license))}
            ${profilSor('Nemzeti minősítés', nemzetiMinositesProfil(license))}
            ${profilSor('Minősítő pont', profilErtek(adat.minPoint))}
            ${profilSor('FEI szám', profilErtek(adat.feiId))}
            ${profilSor('Büntető pont', profilErtek(adat.penaltyPoints))}
            ${profilSor('Nem', profilErtek(adat.gender))}
            ${profilSor('Sárgalap', profilErtek(adat.yellowCards))}
            ${profilSor('Edző', profilErtek(adat.coach))}
            ${profilSor('Alap REV', profilErtek(adat.alapRev))}
            ${profilSor('Licenc', profilLicencHtml(adat))}
            ${profilSor('Szakágak', profilErtek(adat.disciplines))}
        </div>`;
        // A szövetségi oldalon a licenc szakágfüggő, és mindig csak az utolsó évet mutatja -
        // ezért ha nincs köztük távlovaglás, azt külön jelezni kell.
        if (adat.enduranceLicence === false) {
            html += `<p class="profil-megjegyzes">Távlovas licenc nem szerepel a szövetségi profilon${adat.licenceDisciplineShown ? ` (a mutatott licenc: ${escapeHtml(adat.licenceDisciplineShown)})` : ''}.</p>`;
        }
        return html;
    }

    function profilLoTorzsadat(adat, startNum) {
        let html = `<div class="profil-adatok">
            ${profilSor('Start szám', profilErtek(startNum))}
            ${profilSor('Születési év', profilErtek(adat.birthYear))}
            ${profilSor('FEI szám', profilErtek(adat.feiId))}
            ${profilSor('Méret', profilErtek(adat.size))}
            ${profilSor('Azonosító (UELN)', profilErtek(adat.ueln))}
            ${profilSor('Szín', profilErtek(adat.color))}
            ${profilSor('Chip', profilErtek(adat.chip))}
            ${profilSor('Ivar', profilErtek(adat.sex))}
            ${profilSor('Egyesület', profilErtek(adat.club))}
            ${profilSor('Licenc', profilLicencHtml(adat))}
            ${profilSor('Tenyésztő', profilErtek(adat.breeder))}
            ${profilSor('Tulajdonos', profilErtek(adat.owner))}
        </div>`;
        if (adat.sire || adat.dam || adat.damSire) {
            html += `<div class="profil-csaladfa">
                <div class="profil-csaladfa-cim">Családfa</div>
                ${profilSor('Apa', profilErtek(adat.sire))}
                ${profilSor('Anya', profilErtek(adat.dam))}
                ${profilSor('Anyai nagyapa', profilErtek(adat.damSire))}
            </div>`;
        }
        return html;
    }

    function profilMonogram(tipus, adat, id) {
        if (tipus === 'lo') return escapeHtml(id);
        const nev = (adat.name || '').trim();
        if (!nev) return escapeHtml(id);
        // A "dr." előtagot kihagyjuk, hogy ne az legyen a monogram.
        const szavak = nev.split(/\s+/).filter(sz => !/^(dr\.?|ifj\.?|id\.?)$/i.test(sz));
        return escapeHtml(szavak.slice(0, 2).map(sz => sz[0]).join('').toUpperCase()) || escapeHtml(id);
    }

    // Amíg a hivatalos eredmények töltenek: ha még egy kártya sincs, csontvázat mutatunk (nehogy
    // azt higgye a felhasználó, hogy nincs eredmény), ha már van, csak egy halk "még jön" sort.
    function betoltesJelzesAProfilban(kartyaDb, ev) {
        if (profilTolt) return kartyaDb ? betoltoSor('További eredmények betöltése…') : skeletonEredmenyKartyak(3);
        if (kartyaDb) return '';
        return `<p class="profil-ures">${ev === 'osszes' ? 'Nincs rögzített eredmény ebben a forrásban.' : 'Ebben az évben nincs rögzített eredmény.'}</p>`;
    }

    // A profil fülei: Eredmények (alap) / Adatlap / FEI újonc (csak admin). Korábban az adatlap
    // lenyíló blokk volt a versenyek fölött, és nyitva elvitte a helyet a listától - így a lista
    // mindig a teljes ablakot kapja, az adatlap egy kattintásra van.
    function profilFulValt(ful) { if (profilAllapot) { profilAllapot.ful = ful; renderProfil(); } }

    // Gyors jelzések a név alatt: licenc, nemzeti minősítés (lovas), versenymentes időszak (ló)
    function profilJelek(tipus, id, torzs, ismert) {
        const jelek = [];
        if (ismert) {
            const lev = String(torzs.licenceYear || '').trim();
            if (!lev) jelek.push(`<span class="profil-jel rossz">Nincs érvényes licenc</span>`);
            else if (parseInt(lev, 10) < new Date().getFullYear()) jelek.push(`<span class="profil-jel rossz">⚠️ Licenc lejárt (${escapeHtml(lev)})</span>`);
            else jelek.push(`<span class="profil-jel jo">Licenc ${escapeHtml(lev)}</span>`);
        }
        if (tipus === 'lovas') {
            const l = computeNemzetiMinosites(new Date().getFullYear()).find(x => x.license === id);
            if (l && l.osztaly) jelek.push(`<span class="profil-jel">${nemzetiOsztalyJel(l.osztaly)} minősítés</span>`);
        } else {
            const v = loVersenymentes(id, profilHivatalosCache['lo:' + id]);
            if (v && v.mervado) jelek.push(v.pihen
                ? `<button type="button" class="profil-jel figyel" onclick="profilFulValt('adatlap')">⏸️ Pihen – ${escapeHtml(v.mervado.szabad)}-tól indulhat</button>`
                : `<span class="profil-jel jo">✅ Szabadon indulhat</span>`);
        }
        return `<div class="profil-jelek">${kovetesGombHtml(tipus, id)}${jelek.join('')}</div>`;
    }

    // Összesítő a kiválasztott forrás + év eredményeiről
    function profilOsszegzo(sorok) {
        if (!sorok.length) return '';
        const telj = sorok.filter(r => !r.kiesett);
        const gyoz = telj.filter(r => r.hely === 1).length;
        const dobogo = telj.filter(r => r.hely >= 1 && r.hely <= 3).length;
        const km = Math.round(telj.reduce((s, r) => s + (parseFloat(r.kmKulcs || r.km) || 0), 0));
        const stat = (ertek, cimke, extra = '') => `<div class="profil-stat"><b>${ertek}${extra}</b><span>${cimke}</span></div>`;
        return `<div class="profil-statok">
            ${stat(sorok.length, 'rajt')}
            ${stat(telj.length, 'teljesített', ` <small>${Math.round(telj.length / sorok.length * 100)}%</small>`)}
            ${stat(gyoz, 'győzelem')}
            ${stat(dobogo, 'dobogó')}
            ${km ? stat(km.toLocaleString('hu-HU'), 'km') : ''}
        </div>`;
    }

    function renderProfil() {
        if (!profilAllapot) return;
        const { tipus, id, forras } = profilAllapot;
        const torzs = tipus === 'lovas' ? (ridersCache[sanitizeKey(id)] || {}) : (horsesCache[sanitizeKey(id)] || {});
        const ismert = !!torzs.name;
        const admin = document.body.classList.contains('role-admin');
        let ful = profilAllapot.ful || 'eredmenyek';
        if (ful === 'ujonc' && !admin) ful = 'eredmenyek';

        const alcimReszek = tipus === 'lovas'
            ? [torzs.club, torzs.ageGroup, torzs.country]
            : [torzs.startNum ? 'start szám ' + torzs.startNum : '', [torzs.color, torzs.sex].filter(Boolean).join(' '), torzs.birthYear];
        const alcim = alcimReszek.filter(Boolean).map(x => escapeHtml(String(x))).join(' · ');

        // Forrásonkénti darabszám: a kapcsolón látszik, hol van egyáltalán adat.
        const magyarSorok = profilMagyarEredmenyek();
        const feiSorok = profilFeiEredmenyek();
        const darab = { magyar: magyarSorok.length, nemzetkozi: feiSorok.length };
        const aktivSorok = forras === 'nemzetkozi' ? feiSorok : magyarSorok;

        // Évek: csak amelyikben az aktív forrásban tényleg van eredmény (darabszámmal a gombon)
        const evDarab = {};
        aktivSorok.forEach(r => { const y = String(r.ev || ''); if (y) evDarab[y] = (evDarab[y] || 0) + 1; });
        const evek = Object.keys(evDarab).sort((a, b) => b.localeCompare(a));

        // Alapértelmezett év: az aktív forrás legutóbbi éve, amelyben tényleg van eredmény - aki
        // idén versenyzett, annál 2026, aki nem, annál az utolsó aktív éve. Ha a választott év a
        // másik forrásban nem létezik, szintén a legutóbbi évre állunk vissza.
        if (profilAllapot.evAuto || (profilAllapot.ev !== 'osszes' && !evDarab[profilAllapot.ev] && !profilTolt)) {
            profilAllapot.ev = evek.length ? evek[0] : 'osszes';
        }
        const ev = profilAllapot.ev || 'osszes';

        const szurtek = (ev === 'osszes' ? aktivSorok : aktivSorok.filter(r => String(r.ev) === String(ev)))
            .sort((a, b) => String(b.datum || '').localeCompare(String(a.datum || '')));

        const forrasGomb = (kulcs, cimke) =>
            `<button type="button" class="profil-forras ${forras === kulcs ? 'aktiv' : ''}" ${darab[kulcs] ? '' : 'disabled'} onclick="profilForrasValt('${kulcs}')">${cimke} <small>${darab[kulcs]}</small></button>`;
        const evGomb = (ertek, cimke, n) =>
            `<button type="button" class="profil-evgomb ${String(ev) === ertek ? 'aktiv' : ''}" onclick="profilEvValt('${ertek}')">${cimke} <small>${n}</small></button>`;
        const fulGomb = (kulcs, cimke) =>
            `<button type="button" role="tab" aria-selected="${ful === kulcs}" class="profil-ful ${ful === kulcs ? 'aktiv' : ''}" onclick="profilFulValt('${kulcs}')">${cimke}</button>`;

        let panel;
        if (ful === 'adatlap') {
            panel = `${tipus === 'lo' ? loPihenoHtml(id) : ''}
                ${ismert
                    ? (tipus === 'lovas' ? profilLovasTorzsadat(torzs, id) : profilLoTorzsadat(torzs, id))
                      + (!torzs.siteSyncedAt ? `<p class="profil-megjegyzes">Nincs hivatalos szövetségi adat ehhez a ${tipus === 'lovas' ? 'versenyzőhöz' : 'lóhoz'}.</p>` : '')
                    : `<p class="profil-megjegyzes">Ez a ${tipus === 'lovas' ? 'versenyző' : 'ló'} nincs a törzsadatban – csak a saját versenyeink eredményei érhetők el.</p>`}`;
        } else if (ful === 'ujonc') {
            panel = ujoncTartalom(tipus, id);
        } else {
            // Összes évnél évenként fejléc, hogy görgetve is látszódjon, hol tartunk.
            let lista = '';
            if (ev === 'osszes') {
                let elozoEv = null;
                szurtek.forEach(r => {
                    const y = String(r.ev || '–');
                    if (y !== elozoEv) { lista += `<div class="profil-evfej">${escapeHtml(y)} <small>${evDarab[y] || 0} verseny</small></div>`; elozoEv = y; }
                    lista += profilEredmenyKartya(r, tipus);
                });
            } else {
                lista = szurtek.map(r => profilEredmenyKartya(r, tipus)).join('');
            }
            panel = `<div class="profil-szuro">
                    ${darab.nemzetkozi ? `<div class="profil-forrasok">${forrasGomb('magyar', '🇭🇺 Magyar')}${forrasGomb('nemzetkozi', '🌍 Nemzetközi')}</div>` : ''}
                    ${evek.length ? `<div class="profil-evek">${evGomb('osszes', 'Összes', aktivSorok.length)}${evek.map(y => evGomb(y, escapeHtml(y), evDarab[y])).join('')}</div>` : ''}
                </div>
                ${profilOsszegzo(szurtek)}
                <div class="profil-lista">${lista}${betoltesJelzesAProfilban(szurtek.length, ev)}</div>`;
        }

        // Újrarajzoláskor (pl. betöltött a hivatalos lista) ne ugorjon a lista a tetejére.
        const regiPanel = document.querySelector('#modalBody .profil-panel');
        const nezetKulcs = [tipus, id, ful, forras, ev].join('|');
        const gorgetes = regiPanel && regiPanel.dataset.kulcs === nezetKulcs ? regiPanel.scrollTop : 0;

        document.getElementById('modalBody').innerHTML = `<div class="profil">
            <div class="profil-fejlec">
                <div class="profil-monogram">${profilMonogram(tipus, torzs, id)}</div>
                <div style="flex:1; min-width:0;">
                    <h3 class="profil-nev">${escapeHtml(torzs.name || id)}</h3>
                    <div class="profil-alcim">${alcim || (tipus === 'lovas' ? 'Ig. szám: ' + escapeHtml(id) : 'Start szám: ' + escapeHtml(id))}</div>
                </div>
                ${profilElozmeny.length ? `<button class="profil-vissza" onclick="profilVissza()">← Vissza</button>` : ''}
            </div>
            ${profilJelek(tipus, id, torzs, ismert)}
            <div class="profil-fulek" role="tablist">
                ${fulGomb('eredmenyek', `Eredmények <small>${darab.magyar + darab.nemzetkozi}</small>`)}
                ${fulGomb('adatlap', 'Adatlap')}
                ${admin ? fulGomb('ujonc', 'FEI újonc') : ''}
            </div>
            <div class="profil-panel" data-kulcs="${escapeHtml(nezetKulcs)}">${panel}</div>
        </div>`;
        if (gorgetes) document.querySelector('#modalBody .profil-panel').scrollTop = gorgetes;
    }

    // Ranglistákon (egyéni, ló, csapat) mindenhol ugyanígy jelenik meg egy lovas/ló neve - kattintható
    // link, ami az adott profil (openRiderProfile/openHorseProfile) versenytörténet-táblázatát nyitja meg.
    // Ha nincs azonosító (pl. igazolási szám nélküli, kézzel felvitt versenyző), sima szöveg marad.
    function riderLink(name, license) {
        const label = name || license || '-';
        return license ? `<span class="name-link" onclick="openRiderProfile('${license}')">${label}</span>` : label;
    }

    function horseLink(name, startNum) {
        const label = name || startNum || '?';
        return startNum ? `<span class="name-link" onclick="openHorseProfile('${startNum}')">${label}</span>` : label;
    }

    function renderTorzsLovasokList() {
        const cont = document.getElementById('torzs-lovasok-list');
        if (!cont) return;
        const q = (document.getElementById('torzs-lovasok-search')?.value || '').trim().toLowerCase();
        const riders = Object.values(ridersCache).filter(r => r && r.name)
            .filter(r => !q || r.name.toLowerCase().includes(q) || (r.license || '').toLowerCase().includes(q) || (r.club || '').toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

        if (!riders.length) { cont.innerHTML = `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs találat.</p>`; return; }

        cont.innerHTML = riders.map(r => `
            <div class="competitor-item" style="cursor:pointer;" onclick="openRiderProfile('${r.license}')">
                <div style="flex:1;"><b>${r.name}</b><br><span style="color:var(--text-dim); font-size:0.85rem;">${r.club || 'Nincs egyesület megadva'} · Ig. szám: ${r.license}</span></div>
                <div class="adatlap-arrow">❯</div>
            </div>
        `).join('');
    }

    function renderTorzsLovakList() {
        const cont = document.getElementById('torzs-lovak-list');
        if (!cont) return;
        const q = (document.getElementById('torzs-lovak-search')?.value || '').trim().toLowerCase();
        const horses = Object.values(horsesCache).filter(h => h && h.name)
            .filter(h => !q || h.name.toLowerCase().includes(q) || (h.startNum || '').toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

        if (!horses.length) { cont.innerHTML = `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs találat.</p>`; return; }

        cont.innerHTML = horses.map(h => `
            <div class="competitor-item" style="cursor:pointer;" onclick="openHorseProfile('${h.startNum}')">
                <div style="flex:1;"><b>${h.name}</b><br><span style="color:var(--text-dim); font-size:0.85rem;">Start szám: ${h.startNum}</span></div>
                <div class="adatlap-arrow">❯</div>
            </div>
        `).join('');
    }

    // Az egyéni bajnokság kizárólag a magyar versenyzőknek szól, még ha egy külföldi vendég be is
    // fut egy hazai OB-fordulón. Döntési sorrend:
    //  1. a riders/{license}.foreign jelző, ha ki van töltve (a szövetségi szinkronból jön - pl. az
    //     argentin, de magyar licences Jarenko Denis foreign: false, tehát ő magyar);
    //  2. ha nincs jelző (új, még nem szinkronizált lovas, vagy a régi mentési hiba törölte -
    //     így került be Mishari Almuamar a bajnokságba): a klub helyén álló 3 betűs országkód
    //     (AUT, CRO, KSA...), vagy K-betűs igazolási szám, ami nincs a szövetségi adatbázisban.
    //     A K előtag önmagában NEM elég, magyar versenyző is kaphat nemzetközi (CEI) K-számot -
    //     ezért csak akkor számít, ha a lovasnak nincs szövetségi (siteSyncedAt) adata.
    // A jelzőt az admin a Versenyző pontkeresőben kézzel is átállíthatja (toggleForeign).
    function isForeignLicense(license, club) {
        const rider = ridersCache[sanitizeKey(license || '')];
        if (rider && typeof rider.foreign === 'boolean') return rider.foreign;
        const klub = String(club || (rider && rider.club) || '').trim();
        if (/^[A-Z]{3}$/.test(klub) && klub !== 'HUN') return true;
        if (/^K\d/i.test(String(license || '').trim()) && !(rider && rider.siteSyncedAt)) return true;
        return false;
    }

    function toggleForeign(license) {
        const most = isForeignLicense(license);
        db.ref('riders/' + sanitizeKey(license) + '/foreign').set(!most).then(() => {
            showToast(!most ? '🌍 Külföldinek jelölve - kimarad a magyar bajnokságból' : '🇭🇺 Magyarnak jelölve - beszámít a magyar bajnokságba');
            openRiderPointsBreakdown(license);
        }).catch(e => showToast('Hiba: ' + e.message, true));
    }

    // A hivatalos bajnoki táblázat a külföldiek kihagyása UTÁN újraszámozza a mezőnyt versenyen +
    // távon belül - aki mögöttük állt, előrébb lép (l. JAVITAS_bajnoki_pontszamitas.md, 2. pont).
    // A kiesettek (place == null) nem foglalnak helyet, ki vannak hagyva a számozásból.
    // Aki lemondott az ob-pontról (obPont: false) de magyar, MEGTARTJA a helyét - a számozás csak
    // a külföldieket ugorja át, az obPont-szűrés ettől független és később, külön történik.
    // "raceId|bib" kulccsal dolgozik (nem sor-referenciával), hogy a getAllPastRaceRows() bármelyik
    // független hívásából épült sorral újra felhasználható legyen (pl. a pontkeresőnél is).
    function renumberWithoutForeign(allRows) {
        const byRaceCat = {};
        allRows.forEach(r => {
            if (r.place == null) return;
            const k = r.raceId + '|' + r.dist;
            (byRaceCat[k] = byRaceCat[k] || []).push(r);
        });
        const out = new Map(); // "raceId|bib" -> új helyezés
        Object.values(byRaceCat).forEach(list => {
            list.sort((a, b) => a.place - b.place);
            let n = 0;
            list.forEach(r => { if (!isForeignLicense(r.license, r.club)) out.set(r.raceId + '|' + r.bib, ++n); });
        });
        return out;
    }

    // 174. § (2) holtverseny-szabály: pontegyenlőségnél az előrébb, aki több km-t teljesített
    // eredményesen, utána akinek a pontjai magasabb kategóriájú (hosszabb) versenyről jöttek. Ha
    // ez sem dönt, holtverseny: azonos helyezés, az utánuk következő hely betöltetlen marad.
    const SAV_RANG = { band40_49: 1, band50_79: 2, band80_99: 3, band100_119: 4, band120_139: 5, band140_160: 6 };

    function rangsorol(lista) {
        lista.sort((a, b) => (b.totalPoints - a.totalPoints) || ((b.totalKm || 0) - (a.totalKm || 0)) || ((b.legjobbSav || 0) - (a.legjobbSav || 0)));
        lista.forEach((r, i) => {
            const elozo = lista[i - 1];
            const holtverseny = elozo && elozo.totalPoints === r.totalPoints && (elozo.totalKm || 0) === (r.totalKm || 0) && (elozo.legjobbSav || 0) === (r.legjobbSav || 0);
            r.rank = holtverseny ? elozo.rank : i + 1;
        });
        return lista;
    }

    // --- 1. EGYÉNI BAJNOKSÁG (3 osztály, "legkorábban nevezett N ló" szabály + 174.§(3) dedup) ---
    // Csak magyar versenyzőkre vonatkozik - a külföldiek (riders/{license}.foreign) kimaradnak,
    // a megmaradók helyezése a renumberWithoutForeign() szerint újraszámozva (l. fent). Ez KIZÁRÓLAG
    // az egyéni bajnokságra vonatkozik - a ló-ranglista és a verseny-eredménynézet a nyers
    // helyezésnél marad, ott a tényleges versenyeredmény a helyes.
    function computeIndividualChampionship(classKey, year) {
        const cls = CHAMPIONSHIP_CLASSES[classKey];
        const win = getChampionshipWindow(year);
        const allRows = getAllPastRaceRows();
        const renumbered = renumberWithoutForeign(allRows);
        // Minden OB-NEVEZÉS ebben az osztályban - a kiesettek is. A 175. § szerint "az időben
        // legkorábban benevezett két ló" számít, vagyis egy kiesett rajt is "elhasznál" egy lóhelyet.
        // Az OB-pontról lemondott rajt (obPont: false) nem OB-nevezés, az nem foglal lóhelyet.
        const entries = allRows.filter(r =>
            r.isObRound && cls.distKeys.includes(r.dist) && r.obPont && isDateInWindow(r.raceDate, win) && !isForeignLicense(r.license, r.club)
        ).map(r => {
            const newPlace = r.place != null ? renumbered.get(r.raceId + '|' + r.bib) : null;
            return newPlace != null ? Object.assign({}, r, { place: newPlace }) : r;
        });

        const byRider = {};
        entries.forEach(r => {
            const key = r.license || ('bib:' + r.bib + ':' + r.name);
            if (!byRider[key]) byRider[key] = { license: r.license, name: r.name, club: r.club, results: [] };
            byRider[key].results.push(r);
            if (r.name) byRider[key].name = r.name;
            if (r.club) byRider[key].club = r.club;
        });

        const riders = [];
        Object.values(byRider).filter(rider => rider.results.some(r => r.place != null)).forEach(rider => {
            const byHorse = {};
            rider.results.forEach(r => {
                const hKey = r.startNum || ('horse:' + r.horseName);
                if (!byHorse[hKey]) byHorse[hKey] = { startNum: r.startNum, horseName: r.horseName, results: [], firstDate: r.raceDate };
                byHorse[hKey].results.push(r);
                if (r.raceDate && r.raceDate < byHorse[hKey].firstDate) byHorse[hKey].firstDate = r.raceDate;
            });
            const horsesSorted = Object.values(byHorse).sort((a, b) => (a.firstDate || '').localeCompare(b.firstDate || ''));
            // A hivatalos (szövetségi) név az elsődleges - a nevezésben előfordul elírás.
            const torzsNev = rider.license && (ridersCache[sanitizeKey(rider.license)] || {}).name;
            const alapNev = torzsNev || rider.name;

            // "KLÓN" SOROK: aki 2-nél több lóval versenyzett, annak a lovai benevezési sorrendben
            // párokba kerülnek - az 1-2. ló az eredeti sorba, a 3-4. ló egy második, "(2)" jelű sorba,
            // az 5-6. ló egy harmadik, "(3)" sorba és így tovább (felhasználói kérés, 2026-10-05).
            for (let klon = 0; klon * cls.maxHorses < horsesSorted.length; klon++) {
                const parLovai = horsesSorted.slice(klon * cls.maxHorses, (klon + 1) * cls.maxHorses);
                let totalPoints = 0, totalKm = 0, legjobbSav = 0;
                const horseBreakdown = parLovai.map(h => {
                    // 174. § (3): azonos verseny, azonos táv-kategória két futamánál csak a jobbik pont számít
                    const byRaceCat = {};
                    h.results.filter(r => r.place != null).forEach(r => {
                        const rcKey = r.raceId + '|' + r.dist;
                        const pts = getPoints(getPointBand(r.completedKm), r.place);
                        if (!byRaceCat[rcKey] || pts > byRaceCat[rcKey].points) byRaceCat[rcKey] = Object.assign({ points: pts }, r);
                    });
                    const dedupedResults = Object.values(byRaceCat).sort((a, b) => (a.raceDate || '').localeCompare(b.raceDate || ''));
                    const horsePoints = dedupedResults.reduce((s, r) => s + r.points, 0);
                    totalPoints += horsePoints;
                    dedupedResults.forEach(r => {
                        totalKm += r.completedKm || 0;
                        if (r.points > 0) legjobbSav = Math.max(legjobbSav, SAV_RANG[getPointBand(r.completedKm)] || 0);
                    });
                    return { startNum: h.startNum, horseName: h.horseName, points: horsePoints, results: dedupedResults };
                }).filter(h => h.results.length);
                if (!horseBreakdown.length) continue;   // ennek a lópárnak egyik lova sem ért el helyezést

                riders.push({
                    license: rider.license, name: klon ? `${alapNev} (${klon + 1})` : alapNev, alapNev, klon,
                    lovakTol: klon * cls.maxHorses + 1, lovakIg: Math.min((klon + 1) * cls.maxHorses, horsesSorted.length),
                    club: rider.club, totalPoints, totalKm: Math.round(totalKm * 100) / 100, legjobbSav,
                    horses: horseBreakdown, excludedHorseCount: 0
                });
            }
        });

        return rangsorol(riders);
    }

    // Összesített nézet: mindhárom bajnoki osztály eredményét egyetlen ranglistába vonja össze
    // (osztály-szűrés nélkül) - egy lovas, aki több osztályban is szerzett pontot, összesítve
    // szerepel, a classBreakdown mutatja, honnan jött a pontja.
    function computeIndividualChampionshipAll(year) {
        const merged = {};
        Object.keys(CHAMPIONSHIP_CLASSES).forEach(classKey => {
            computeIndividualChampionship(classKey, year).forEach(r => {
                // A klón sorok (3-4. ló stb.) külön sorként maradnak az összesítettben is.
                const key = (r.license || r.alapNev || r.name) + '#' + (r.klon || 0);
                if (!merged[key]) merged[key] = { license: r.license, name: r.name, klon: r.klon || 0, club: r.club, totalPoints: 0, totalKm: 0, legjobbSav: 0, classBreakdown: [] };
                merged[key].totalPoints += r.totalPoints;
                merged[key].totalKm += r.totalKm || 0;
                merged[key].legjobbSav = Math.max(merged[key].legjobbSav, r.legjobbSav || 0);
                if (r.name) merged[key].name = r.name;
                if (r.club) merged[key].club = r.club;
                merged[key].classBreakdown.push({ classKey, label: CHAMPIONSHIP_CLASSES[classKey].label, points: r.totalPoints });
            });
        });
        return rangsorol(Object.values(merged));
    }

    // --- Egy saját versenyen elért eredményre TÉNYLEGESEN beszámított bajnoki pont ---
    // A profil-kártyák és a pontkereső ebből dolgozik, hogy pontosan azt mutassák, ami a hivatalos
    // táblázatba bekerült (külföldiek nélküli helyezés, max. 2 ló, 174. § (3)) - nem egy nyers
    // táblázati értéket. A "min.pont" (a szövetség minősítő pontja) helyett ez látszik.
    function getBajnokiEv(datum) {
        const ev = parseInt(String(datum || '').slice(0, 4), 10);
        if (isNaN(ev)) return null;
        return (!isDateInWindow(datum, getChampionshipWindow(ev)) && isDateInWindow(datum, getChampionshipWindow(ev + 1))) ? ev + 1 : ev;
    }

    // ev -> { eredmeny: Map("raceId|bib" -> {points, place, classKey, klon}) }
    function getBeszamitottEredmenyek(ev) {
        const eredmeny = new Map();
        Object.keys(CHAMPIONSHIP_CLASSES).forEach(classKey => {
            computeIndividualChampionship(classKey, ev).forEach(rider => {
                rider.horses.forEach(h => h.results.forEach(r => {
                    eredmeny.set(r.raceId + '|' + r.bib, { points: r.points, place: r.place, classKey, klon: rider.klon || 0 });
                }));
            });
        });
        return { eredmeny };
    }

    // r: getAllPastRaceRows() sor. cache: { ev -> getBeszamitottEredmenyek(ev) } (hívásonként újra-
    // használva, mert egy profilban sok sor van). Visszaad: { points, place (OB-helyezés), classKey, note }.
    function getObPontInfo(r, renumbered, cache) {
        const kulcs = r.raceId + '|' + r.bib;
        const obHely = renumbered.has(kulcs) ? renumbered.get(kulcs) : r.place;
        const classKey = Object.keys(CHAMPIONSHIP_CLASSES).find(k => CHAMPIONSHIP_CLASSES[k].distKeys.includes(r.dist)) || null;
        const ev = getBajnokiEv(r.raceDate);
        if (ev != null && !cache[ev]) cache[ev] = getBeszamitottEredmenyek(ev);
        const besz = ev != null ? cache[ev] : null;
        const talalat = besz && besz.eredmeny.get(kulcs);
        if (talalat) return { points: talalat.points, place: talalat.place, classKey: talalat.classKey, klon: talalat.klon || 0, note: '' };

        let note = '';
        if (!r.isObRound) note = 'nem OB-forduló';
        else if (!classKey) note = (catNames[r.dist] || r.dist) + ': nem bajnoki táv';
        else if (isForeignLicense(r.license, r.club)) note = 'külföldi versenyző';
        else if (!r.obPont) note = 'lemondott az OB-pontról';
        else if (r.isEliminated || r.place == null) note = 'nincs helyezés';
        else if (!getPointBand(r.completedKm)) note = 'nincs megtett km (hiányzó kör-adat)';
        // A 3. és további lovak pontjai a lovas "klón" sorába kerülnek (l. computeIndividualChampionship),
        // így ha egy helyezett eredmény mégsem számít, annak csak a 174. § (3) lehet az oka.
        else note = 'nem számít: ugyanazon a versenyen csak a jobbik (174. § (3))';
        return { points: 0, place: obHely, classKey, klon: 0, note };
    }

    // --- 2. LÓ-RANGLISTA (a lo-lovas-integracio.md törzsadatára épül - minden kategóriájú verseny számít) ---
    // nemzetkoziIs = false: csak a hazai versenyek (ez az alapértelmezett nézet).
    function computeHorseRanking(year, nemzetkoziIs) {
        const win = getChampionshipWindow(year);
        const byHorse = {};

        getAllPastRaceRows().filter(r => isDateInWindow(r.raceDate, win) && r.completedKm > 0 && r.startNum).forEach(r => {
            if (!byHorse[r.startNum]) byHorse[r.startNum] = { startNum: r.startNum, horseName: r.horseName, totalKm: 0, raceCount: 0, clubs: {}, lastRider: '', lastRiderLicense: '', lastDate: '' };
            const e = byHorse[r.startNum];
            e.totalKm += r.completedKm;
            e.raceCount += 1;
            if (r.horseName) e.horseName = r.horseName;
            if (r.club) e.clubs[r.club] = (e.clubs[r.club] || 0) + r.completedKm;
            if (r.raceDate >= e.lastDate) { e.lastDate = r.raceDate; e.lastRider = r.name; e.lastRiderLicense = r.license || ''; }
        });

        // Külföldi (externalResults) eredmények is beszámítanak, ha ismert a ló azonosítója (l. terv 3.4).
        // FONTOS: a kiesett (FTQ/RET/DSQ) nemzetközi rajt km-je NEM számít - a ló nem teljesítette a
        // távot. A hazai soroknál ezt a completedKm intézi (ott tudjuk, hány kört ment), a FEI
        // rekordban viszont csak a kiírt táv van, ezért a státuszos rekordot egészben kihagyjuk.
        (nemzetkoziIs ? Object.values(externalResultsCache) : []).filter(ex => ex.horseStartNum && !ex.status && isDateInWindow(ex.date, win)).forEach(ex => {
            const km = parseFloat(ex.distanceKm) || 0;
            if (km <= 0) return;
            if (!byHorse[ex.horseStartNum]) {
                const h = horsesCache[sanitizeKey(ex.horseStartNum)] || {};
                byHorse[ex.horseStartNum] = { startNum: ex.horseStartNum, horseName: h.name || ex.horseStartNum, totalKm: 0, raceCount: 0, clubs: {}, lastRider: '', lastRiderLicense: '', lastDate: '' };
            }
            const e = byHorse[ex.horseStartNum];
            e.totalKm += km;
            e.raceCount += 1;
            const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
            if (riderInfo.club) e.clubs[riderInfo.club] = (e.clubs[riderInfo.club] || 0) + km;
            if (ex.date >= e.lastDate) { e.lastDate = ex.date; e.lastRider = riderInfo.name || ex.license; e.lastRiderLicense = ex.license || ''; }
        });

        return Object.values(byHorse).map(e => ({ ...e, totalKm: Math.round(e.totalKm * 100) / 100 })).sort((a, b) => b.totalKm - a.totalKm);
    }

    // --- 4. EGYESÜLETI BONTÁS (nem hivatalos - a fenti ranglisták klubonkénti összesítése) ---
    function computeClubBreakdownPoints(riders) {
        const byClub = {};
        riders.forEach(r => {
            const club = r.club || 'Ismeretlen egyesület';
            byClub[club] = (byClub[club] || 0) + r.totalPoints;
        });
        return Object.entries(byClub).map(([club, points]) => ({ club, points })).sort((a, b) => b.points - a.points);
    }

    function computeClubBreakdownKm(horseRows) {
        const byClub = {};
        horseRows.forEach(h => {
            Object.entries(h.clubs).forEach(([club, km]) => { byClub[club] = (byClub[club] || 0) + km; });
        });
        return Object.entries(byClub).map(([club, km]) => ({ club, km: Math.round(km * 100) / 100 })).sort((a, b) => b.km - a.km);
    }

    // --- 3. CSAPATBAJNOKSÁG ---
    // A csapat sorrendje MINDIG a pontok alapján dől el (ugyanaz a getPoints/getPointBand
    // számítás, mint az egyéni bajnokságnál) - a km csak egy alternatív megjelenítés ugyanerre
    // a listára, nem egy külön rendezési szempont (l. felhasználói javítás).
    function computeTeamChampionship(year) {
        const win = getChampionshipWindow(year);
        // Az obPont=false eredmény a csapatbajnokságból is kimarad, ugyanúgy, ahogy az egyéniből
        // (l. computeIndividualChampionship). A szűrés a rows szintjén van, hogy az obParticipants
        // ("OB-jogosult") halmazba se számítson bele egy ilyen indulás: akinek az adott évben CSAK
        // obPont=false hazai indulása van, az nem OB-jogosult, tehát a FEI pontjai sem számítanak.
        const rows = getAllPastRaceRows().filter(r => r.obPont !== false);

        // Ki "OB-jogosult" ebben az időszakban: legalább egyszer elindult hazai ob-fordulón, >= 40 km-en
        // (visszamenőleg is teljesülhet - l. terv 3.3, ezért a teljes időszakot előre összegyűjtjük).
        const obParticipants = new Set();
        rows.filter(r => isDateInWindow(r.raceDate, win) && r.isObRound && r.km >= 40 && r.license).forEach(r => obParticipants.add(r.license));

        const homeQualified = rows.filter(r => isDateInWindow(r.raceDate, win) && r.km >= 40 && r.place != null && r.license && obParticipants.has(r.license));
        const externalQualified = Object.values(externalResultsCache).filter(e => isDateInWindow(e.date, win) && e.license && obParticipants.has(e.license));

        const teams = Object.entries(teamsCache).map(([teamId, t]) => {
            const members = t.memberLicenses || [];
            let totalPoints = 0, totalKm = 0;
            const memberBreakdown = members.map(lic => {
                const homeResults = homeQualified.filter(r => r.license === lic);
                const homePoints = homeResults.reduce((s, r) => s + getPoints(getPointBand(r.completedKm), r.place), 0);
                const homeKm = homeResults.reduce((s, r) => s + r.completedKm, 0);

                const extResults = externalQualified.filter(e => e.license === lic);
                const extPoints = extResults.reduce((s, e) => s + getPoints(getPointBand(parseFloat(e.distanceKm) || 0), parseInt(e.place, 10) || null), 0);
                const extKm = extResults.reduce((s, e) => s + (parseFloat(e.distanceKm) || 0), 0);

                const points = homePoints + extPoints;
                const km = Math.round((homeKm + extKm) * 100) / 100;
                totalPoints += points; totalKm += km;
                const riderInfo = ridersCache[sanitizeKey(lic)] || {};
                return { license: lic, name: riderInfo.name || lic, points, km, isObQualified: obParticipants.has(lic) };
            });
            return { teamId, name: t.name, contact: t.contact || '', totalPoints, totalKm: Math.round(totalKm * 100) / 100, members: memberBreakdown };
        });

        teams.sort((a, b) => b.totalPoints - a.totalPoints);
        return teams;
    }

    // --- RENDER: Egyéni bajnokság ---
    let egyeniYear = new Date().getFullYear();

    let egyeniClassKey = 'tavlovas';

    // ============================================================================
    // NEMZETI MINŐSÍTÉS (171. §): a magyar versenyzők osztályba sorolása a tárgyév (jan. 1 - dec. 31)
    // eredményei alapján. Pont = a bajnoki fordulókon elért helyezések III. melléklet szerinti pontja
    // + a FEI (CEI/CEIO) versenyeken elért helyezések pontjának másfélszerese. A lovak számától és a
    // kategóriától függetlenül minden eredmény számít (171. § (3)) - itt nincs "legkorábban nevezett
    // két ló" korlát. Egy rendezvényen ugyanazon bajnoki osztály két futamából csak a jobbik számít
    // (174. § (3)); az OB-pontról lemondott futam (obPont: false) nem számít.
    // ============================================================================
    const NEMZETI_OSZTALYOK = [
        { nev: 'I. osztály', min: 350, szint: 1 },
        { nev: 'II. osztály', min: 300, szint: 2 },
        { nev: 'III. osztály', min: 260, szint: 3 },
    ];
    function nemzetiOsztaly(pont) { return NEMZETI_OSZTALYOK.find(o => pont >= o.min) || null; }

    function bajnokiOsztalyKulcs(dist) {
        return Object.keys(CHAMPIONSHIP_CLASSES).find(k => CHAMPIONSHIP_CLASSES[k].distKeys.includes(dist)) || null;
    }

    function computeNemzetiMinosites(year) {
        const ev = String(year);
        const allRows = getAllPastRaceRows();
        const renumbered = renumberWithoutForeign(allRows);
        const lovasok = {};
        const lovas = (license, name, club) => {
            if (!lovasok[license]) {
                const torzs = ridersCache[sanitizeKey(license)] || {};
                lovasok[license] = { license, name: torzs.name || name || license, club: torzs.club || club || '', obPont: 0, feiPont: 0, tetelek: [] };
            }
            return lovasok[license];
        };

        // Hazai bajnoki fordulók - versenyenként és bajnoki osztályonként a jobbik eredmény
        const legjobb = {};
        allRows.forEach(r => {
            if (!r.isObRound || !r.obPont || r.place == null || !r.license || !String(r.raceDate).startsWith(ev)) return;
            if (isForeignLicense(r.license, r.club)) return;
            const oszt = bajnokiOsztalyKulcs(r.dist);
            if (!oszt) return;
            const hely = renumbered.get(r.raceId + '|' + r.bib) || r.place;
            const pont = getPoints(getPointBand(r.completedKm), hely);
            const k = r.license + '|' + r.raceId + '|' + oszt;
            if (!legjobb[k] || pont > legjobb[k].pont) legjobb[k] = { r, hely, pont };
        });
        Object.values(legjobb).forEach(({ r, hely, pont }) => {
            if (!pont) return;
            const l = lovas(r.license, r.name, r.club);
            l.obPont += pont;
            l.tetelek.push({ datum: r.raceDate, verseny: r.raceName, tav: r.km + ' km', lo: r.horseName, hely, pont, fei: false });
        });

        // FEI (CEI/CEIO) eredmények: a táblázat szerinti pont másfélszerese (171. § (2))
        Object.values(externalResultsCache).forEach(ex => {
            if (!ex || ex.status || !ex.license || !(parseInt(ex.place, 10) > 0) || !String(ex.date || '').startsWith(ev)) return;
            if (isForeignLicense(ex.license)) return;
            const alap = getPoints(getPointBand(parseFloat(ex.distanceKm) || 0), parseInt(ex.place, 10));
            if (!alap) return;
            const l = lovas(ex.license, ex.riderName, '');
            l.feiPont += alap * 1.5;
            l.tetelek.push({ datum: ex.date, verseny: (ex.event || 'FEI verseny') + (ex.venue ? ' – ' + ex.venue : ''), tav: (ex.distanceKm || '?') + ' km', lo: ex.horseName, hely: parseInt(ex.place, 10), pont: alap * 1.5, alap, fei: true });
        });

        return Object.values(lovasok).map(l => {
            const osszes = Math.round((l.obPont + l.feiPont) * 10) / 10;
            l.tetelek.sort((a, b) => String(a.datum).localeCompare(String(b.datum)));
            return Object.assign(l, { feiPont: Math.round(l.feiPont * 10) / 10, osszes, osztaly: nemzetiOsztaly(osszes) });
        }).filter(l => l.osszes > 0).sort((a, b) => (b.osszes - a.osszes) || a.name.localeCompare(b.name, 'hu'));
    }

    const pontSzoveg = p => String(Math.round(p * 10) / 10).replace('.', ',');

    function nemzetiOsztalyJel(o) {
        return o ? `<span class="minosites-jel szint-${o.szint}">${o.nev}</span>` : '<span style="color:var(--text-dim-2);">–</span>';
    }

    function renderNemzetiMinosites(cont) {
        const lista = computeNemzetiMinosites(egyeniYear);
        const db = szint => lista.filter(l => l.osztaly && l.osztaly.szint === szint).length;
        let html = `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;">
            <h4 style="margin:0; color:var(--text);">Nemzeti minősítés ${egyeniYear} (171. §)</h4>
            <p class="field-hint" style="margin-bottom:0;">A ${egyeniYear}. január 1. és december 31. között elért eredmények alapján.
                Pont = a bajnoki fordulókon elért helyezések pontja (III. melléklet) + a FEI (CEI/CEIO) versenyek pontjának <b>másfélszerese</b>.
                Minden ló és minden kategória számít (nincs 2 lovas korlát); egy rendezvényen ugyanazon bajnoki osztály két futamából a jobbik;
                az OB-pontról lemondott futam nem számít. <b>I. osztály:</b> 350 pont felett · <b>II. osztály:</b> 300–349 · <b>III. osztály:</b> 260–299.</p>
        </div>
        <p class="field-hint" style="margin:0 0 8px 2px;">I. osztály: <b>${db(1)}</b> fő · II. osztály: <b>${db(2)}</b> fő · III. osztály: <b>${db(3)}</b> fő</p>`;
        if (!lista.length) {
            cont.innerHTML = html + `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még pontszerző eredmény erre az évre.</p>`;
            return;
        }
        html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Lovas</th><th class="col-header">Összpont</th><th class="col-header">Hazai OB</th><th class="col-header">FEI ×1,5</th><th class="col-header">Minősítés</th><th class="col-header" style="text-align:left;">Eredmények</th></tr>`;
        lista.forEach((l, i) => {
            const tetelek = l.tetelek.map(t => `<div>${escapeHtml(t.datum)} · ${escapeHtml(t.verseny)} · ${escapeHtml(t.tav)}${t.lo ? ' · ' + escapeHtml(t.lo) : ''} · ${t.hely}. hely → <b>${pontSzoveg(t.pont)}</b> p${t.fei ? ` (${t.alap} × 1,5)` : ''}</div>`).join('');
            html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${riderLink(l.name, l.license)}<br><small style="color:var(--text-dim); font-weight:400;">${escapeHtml(l.club || '')}</small></td>
                <td><b style="color:var(--primary);">${pontSzoveg(l.osszes)}</b></td><td>${pontSzoveg(l.obPont)}</td><td>${l.feiPont ? pontSzoveg(l.feiPont) : '-'}</td>
                <td>${nemzetiOsztalyJel(l.osztaly)}</td>
                <td style="text-align:left;"><details class="minosites-tetelek"><summary>${l.tetelek.length} eredmény</summary>${tetelek}</details></td></tr>`;
        });
        cont.innerHTML = html + `</table></div>`;
    }

    // A lovas profiljához: az idei minősítés egy sorban
    function nemzetiMinositesProfil(license) {
        const ev = new Date().getFullYear();
        const l = computeNemzetiMinosites(ev).find(x => x.license === license);
        if (!l) return `<span style="color:var(--text-dim);">${ev}: még nincs pontja</span>`;
        return `${nemzetiOsztalyJel(l.osztaly)} <span style="color:var(--text-dim);">${ev}: ${pontSzoveg(l.osszes)} pont${l.osztaly ? '' : ' (a III. osztályhoz 260 kell)'}</span>`;
    }

    function setEgyeniClass(key, btn) {
        egyeniClassKey = key;
        document.querySelectorAll('#egyeni-class-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderEgyeniBajnoksag();
    }

    function renderEgyeniBajnoksag() {
        const yearSel = document.getElementById('egyeni-year-select');
        if (yearSel && yearSel.options.length === 0) populateYearSelect('egyeni-year-select', egyeniYear);
        if (yearSel) egyeniYear = parseInt(yearSel.value, 10) || egyeniYear;

        const cont = document.getElementById('egyeni-bajnoksag-content');
        if (!cont) return;

        // Nemzeti minősítés (171. §) - külön számítás, naptári évre
        if (egyeniClassKey === 'minosites') { renderNemzetiMinosites(cont); return; }

        const clubView = document.getElementById('egyeni-club-toggle')?.checked;
        const isAll = egyeniClassKey === 'osszesitett';
        const riders = isAll ? computeIndividualChampionshipAll(egyeniYear) : computeIndividualChampionship(egyeniClassKey, egyeniYear);

        let html = renderSilentZeroWarningBanner();
        if (isAll) {
            html += `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;"><h4 style="margin:0; color:var(--text);">Összesített ranglista</h4><p class="field-hint" style="margin-bottom:0;">Mindhárom bajnoki osztály (Távlovas, Rövidtávú, Junior) összpontjai egyben, osztály-szűrés nélkül - mindenki rajta van, akinek van pontja.</p></div>`;
        } else {
            const cls = CHAMPIONSHIP_CLASSES[egyeniClassKey];
            html += `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;"><h4 style="margin:0; color:var(--text);">${cls.label}</h4><p class="field-hint" style="margin-bottom:0;">${cls.sub} · a legkorábban benevezett ${cls.maxHorses} ló pontjai számítanak lovasonként · csak magyar versenyzők (a külföldiek kimaradnak, a mögöttük végzők előrébb lépnek) · pontegyenlőségnél a több teljesített km dönt (174. § (2))</p></div>`;
        }

        if (riders.length === 0) {
            html += `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még pontszerző eredmény ${isAll ? 'erre az évre' : 'ebben az osztályban erre az évre'}.</p>`;
        } else if (clubView) {
            const clubs = computeClubBreakdownPoints(riders);
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Összpont</th></tr>`;
            clubs.forEach((c, i) => { html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${c.club}</td><td><b>${c.points}</b></td></tr>`; });
            html += `</table></div>`;
        } else if (isAll) {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Lovas</th><th class="col-header">Összpont</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Osztályok</th></tr>`;
            riders.forEach((r, i) => {
                const clsStr = r.classBreakdown.map(c => `${c.label.replace('Magyar ', '').replace(' Bajnokság', '')}: ${c.points} p`).join(', ');
                html += `<tr><td>${r.rank}.</td><td style="text-align:left; font-weight:700;">${riderLink(r.name, r.license)}</td><td><b style="color:var(--primary);">${r.totalPoints}</b></td><td style="text-align:left; color:var(--text-dim);">${r.club || '-'}</td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${clsStr}</td></tr>`;
            });
            html += `</table></div>`;
        } else {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Lovas</th><th class="col-header">Pont</th><th class="col-header">Lovak</th><th class="col-header" style="text-align:left;">Egyesület</th></tr>`;
            riders.forEach((r, i) => {
                const horseStr = r.horses.map(h => `${horseLink(h.horseName, h.startNum)} (${h.points} p)`).join(', ');
                // A klón sor jelzi, hányadik lovairól van szó (pl. "3-4. ló").
                const excl = r.klon ? ` <span style="color:var(--text-dim-2); font-size:0.78rem;">(${r.lovakTol}${r.lovakIg > r.lovakTol ? '-' + r.lovakIg : ''}. ló)</span>` : '';
                html += `<tr><td>${r.rank}.</td><td style="text-align:left; font-weight:700;">${riderLink(r.name, r.license)}</td><td><b style="color:var(--primary);">${r.totalPoints}</b></td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${horseStr}${excl}</td><td style="text-align:left; color:var(--text-dim);">${r.club || '-'}</td></tr>`;
            });
            html += `</table></div>`;
        }
        cont.innerHTML = html;
    }

    // ============================================================================
    // LÓ VERSENYMENTES IDŐSZAKA (140-142. §) - a ló adatlapján: pihen-e, mikor indulhat legközelebb.
    // Források: a saját versenyeink (pontos: kör-adatok, kiesési kódok, ismételt ME/GA), a szövetség
    // hivatalos lóeredményei (ha a profil már betöltötte) és a nemzetközi (FEI) eredmények. A két
    // utóbbinál csak a táv, az idő és a kiesés ténye ismert, ott az alap-pihenő (+7 nap 20 km/h felett,
    // +180/+60 nap súlyos sérülésnél) számít. Több verseny közül az a mérvadó, amelyik a legkésőbbi
    // szabad napot adja (egy régebbi, hosszú pihenő túlnyúlhat egy újabb versenyen).
    // ============================================================================
    function napIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
    function datumPlusz(datum, nap) { const d = new Date(datum + 'T00:00:00'); d.setDate(d.getDate() + nap); return napIso(d); }
    function napKulonbseg(tol, ig) { return Math.round((new Date(ig + 'T00:00:00') - new Date(tol + 'T00:00:00')) / 86400000); }
    function idoMasodperc(s) {
        const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        return m ? parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10) : 0;
    }

    // Szövetségi / FEI sor: csak táv, idő és státusz ismert
    function egyszeruPiheno(datum, verseny, km, statusz, ido, sebesseg) {
        const st = String(statusz || '').toUpperCase();
        if (/\bWD\b|DNS|VISSZAL/.test(st)) return { datum, verseny, km, nap: 0, becsult: true };
        const kiesett = !!st.trim();
        let nap = pihenoAlapNap(kiesett ? 0 : km);
        const sec = idoMasodperc(ido);
        const atlag = sebesseg ? parseFloat(String(sebesseg).replace(',', '.')) : (!kiesett && km > 0 && sec > 0 ? km / (sec / 3600) : 0);
        if (atlag > 20) nap += 7;
        if (/SI\s*MUSCO/.test(st)) nap += 180;
        if (/SI\s*META/.test(st)) nap += 60;
        return { datum, verseny, km: kiesett ? null : km, nap, becsult: true, kiesett };
    }

    function loPihenoEsemenyek(startNum, hivatalosSorok) {
        const sn = String(startNum || '').trim();
        if (!sn) return [];
        const esemenyek = [];
        const sajatNapok = new Set();
        localRaces.mult.forEach(r => {
            if (!r.date) return;
            const cfg = mergeRaceConfig(r.raceConfig);
            parseCompetitors(r.competitors).forEach(c => {
                if (String(c.startNum || '').trim() !== sn) return;
                sajatNapok.add(r.date);
                const km = c.manualEntry ? (c.isEliminated ? null : (parseInt(String(c.dist).replace('j', ''), 10) || 0)) : getCompletedKm(c, cfg);
                esemenyek.push({ datum: r.date, verseny: r.name, km, nap: pihenonapok(c, cfg, loKorabbiKiesesei(sn, r.date, r.id, hivatalosSorok)), becsult: false });
            });
        });
        (hivatalosSorok || []).forEach(h => {
            const datum = String(h.date || '').replace(/\//g, '-');
            if (!datum || sajatNapok.has(datum)) return;
            sajatNapok.add(datum);
            esemenyek.push(egyszeruPiheno(datum, h.event, parseFloat(h.distanceKm) || 0, h.status, h.time));
        });
        Object.values(externalResultsCache).forEach(ex => {
            if (!ex || String(ex.horseStartNum || '').trim() !== sn || !ex.date || sajatNapok.has(ex.date)) return;
            const seb = ex.avgSpeed || (/^\d+[.,]\d+$/.test(String(ex.score || '')) ? ex.score : null);
            esemenyek.push(egyszeruPiheno(ex.date, ex.event || 'Nemzetközi verseny', parseFloat(ex.distanceKm) || 0, ex.status, ex.rideTime || ex.score, seb));
        });
        return esemenyek;
    }

    function loVersenymentes(startNum, hivatalosSorok) {
        const esemenyek = loPihenoEsemenyek(startNum, hivatalosSorok);
        if (!esemenyek.length) return null;
        const ma = napIso(new Date());
        let mervado = null;
        esemenyek.forEach(e => {
            if (!(e.nap > 0)) return;
            // 141. §: a verseny napját követő naptól számít, a következő rajt az időszak lejártát követő napon lehet
            const szabad = datumPlusz(e.datum, e.nap + 1);
            if (!mervado || szabad > mervado.szabad) mervado = Object.assign({ szabad }, e);
        });
        const utolso = esemenyek.slice().sort((a, b) => b.datum.localeCompare(a.datum))[0];
        return { mervado, utolso, pihen: !!(mervado && mervado.szabad > ma), hatra: mervado ? napKulonbseg(ma, mervado.szabad) : 0 };
    }

    function loPihenoHtml(startNum) {
        const v = loVersenymentes(startNum, profilHivatalosCache['lo:' + startNum]);
        if (!v || !v.mervado) return '';
        const m = v.mervado;
        const ok = `${escapeHtml(m.verseny || 'verseny')} (${escapeHtml(m.datum)})${m.km ? ', ' + String(m.km).replace('.', ',') + ' km' : ''} → <b>${m.nap} nap</b>${m.becsult ? ' <span class="profil-piheno-megj">(szövetségi/FEI adatból, becsült)</span>' : ''}`;
        if (v.pihen) {
            return `<div class="profil-piheno pihen">⏸️ <b>Versenymentes időszak</b> – legkorábban <b>${escapeHtml(m.szabad)}</b>-${v.hatra === 1 ? 'tól (holnaptól)' : `tól indulhat (még ${v.hatra} nap)`}.
                <div class="profil-piheno-ok">Oka: ${ok} (140. §)</div></div>`;
        }
        return `<div class="profil-piheno szabad">✅ <b>Szabadon indulhat.</b>
            <div class="profil-piheno-ok">Utolsó kötelező pihenő: ${ok}, ${escapeHtml(datumPlusz(m.szabad, -1))}-én lejárt.</div></div>`;
    }

    // ============================================================================
    // FEI ÚJONC MINŐSÜLÉS (134-135. §) - a ló és a lovas KÜLÖN minősül: 3 éven belül két 40-79 km-es
    // és két 80-100 km-es eredményes teljesítés, mindegyik körön legfeljebb 16 km/h (139. § (2)).
    // Saját versenyeinknél a körsebességet nézzük (köridő a kör végéig, 47. §), a szövetségi és FEI
    // soroknál csak az átlag ismert. Tájékoztató - a hivatalos minősülést a FEI adatbázisa adja (135. §).
    // ============================================================================
    function ujoncTeljesitesek(tipus, id, hivatalosSorok) {
        const azon = String(id || '').trim();
        const egyezik = c => String((tipus === 'lovas' ? c.license : c.startNum) || '').trim() === azon;
        const lista = [];
        const sajat = new Set();
        localRaces.mult.forEach(r => {
            if (!r.date) return;
            const cfg = mergeRaceConfig(r.raceConfig);
            parseCompetitors(r.competitors).forEach(c => {
                if (!egyezik(c)) return;
                const nevleges = parseInt(String(c.dist || '').replace('j', ''), 10) || 0;
                const kesz = teljesitetteE(c, cfg);
                const km = c.manualEntry ? nevleges : getCompletedKm(c, cfg);
                let maxSeb = 0, korAlapjan = true;
                if (c.manualEntry) { maxSeb = c.totalTimeSec > 0 && km > 0 ? km / (c.totalTimeSec / 3600) : 0; korAlapjan = false; }
                else (c.laps || []).filter(l => l && l.isComplete).forEach(l => { maxSeb = Math.max(maxSeb, l.loopSpd || 0); });
                sajat.add(r.date + '|' + nevleges);
                lista.push({ datum: r.date, verseny: r.name, km, kesz, maxSeb, korAlapjan, partner: tipus === 'lovas' ? c.internal : c.name });
            });
        });
        (hivatalosSorok || []).forEach(h => {
            const datum = String(h.date || '').replace(/\//g, '-');
            const km = parseFloat(h.distanceKm) || 0;
            if (!datum || sajat.has(datum + '|' + km)) return;
            const kesz = !h.status && /^\d+$/.test(String(h.place || '').trim());
            const sec = idoMasodperc(h.time);
            lista.push({ datum, verseny: h.event, km, kesz, maxSeb: kesz && sec ? km / (sec / 3600) : 0, korAlapjan: false,
                partner: tipus === 'lovas' ? h.horseName || h.partnerName : h.riderName || h.partnerName });
        });
        Object.values(externalResultsCache).forEach(ex => {
            if (!ex || String((tipus === 'lovas' ? ex.license : ex.horseStartNum) || '').trim() !== azon || !ex.date) return;
            const km = parseFloat(ex.distanceKm) || 0;
            const sec = idoMasodperc(ex.rideTime || ex.score);
            const seb = ex.avgSpeed || (/^\d+[.,]\d+$/.test(String(ex.score || '')) ? parseFloat(String(ex.score).replace(',', '.')) : (sec && km ? km / (sec / 3600) : 0));
            lista.push({ datum: ex.date, verseny: (ex.event || 'Nemzetközi verseny') + (ex.venue ? ' – ' + ex.venue : ''), km, kesz: !ex.status, maxSeb: parseFloat(seb) || 0, korAlapjan: false,
                partner: tipus === 'lovas' ? ex.horseName : ex.riderName });
        });
        return lista.sort((a, b) => a.datum.localeCompare(b.datum));
    }

    function ujoncAllapot(lista) {
        const savA = t => t.km >= 40 && t.km < 80, savB = t => t.km >= 80 && t.km <= 100;
        const jelolt = lista.filter(t => t.kesz && (savA(t) || savB(t)));
        const jo = jelolt.filter(t => t.maxSeb > 0 && t.maxSeb <= 16);
        const nemSzamit = jelolt.filter(t => !(t.maxSeb > 0 && t.maxSeb <= 16));
        // Van-e olyan 3 éves időszak, amelyben 2 + 2 megfelelő teljesítés megvan?
        let teljesitve = null;
        for (let i = 0; i < jo.length && !teljesitve; i++) {
            const veg = datumPlusz(jo[i].datum, 3 * 365);
            let a = 0, b = 0;
            for (let j = i; j < jo.length && jo[j].datum <= veg; j++) {
                if (savA(jo[j])) a++; else b++;
                if (a >= 2 && b >= 2) { teljesitve = { datum: jo[j].datum, elso: jo[i].datum }; break; }
            }
        }
        const ma = napIso(new Date());
        const harom = datumPlusz(ma, -3 * 365);
        const friss = jo.filter(t => t.datum >= harom);
        return {
            teljesitve, jo, nemSzamit,
            a: friss.filter(savA).length, b: friss.filter(savB).length,
            hatarido: friss.length ? datumPlusz(friss[0].datum, 3 * 365) : null
        };
    }

    // A profil "FEI újonc" fülének tartalma - csak adminnak jelenik meg (renderProfil).
    function ujoncTartalom(tipus, id) {
        const kulcs = (tipus === 'lovas' ? 'lovas:' : 'lo:') + id;
        const lista = ujoncTeljesitesek(tipus, id, profilHivatalosCache[kulcs]);
        const all = ujoncAllapot(lista);
        const megj = `<p class="profil-megjegyzes">Tájékoztató: a ló és a lovas külön minősül (134. §: 3 éven belül 2× 40–79 km és 2× 80–100 km, legfeljebb 16 km/h), a hivatalos minősülést a FEI nyilvántartása adja (135. §).</p>`;
        if (!all.jo.length && !all.nemSzamit.length) return `<p class="profil-ures">Még nincs 40–100 km-es eredményes teljesítés.</p>` + megj;
        const pipak = (db) => '✅'.repeat(Math.min(db, 2)) + '⬜'.repeat(Math.max(0, 2 - db));
        const sor = t => `<div>${escapeHtml(t.datum)} · ${escapeHtml(t.verseny || '')} · ${String(t.km).replace('.', ',')} km${t.partner ? ' · ' + escapeHtml(t.partner) : ''} · ${t.maxSeb ? kmh(t.maxSeb) + ' km/h' + (t.korAlapjan ? ' (leggyorsabb kör)' : ' (átlag)') : 'nincs idő'}</div>`;
        let fej;
        if (all.teljesitve) {
            // 135. § (3): a CEI 1*-hez a lónál legalább 1 év, a lovasnál 6 hónap kell az első újonc-versenytől
            const cei = datumPlusz(all.teljesitve.elso, tipus === 'lovas' ? 183 : 365);
            const indulhat = cei > all.teljesitve.datum ? cei : all.teljesitve.datum;
            fej = `<div class="profil-piheno szabad">✅ <b>FEI újonc minősülés teljesítve</b> (${escapeHtml(all.teljesitve.datum)}) – CEI 1*-on indulhat: <b>${escapeHtml(indulhat)}</b>-tól.</div>`;
        } else {
            const hiany = [];
            if (all.a < 2) hiany.push(`${2 - all.a} db 40–79 km`);
            if (all.b < 2) hiany.push(`${2 - all.b} db 80–100 km`);
            fej = `<div class="profil-piheno pihen">🎯 <b>FEI újonc minősülés:</b> 40–79 km: ${pipak(all.a)} · 80–100 km: ${pipak(all.b)}
                <div class="profil-piheno-ok">Még kell: ${hiany.join(' és ')} eredményes teljesítés, legfeljebb 16 km/h-val${all.hatarido ? `, legkésőbb ${escapeHtml(all.hatarido)}-ig (3 év)` : ''}.</div></div>`;
        }
        return `${fej}
            ${all.jo.length ? `<div class="profil-ujonc-lista"><b>Beszámít:</b>${all.jo.map(sor).join('')}</div>` : ''}
            ${all.nemSzamit.length ? `<div class="profil-ujonc-lista"><b>Nem számít (16 km/h felett vagy nincs idő):</b>${all.nemSzamit.map(sor).join('')}</div>` : ''}
            ${megj}`;
    }

    // ============================================================================
    // ÉV TENYÉSZTŐJE (178. §) - csak admin. A tenyésztő az általa tenyésztett lovak (horses/{startNum}.breeder)
    // minden eredményesen teljesített, legalább 40 km-es versenyéért pontot kap, bárhol és bármilyen
    // kategóriában, az előző bajnokavatótól a tárgyévi bajnokavatóig. A pont ugyanúgy számol, mint a
    // csapatbajnokság (177. § (3), azonos szabályszöveg): a megtett táv sávjában a helyezéshez tartozó pont.
    // ============================================================================
    function computeEvTenyesztoje(year) {
        const win = getChampionshipWindow(year);
        const tenyesztok = {};
        const hozzaad = (startNum, lo, eredmeny) => {
            const h = horsesCache[sanitizeKey(startNum || '')] || {};
            const nev = String(h.breeder || '').trim();
            if (!nev) return;
            const t = tenyesztok[nev] || (tenyesztok[nev] = { nev, pont: 0, km: 0, db: 0, lovak: {} });
            const l = t.lovak[startNum] || (t.lovak[startNum] = { startNum, nev: h.name || lo || startNum, pont: 0, eredmenyek: [] });
            t.pont += eredmeny.pont; t.km += eredmeny.km; t.db += 1;
            l.pont += eredmeny.pont; l.eredmenyek.push(eredmeny);
        };
        getAllPastRaceRows().forEach(r => {
            if (!r.startNum || !isDateInWindow(r.raceDate, win) || r.place == null || !(r.completedKm >= 40)) return;
            hozzaad(r.startNum, r.horseName, { datum: r.raceDate, verseny: r.raceName, km: r.completedKm, hely: r.place, pont: getPoints(getPointBand(r.completedKm), r.place) });
        });
        Object.values(externalResultsCache).forEach(ex => {
            const km = parseFloat(ex && ex.distanceKm) || 0;
            const hely = parseInt(ex && ex.place, 10);
            if (!ex || !ex.horseStartNum || ex.status || !(hely > 0) || km < 40 || !isDateInWindow(ex.date, win)) return;
            hozzaad(ex.horseStartNum, ex.horseName, { datum: ex.date, verseny: (ex.event || 'Nemzetközi verseny') + (ex.venue ? ' – ' + ex.venue : ''), km, hely, pont: getPoints(getPointBand(km), hely) });
        });
        return Object.values(tenyesztok).map(t => Object.assign(t, {
            km: Math.round(t.km * 100) / 100,
            lovak: Object.values(t.lovak).sort((a, b) => b.pont - a.pont)
        })).sort((a, b) => (b.pont - a.pont) || (b.km - a.km) || a.nev.localeCompare(b.nev, 'hu'));
    }

    let tenyesztoYear = new Date().getFullYear();
    function renderEvTenyesztoje() {
        const cont = document.getElementById('tenyeszto-tartalom');
        if (!cont) return;
        const sel = document.getElementById('tenyeszto-year-select');
        if (sel && sel.options.length === 0) populateYearSelect('tenyeszto-year-select', tenyesztoYear);
        if (sel) tenyesztoYear = parseInt(sel.value, 10) || tenyesztoYear;
        const win = getChampionshipWindow(tenyesztoYear);
        const lista = computeEvTenyesztoje(tenyesztoYear);
        let html = `<p class="field-hint" style="margin-top:0;">Időszak: <b>${escapeHtml(win.start)} – ${escapeHtml(win.end)}</b> (bajnokavatótól bajnokavatóig).
            A tenyésztett lovak minden eredményesen teljesített, legalább 40 km-es versenye számít, bárhol és bármilyen kategóriában (hazai és FEI).
            Pont: a megtett táv sávjában a helyezéshez tartozó pont (III. melléklet) - ugyanúgy, mint a csapatbajnokságban. A tenyésztő a szövetségi lótörzsből jön.</p>`;
        if (!lista.length) { cont.innerHTML = html + '<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még pontszerző eredmény erre az időszakra.</p>'; return; }
        html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Tenyésztő</th><th class="col-header">Pont</th><th class="col-header">Teljesítés</th><th class="col-header">Km</th><th class="col-header" style="text-align:left;">Lovak</th></tr>`;
        let elozo = null, hely = 0;
        lista.forEach((t, i) => {
            if (!elozo || elozo.pont !== t.pont || elozo.km !== t.km) hely = i + 1;
            elozo = t;
            const lovak = t.lovak.map(l => `<div>${horseLink(escapeHtml(l.nev), l.startNum)} – <b>${l.pont}</b> p
                <span style="color:var(--text-dim-2);">(${l.eredmenyek.map(e => `${escapeHtml(e.datum)} ${escapeHtml(e.verseny)}, ${String(e.km).replace('.', ',')} km, ${e.hely}. hely: ${e.pont} p`).join('; ')})</span></div>`).join('');
            html += `<tr><td>${hely}.</td><td style="text-align:left; font-weight:700; white-space:normal; min-width:160px;">${escapeHtml(t.nev)}</td><td><b style="color:var(--primary);">${t.pont}</b></td><td>${t.db}</td><td>${String(t.km).replace('.', ',')}</td>
                <td style="text-align:left;"><details class="minosites-tetelek"><summary>${t.lovak.length} ló</summary>${lovak}</details></td></tr>`;
        });
        cont.innerHTML = html + '</table></div>';
    }

    // ============================================================================
    // RFID KAPUK (csak admin): a kapuk (az rfid_kapu.py vagy a kézi rögzítés) által a competitors-be
    // írt idők élőben. A Python a competitors/{bib}/laps/{kör}/h,m,s (beérkezés) és oh,om,os (orvosi
    // kapu) mezőket tölti - külön RFID-ág nincs, ezért az áthaladásokat a competitors változásából
    // (diff) állítjuk elő. Oldalnyitáskor a meglévő idők NEM lesznek eseménnyé, csak az új rögzítések.
    // ============================================================================
    let rfidElozo = null;          // bib -> { 'h0': '09:10:00', 'oh0': ..., 'rc0': ... }
    let rfidElozoVerseny = null;
    let rfidEsemenyek = [];        // legfrissebb elöl, max. 40
    let rfidTavSzuro = 'all';
    let rfidOraId = null;

    function rfidAllapotKep(comps) {
        const kep = {};
        comps.forEach(c => {
            const k = {};
            (c.laps || []).forEach((l, i) => {
                if (!l) return;
                if (String(l.h || '') !== '') k['h' + i] = `${l.h}:${l.m || '00'}:${l.s || '00'}`;
                if (String(l.oh || '') !== '') k['oh' + i] = `${l.oh}:${l.om || '00'}:${l.os || '00'}`;
                if (String(l.rch || '') !== '') k['rc' + i] = `${l.rch}:${l.rcm || '00'}:${l.rcs || '00'}`;
            });
            k._nev = String(c.name || '');
            kep[String(c.bib)] = k;
        });
        return kep;
    }

    // A competitors figyelő hívja minden változáskor
    function rfidKapuFrissites() {
        const versenyAzon = liveRaceMeta ? liveRaceMeta.id : null;
        const kep = rfidAllapotKep(competitors);
        // Versenyváltáskor (élesítés / lezárás) nem csinálunk eseményt a teljes új mezőnyből.
        const versenyValtas = rfidElozoVerseny && versenyAzon && rfidElozoVerseny !== versenyAzon;
        if (rfidElozo && !versenyValtas) {
            Object.entries(kep).forEach(([bib, k]) => {
                const regi = rfidElozo[bib];
                // Új nevezés vagy versenyváltás (ugyanaz a rajtszám, más név): a meglévő idők nem áthaladások
                if (!regi || regi._nev !== k._nev) return;
                Object.entries(k).forEach(([mezo, ido]) => {
                    if (mezo === '_nev' || regi[mezo] === ido) return;
                    const c = competitors.find(x => String(x.bib) === bib) || {};
                    const kapu = mezo.startsWith('oh') ? 'orvosi' : mezo.startsWith('rc') ? 'recheck' : 'beerkezes';
                    rfidEsemenyek.unshift({ bib, nev: c.name || '', lo: c.internal || '', dist: c.dist, kapu, ido,
                        kor: parseInt(mezo.replace(/\D/g, ''), 10) + 1, javitas: !!regi[mezo], erkezett: Date.now() });
                });
            });
            rfidEsemenyek = rfidEsemenyek.slice(0, 40);
        } else if (versenyValtas) {
            rfidEsemenyek = [];
        }
        rfidElozo = kep;
        if (versenyAzon) rfidElozoVerseny = versenyAzon;
        if (document.getElementById('rfid-mod')?.classList.contains('active')) renderRfidKapuk();
    }

    function setRfidTav(v) { rfidTavSzuro = v; renderRfidKapuk(); }

    function rfidMiota(ms) {
        const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
        if (s < 60) return `${s} mp-e`;
        if (s < 3600) return `${Math.floor(s / 60)} perce`;
        return `${Math.floor(s / 3600)} órája`;
    }

    const RFID_KAPU_NEV = { beerkezes: 'Beérkezés', orvosi: 'Orvosi kapu', recheck: 'Re-check' };

    // Egy versenyző állapota a kapuknál: utolsó beérkezés / orvosi idő, és ha a beérkezés után
    // túl sokáig nincs orvosi idő, azt jelezzük (a kapu nem olvasta, vagy késik a bemutatás - 97. §).
    function rfidVersenyzoSor(c) {
        const base = String(c.dist || '').replace('j', '');
        const cfg = raceConfig[base] || { laps: [] };
        const korSzam = Math.max((cfg.laps || []).length, 1);
        const laps = c.laps || [];
        let utolsoBe = null, utolsoOrv = null, utolsoIdx = -1;
        laps.forEach((l, i) => {
            if (!l) return;
            if (l.arrSec > 0) { utolsoBe = { sec: l.arrSec, kor: i + 1 }; utolsoIdx = i; }
            if (l.vetSec > 0) utolsoOrv = { sec: l.vetSec, kor: i + 1 };
        });
        const most = new Date(); const mostSec = most.getHours() * 3600 + most.getMinutes() * 60 + most.getSeconds();
        let figy = '', szint = '';
        if (!c.isEliminated && utolsoBe && (!utolsoOrv || utolsoOrv.kor < utolsoBe.kor)) {
            const eltelt = resolveRollover(mostSec - utolsoBe.sec).diff;
            const vegso = utolsoIdx === korSzam - 1;
            const hatar = vegso ? ((c.dist === '20' || c.dist === '20j') ? 1800 : 1200) : 900;
            if (eltelt > hatar) { figy = `⛔ ${Math.floor(eltelt / 60)} perce érkezett, nincs orvosi idő`; szint = 'piros'; }
            else if (eltelt > 600) { figy = `⚠️ ${Math.floor(eltelt / 60)} perce érkezett, még nincs orvosi idő`; szint = 'sarga'; }
        }
        const korok = Array.from({ length: korSzam }, (_, i) => {
            const l = laps[i] || {};
            const be = l.arrSec > 0, orv = l.vetSec > 0;
            const cls = orv ? 'kesz' : be ? 'felig' : '';
            return `<span class="rfid-kor ${cls}" title="${i + 1}. kör – beérkezés: ${be ? toTimeStr(l.arrSec) : '–'}, orvosi: ${orv ? toTimeStr(l.vetSec) : '–'}">${i + 1}.<small>${be ? toTimeStr(l.arrSec) : '–'}${orv ? ' / ' + toTimeStr(l.vetSec) : ''}</small></span>`;
        }).join('');
        return { utolsoBe, utolsoOrv, figy, szint, korok, utolsoSec: Math.max(utolsoBe ? utolsoBe.sec : 0, utolsoOrv ? utolsoOrv.sec : 0) };
    }

    function renderRfidKapuk() {
        const cont = document.getElementById('rfid-tartalom');
        if (!cont) return;
        if (!liveRaceMeta) {
            cont.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Jelenleg nincs élő verseny.</p>';
            return;
        }
        const tavSel = document.getElementById('rfid-tav');
        if (tavSel) {
            const tavok = getActiveCategories(competitors, raceConfig);
            const opciok = '<option value="all">Minden táv</option>' + tavok.map(d => `<option value="${d}">${catNames[d] || d + ' km'}</option>`).join('');
            if (tavSel.dataset.opciok !== opciok) { tavSel.innerHTML = opciok; tavSel.dataset.opciok = opciok; }
            tavSel.value = tavok.includes(rfidTavSzuro) ? rfidTavSzuro : 'all';
        }
        const szurt = competitors.filter(c => rfidTavSzuro === 'all' || c.dist === rfidTavSzuro);
        const sorok = szurt.map(c => Object.assign({ c, st: getCompLiveStatus(c, raceConfig) }, rfidVersenyzoSor(c)));
        // Legelöl a figyelmeztetések, utána a legutóbb a kapun áthaladók
        sorok.sort((a, b) => ((b.szint === 'piros') - (a.szint === 'piros')) || ((b.szint === 'sarga') - (a.szint === 'sarga')) || (b.utolsoSec - a.utolsoSec) || String(a.c.bib).localeCompare(String(b.c.bib), 'hu', { numeric: true }));

        const beDb = competitors.reduce((s, c) => s + (c.laps || []).filter(l => l && l.arrSec > 0).length, 0);
        const orvDb = competitors.reduce((s, c) => s + (c.laps || []).filter(l => l && l.vetSec > 0).length, 0);
        const figyDb = sorok.filter(s => s.figy).length;
        const utolso = rfidEsemenyek[0];

        let html = `<div class="rfid-osszesito">
            <div><b>${beDb}</b><span>beérkezés rögzítve</span></div>
            <div><b>${orvDb}</b><span>orvosi kapu rögzítve</span></div>
            <div class="${figyDb ? 'van-figy' : ''}"><b>${figyDb}</b><span>figyelmeztetés</span></div>
            <div><b data-rfid-miota="${utolso ? utolso.erkezett : ''}">${utolso ? rfidMiota(utolso.erkezett) : '–'}</b><span>utolsó kapu-esemény${utolso ? ` (#${escapeHtml(utolso.bib)})` : ''}</span></div>
        </div>`;

        html += `<h4 class="attekinto-cim">Élő kapu-feed <small>(az oldal megnyitása óta, legfrissebb felül)</small></h4>`;
        html += rfidEsemenyek.length ? `<div class="rfid-feed">${rfidEsemenyek.slice(0, 25).map(e => `
            <div class="rfid-esemeny kapu-${e.kapu} ${Date.now() - e.erkezett < 8000 ? 'uj' : ''}">
                <span class="rfid-bib">#${escapeHtml(e.bib)}</span>
                <span class="rfid-nev"><b>${escapeHtml(e.nev)}</b> <small>${escapeHtml(e.lo)}</small></span>
                <span class="rfid-kapu">${RFID_KAPU_NEV[e.kapu]}${e.javitas ? ' (javítva)' : ''} · ${e.kor}. kör</span>
                <span class="rfid-ido">${escapeHtml(e.ido)}</span>
                <span class="rfid-miota" data-rfid-miota="${e.erkezett}">${rfidMiota(e.erkezett)}</span>
            </div>`).join('')}</div>`
            : '<p class="field-hint">Még nem volt új áthaladás, mióta ez az oldal nyitva van. Amint a kapu (vagy valaki kézzel) rögzít egy időt, itt azonnal megjelenik.</p>';

        html += `<h4 class="attekinto-cim">Versenyzők a kapuknál <small>(${szurt.length} versenyző)</small></h4>`;
        html += `<div class="rfid-lista">${sorok.map(s => `
            <div class="rfid-sor ${s.szint}">
                <div class="rfid-sor-fej">
                    <span class="rfid-bib">#${escapeHtml(String(s.c.bib))}</span>
                    <span class="rfid-nev"><b>${escapeHtml(s.c.name)}</b> <small>${escapeHtml(s.c.internal || '')} · ${escapeHtml(catNames[s.c.dist] || s.c.dist)}</small></span>
                    <span class="adatlap-live-status" style="background:${s.st.color}; color:${s.st.textCol || '#fff'};">${escapeHtml(s.st.text)}</span>
                </div>
                <div class="rfid-korok">${s.korok}</div>
                ${s.figy ? `<div class="rfid-figy">${s.figy}</div>` : ''}
            </div>`).join('')}</div>`;
        cont.innerHTML = html;
    }

    // A "x mp-e" feliratok és a figyelmeztetések frissítése, amíg a nézet nyitva van
    function rfidOraIndit() {
        if (rfidOraId) return;
        let szamlalo = 0;
        rfidOraId = setInterval(() => {
            if (!document.getElementById('rfid-mod')?.classList.contains('active')) { clearInterval(rfidOraId); rfidOraId = null; return; }
            document.querySelectorAll('[data-rfid-miota]').forEach(el => { const ms = parseInt(el.dataset.rfidMiota, 10); if (ms) el.textContent = rfidMiota(ms); });
            if (++szamlalo % 30 === 0) renderRfidKapuk();   // fél percenként a figyelmeztetések is
        }, 1000);
    }

    // --- RENDER: Ló-ranglista ---
    let loYear = new Date().getFullYear();
    let loHatokor = 'magyar';   // 'magyar' = csak hazai versenyek (a fő lista), 'osszes' = a nemzetköziekkel

    function setLoHatokor(kulcs, btn) {
        loHatokor = kulcs;
        document.querySelectorAll('#lo-hatokor-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
        renderLoRanglista();
    }

    function renderLoRanglista() {
        const yearSel = document.getElementById('lo-year-select');
        if (yearSel && yearSel.options.length === 0) populateYearSelect('lo-year-select', loYear);
        if (yearSel) loYear = parseInt(yearSel.value, 10) || loYear;

        const nemzetkoziIs = loHatokor === 'osszes';
        const horses = computeHorseRanking(loYear, nemzetkoziIs);
        const cont = document.getElementById('lo-ranglista-content');
        if (!cont) return;
        const clubView = document.getElementById('lo-club-toggle')?.checked;

        let html = `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;">
            <h4 style="margin:0; color:var(--text);">${nemzetkoziIs ? 'Összes verseny' : 'Magyar versenyek'}</h4>
            <p class="field-hint" style="margin-bottom:0;">${nemzetkoziIs
                ? 'A hazai és a nemzetközi (FEI) teljesítés együtt. A kiesett (FTQ/RET) nemzetközi rajt km-je nem számít bele – azt a ló nem teljesítette.'
                : 'Csak a hazai versenyeken ténylegesen megtett kilométer. Ez a hivatalos ló-ranglista.'}</p>
        </div>`;

        if (horses.length === 0) {
            html += `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még rögzített teljesítés erre az évre.</p>`;
        } else if (clubView) {
            const clubs = computeClubBreakdownKm(horses);
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Össz. km</th></tr>`;
            clubs.forEach((c, i) => { html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${c.club}</td><td><b>${c.km}</b></td></tr>`; });
            html += `</table></div>`;
        } else {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Ló</th><th class="col-header">Össz. km</th><th class="col-header">Rajtok</th><th class="col-header" style="text-align:left;">Utoljára</th></tr>`;
            horses.forEach((h, i) => {
                html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${horseLink(h.horseName, h.startNum)} <span style="color:var(--text-dim-2); font-size:0.78rem;">#${h.startNum}</span></td><td><b style="color:var(--primary);">${h.totalKm}</b></td><td>${h.raceCount}</td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${riderLink(h.lastRider, h.lastRiderLicense)}</td></tr>`;
            });
            html += `</table></div>`;
        }
        cont.innerHTML = html;
    }

    // --- CSAPATBAJNOKSÁG: fül-váltás ---
    function switchCsapatTab(tabId, btn) {
        document.querySelectorAll('#bajnoksag-csapat .sub-mode-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#bajnoksag-csapat .tabs .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).style.display = 'block';
        if (btn) btn.classList.add('active');
        if (tabId === 'csapat-rang') renderCsapatRanglista();
        if (tabId === 'csapat-kezel') renderTeamList();
        if (tabId === 'csapat-kulf') renderExternalResultsList();
        if (tabId === 'csapat-datum') renderBajnokavatasDatumSettings();
    }

    // --- BEÁLLÍTÁSOK FÜL: versenyző pontkereső (admin) ---
    function switchBeallitasokTab(tabId, btn) {
        document.querySelectorAll('#beallitasok-mod .sub-mode-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#beallitasok-mod .tabs .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).style.display = 'block';
        if (btn) btn.classList.add('active');
        if (tabId === 'beallitasok-pontkereso') renderAdminPontkereso();
        if (tabId === 'beallitasok-kulfoldi') renderKulfoldiKezelo();
        if (tabId === 'beallitasok-vetek') renderVetTorzs();
    }

    // ============================================================================
    // BEÁLLÍTÁSOK: nemzetközi (FEI) eredmények versenyenként csoportosítva + teljes szerkesztő
    // Ugyanaz az externalResults node, amit a csapatbajnokság és a ló-ranglista is olvas - itt
    // viszont nem lovasonként, hanem versenyenként látszik, és minden mező szerkeszthető.
    // ============================================================================
    let kulfoldiSzerkesztettId = null;

    // Egy "verseny" = azonos nap + azonos versenyszám + azonos helyszín.
    function kulfoldiVersenyKulcs(ex) {
        return [ex.date || '', ex.event || ex.raceName || '', ex.venue || ''].join('|');
    }

    function kulfoldiSzerkesztes(id) { kulfoldiSzerkesztettId = id; renderKulfoldiKezelo(); }
    function kulfoldiMegse() { kulfoldiSzerkesztettId = null; renderKulfoldiKezelo(); }

    function kulfoldiMentes(id) {
        const ertek = mezo => (document.getElementById('kf-' + mezo)?.value || '').trim();
        const regi = externalResultsCache[id] || {};
        const km = parseFloat(ertek('distanceKm'));
        const hely = parseInt(ertek('place'), 10);
        const statusz = ertek('status');

        if (!ertek('license')) { showToast('Az igazolási szám kötelező.', true); return; }
        if (!ertek('date') || !ertek('event') || !km) { showToast('A dátum, a versenyszám és a táv kötelező.', true); return; }
        if (statusz && !isNaN(hely)) { showToast('Kiesési státusz mellett nem lehet helyezés – töröld az egyiket.', true); return; }

        const riderInfo = ridersCache[sanitizeKey(ertek('license'))] || {};
        const adat = {
            license: ertek('license'),
            riderName: riderInfo.name || ertek('riderName') || '',
            date: ertek('date'),
            event: ertek('event'),
            venue: ertek('venue'),
            country: ertek('country'),
            distanceKm: km,
            place: isNaN(hely) ? null : hely,
            status: statusz,
            score: ertek('score'),
            horseStartNum: ertek('horseStartNum'),
            horseName: ertek('horseName'),
            horseFeiId: ertek('horseFeiId'),
            source: regi.source || 'kezi',
            addedAt: regi.addedAt || Date.now(),
            enteredBy: (auth.currentUser && auth.currentUser.uid) || 'ismeretlen',
            enteredAt: Date.now()
        };

        db.ref('externalResults/' + id).set(adat).then(() => {
            showToast('Nemzetközi eredmény mentve.');
            kulfoldiSzerkesztettId = null;
            renderKulfoldiKezelo();
        }).catch(e => showToast('Hiba: ' + e.message, true));
    }

    function kulfoldiTorles(id) {
        const ex = externalResultsCache[id] || {};
        showConfirm('Eredmény törlése',
            `Biztosan törlöd? ${ex.riderName || ex.license} – ${ex.event || ''} (${ex.date || ''}). A csapatbajnoki pontja és a ló km-e is eltűnik vele.`,
            () => db.ref('externalResults/' + id).remove()
                .then(() => { kulfoldiSzerkesztettId = null; showToast('Törölve.'); })
                .catch(e => showToast('Hiba: ' + e.message, true)));
    }

    // Az escapeHtml() üres értékre "-"-t ad vissza (a táblázatokban ez a helyes), egy input
    // value-jába viszont üres string kell, különben minden üres mezőben egy kötőjel jelenne meg.
    function kulfoldiErtek(v) {
        return (v === null || v === undefined || v === '') ? '' : escapeHtml(String(v));
    }

    function kulfoldiMezo(cimke, mezo, ertek, tipus) {
        return `<label style="margin-top:10px;">${cimke}</label>
                <input type="${tipus || 'text'}" id="kf-${mezo}" value="${kulfoldiErtek(ertek)}" autocomplete="off" style="margin-top:4px;">`;
    }

    function kulfoldiSzerkesztoUrlap(id, ex) {
        const statuszok = ['', 'FTQ', 'RET', 'DSQ', 'DNS', 'WD'];
        return `<div style="background:var(--card-3); border:1px solid var(--border); border-radius:var(--radius-sm); padding:14px; margin-top:10px;">
            <p class="field-hint" style="margin-top:0;">Rekord azonosító: <code>${escapeHtml(id)}</code>${ex.source ? ` · forrás: <b>${escapeHtml(ex.source)}</b>` : ''}</p>
            ${kulfoldiMezo('Lovas igazolási száma', 'license', ex.license)}
            ${kulfoldiMezo('Lovas neve (a törzsadatból frissül)', 'riderName', ex.riderName)}
            ${kulfoldiMezo('Dátum', 'date', ex.date, 'date')}
            ${kulfoldiMezo('Verseny / versenyszám', 'event', ex.event || ex.raceName)}
            ${kulfoldiMezo('Helyszín', 'venue', ex.venue)}
            ${kulfoldiMezo('Ország', 'country', ex.country)}
            ${kulfoldiMezo('Táv (km)', 'distanceKm', ex.distanceKm, 'number')}
            ${kulfoldiMezo('Helyezés (kiesésnél üres)', 'place', ex.place, 'number')}
            <label style="margin-top:10px;">Kiesési státusz</label>
            <select id="kf-status" style="margin-top:4px;">
                ${statuszok.map(s => `<option value="${s}" ${(ex.status || '') === s ? 'selected' : ''}>${s || '– befejezte –'}</option>`).join('')}
            </select>
            ${kulfoldiMezo('Eredmény (menetidő vagy átlagsebesség)', 'score', ex.score)}
            ${kulfoldiMezo('Ló start száma (a ló-ranglistához)', 'horseStartNum', ex.horseStartNum)}
            ${kulfoldiMezo('Ló neve', 'horseName', ex.horseName)}
            ${kulfoldiMezo('Ló FEI száma', 'horseFeiId', ex.horseFeiId)}
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">
                <button class="calc-btn add-btn" style="margin-top:0;" onclick="kulfoldiMentes('${escapeHtml(id)}')">Mentés</button>
                <button class="cancel-btn" style="display:block; margin-top:0;" onclick="kulfoldiMegse()">Mégse</button>
                <button class="edit-btn" style="background:var(--danger);" onclick="kulfoldiTorles('${escapeHtml(id)}')">Törlés</button>
            </div>
        </div>`;
    }

    function renderKulfoldiKezelo() {
        const cont = document.getElementById('kulfoldi-kezelo-lista');
        if (!cont) return;
        const kereses = (document.getElementById('kulfoldi-kereso')?.value || '').trim().toLowerCase();

        const talalatok = Object.entries(externalResultsCache).filter(([, ex]) => {
            if (!kereses) return true;
            const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
            return [ex.event, ex.raceName, ex.venue, ex.country, ex.horseName, ex.license, ex.riderName, riderInfo.name, ex.date]
                .filter(Boolean).join(' ').toLowerCase().includes(kereses);
        });

        if (!talalatok.length) {
            cont.innerHTML = `<p style="color:var(--text-dim); text-align:center; padding:20px 0;">${kereses ? 'Nincs találat erre a szűrésre.' : 'Nincs még rögzített nemzetközi eredmény.'}</p>`;
            return;
        }

        const versenyek = new Map();
        talalatok.forEach(([id, ex]) => {
            const k = kulfoldiVersenyKulcs(ex);
            if (!versenyek.has(k)) versenyek.set(k, []);
            versenyek.get(k).push([id, ex]);
        });

        const rendezett = Array.from(versenyek.values())
            .sort((a, b) => String(b[0][1].date || '').localeCompare(String(a[0][1].date || '')));

        cont.innerHTML = rendezett.map(csoport => {
            const elso = csoport[0][1];
            const fej = [elso.event || elso.raceName || '(névtelen verseny)', elso.venue, elso.country].filter(Boolean).join(' · ');
            const sorok = csoport.map(([id, ex]) => {
                const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
                const nev = riderInfo.name || ex.riderName || ex.license;
                const eredmeny = ex.status
                    ? `<span style="color:var(--danger); font-weight:700;">${escapeHtml(ex.status)}</span>`
                    : (ex.place ? `<b style="color:var(--primary);">${ex.place}. hely</b>` : '<span style="color:var(--text-dim);">nincs helyezés</span>');
                const lo = ex.horseName ? escapeHtml(ex.horseName) : '–';
                const loJel = ex.horseStartNum ? ` <span style="color:var(--text-dim-2); font-size:0.75rem;">#${escapeHtml(ex.horseStartNum)}</span>`
                                               : ` <span style="color:var(--text-dim-2); font-size:0.75rem;" title="Nincs magyar start szám, ezért a ló-ranglistába nem számít">(nincs start szám)</span>`;
                return `<div style="border-top:1px solid var(--border-soft); padding:10px 0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:160px;">
                            <b>${escapeHtml(nev)}</b> <span style="color:var(--text-dim-2); font-size:0.78rem;">${kulfoldiErtek(ex.license)}</span><br>
                            <span style="color:var(--text-dim); font-size:0.85rem;">${lo}${loJel} · ${escapeHtml(String(ex.distanceKm || '?'))} km · ${eredmeny}${ex.score ? ' · ' + escapeHtml(ex.score) : ''}</span>
                        </div>
                        <button class="edit-btn admin-only" onclick="kulfoldiSzerkesztes('${escapeHtml(id)}')">Módosítás</button>
                    </div>
                    ${kulfoldiSzerkesztettId === id ? kulfoldiSzerkesztoUrlap(id, ex) : ''}
                </div>`;
            }).join('');

            const nyitva = csoport.some(([id]) => id === kulfoldiSzerkesztettId);
            return `<details class="kulfoldi-verseny" ${nyitva ? 'open' : ''}>
                <summary>${kulfoldiErtek(elso.date)} · ${escapeHtml(fej)} <span style="color:var(--text-dim-2); font-weight:600;">(${csoport.length} induló)</span></summary>
                ${sorok}
            </details>`;
        }).join('');
    }

    // Versenyenkénti bontás egy adott lovasra: táv, helyezés és az adott eredményre eső nyers
    // bajnoki pont (a getPoints/getPointBand ugyanazon számítása, mint az egyéni bajnokságnál) -
    // ha egy sor 0 pontot ad, a note megmondja miért (nem OB-forduló, lemondott, stb.).
    // Ugyanazt a külföldi-nélküli újraszámozást használja, mint a hivatalos egyéni bajnokság
    // (renumberWithoutForeign) - így ez a diagnosztikai nézet pontosan azt a helyezést és pontot
    // mutatja, ami a hivatalos táblázatban is szerepelni fog, nem a nyers versenyeredményt.
    // A pont a ténylegesen beszámított érték (getObPontInfo) - a max. 2 ló és a 174. § (3) is benne van.
    function getRiderPointsBreakdown(license) {
        const renumbered = renumberWithoutForeign(getAllPastRaceRows());
        const cache = {};
        return getRiderHistory(license).map(r => {
            const info = getObPontInfo(r, renumbered, cache);
            return Object.assign({}, r, { points: info.points, note: info.note, place: info.place, versenyHely: r.place });
        });
    }

    function renderAdminPontkereso() {
        const cont = document.getElementById('admin-pontkereso-list');
        if (!cont) return;
        const q = (document.getElementById('admin-pontkereso-search')?.value || '').trim().toLowerCase();
        const riders = Object.values(ridersCache).filter(r => r && r.name)
            .filter(r => !q || r.name.toLowerCase().includes(q) || (r.license || '').toLowerCase().includes(q) || (r.club || '').toLowerCase().includes(q))
            .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

        if (!riders.length) { cont.innerHTML = `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs találat.</p>`; return; }

        cont.innerHTML = riders.map(r => `
            <div class="competitor-item" style="cursor:pointer;" onclick="openRiderPointsBreakdown('${r.license}')">
                <div style="flex:1;"><b>${r.name}</b><br><span style="color:var(--text-dim); font-size:0.85rem;">${r.club || 'Nincs egyesület megadva'} · Ig. szám: ${r.license}</span></div>
                <div class="adatlap-arrow">❯</div>
            </div>
        `).join('');
    }

    function openRiderPointsBreakdown(license) {
        const rider = ridersCache[sanitizeKey(license)] || {};
        const breakdown = getRiderPointsBreakdown(license);
        const totalPoints = breakdown.reduce((s, r) => s + r.points, 0);

        let html = `
            <div style="text-align:center; margin-bottom:15px;">
                <h3 style="color:var(--primary); margin:0;">${rider.name || license}</h3>
                <p style="color:var(--text-dim); margin-top:4px;">${rider.club ? rider.club + ' · ' : ''}Ig. szám: ${license}</p>
                <button class="admin-only" style="width:auto; padding:6px 16px; border-radius:20px; border:none; cursor:pointer; font-weight:700; font-size:0.8rem; margin-top:6px; background:${isForeignLicense(license) ? 'var(--warning)' : 'var(--card-3)'}; color:${isForeignLicense(license) ? 'black' : 'var(--text)'};" onclick="toggleForeign('${escapeHtml(license)}')">${isForeignLicense(license) ? '🌍 Külföldi – kimarad a magyar bajnokságból' : '🇭🇺 Magyar versenyző'} (kattints a váltáshoz)</button>
            </div>
        `;

        if (!breakdown.length) {
            html += `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs rögzített versenyeredmény.</p>`;
        } else {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr>
                <th class="col-header" style="text-align:left;">Verseny</th>
                <th class="col-header">Táv</th>
                <th class="col-header">Helyezés</th>
                <th class="col-header">Pont</th>
            </tr>`;
            breakdown.forEach(r => {
                // Ha a külföldiek kihagyása miatt az OB-helyezés eltér a versenyen elérttől, mindkettő látszik.
                const placeStr = (!r.isEliminated && r.place != null)
                    ? `${r.place}. hely${r.versenyHely != null && r.versenyHely !== r.place ? ` <span style="color:var(--text-dim-2); font-size:0.75rem;">(versenyen: ${r.versenyHely}.)</span>` : ''}`
                    : getElimText({ isEliminated: true, status: r.status, extraCodes: r.extraCodes });
                const pointsStr = r.points > 0 ? `<b style="color:var(--primary);">${r.points}</b>` : `<span style="color:var(--text-dim-2); font-size:0.78rem;">0${r.note ? ' · ' + r.note : ''}</span>`;
                html += `<tr>
                    <td style="text-align:left;"><b style="color:var(--primary); cursor:pointer; text-decoration:underline;" onclick="goToRaceResults('${r.raceId}', '${r.dist}')">${r.raceName || '-'}</b><br><span style="color:var(--text-dim); font-size:0.78rem;">${r.raceDate || '-'}</span></td>
                    <td>${catNames[r.dist] || r.dist}</td>
                    <td>${placeStr}</td>
                    <td>${pointsStr}</td>
                </tr>`;
            });
            html += `</table></div>
            <div class="summary-total" style="text-align:center;">A fenti sorokban a bajnokságba beszámított pontok összege (minden év, minden osztály): <b style="color:var(--primary); font-size:1.2rem;">${totalPoints}</b></div>`;
        }

        document.getElementById('modalBody').innerHTML = html;
        document.getElementById('adatlapModal').style.display = 'flex';
    }

    // --- CSAPATBAJNOKSÁG: ranglista ---
    let csapatYear = new Date().getFullYear();

    function renderCsapatRanglista() {
        const yearSel = document.getElementById('csapat-year-select');
        if (yearSel && yearSel.options.length === 0) populateYearSelect('csapat-year-select', csapatYear);
        if (yearSel) csapatYear = parseInt(yearSel.value, 10) || csapatYear;

        const teams = computeTeamChampionship(csapatYear);
        const cont = document.getElementById('csapat-ranglista-content');
        if (!cont) return;

        if (Object.keys(teamsCache).length === 0) {
            cont.innerHTML = `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Még nincs felvitt csapat. Admin a "Csapatok kezelése" fülön hozhat létre.</p>`;
            return;
        }

        // A km-nézet CSAK a megjelenített számot cseréli - a sorrend mindig a pont szerint marad,
        // a teams tömb már pont szerint van rendezve a computeTeamChampionship()-ben.
        const kmView = document.getElementById('csapat-km-toggle')?.checked;
        const unit = kmView ? 'km' : 'p';

        let html = `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Csapat</th><th class="col-header">Össz. ${kmView ? 'km' : 'pont'}</th><th class="col-header" style="text-align:left;">Tagok</th></tr>`;
        teams.forEach((t, i) => {
            const memberStr = t.members.map(m => `${riderLink(m.name, m.license)} (${kmView ? m.km : m.points} ${unit})${m.isObQualified ? '' : ' ⚠️'}`).join(', ');
            html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${t.name}</td><td><b style="color:var(--primary);">${kmView ? t.totalKm : t.totalPoints}</b></td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${memberStr}</td></tr>`;
        });
        html += `</table></div><p class="field-hint">A sorrend mindig a bajnoki pont alapján dől el, a km-nézet csak a megjelenített számot cseréli. ⚠️ = a tag ebben az időszakban még nem indult hazai OB-fordulón legalább 40 km-en, ezért egyelőre nem jogosult a csapatpontra (visszamenőleg pótolható).</p>`;
        cont.innerHTML = html;
    }

    // --- CSAPATBAJNOKSÁG: csapatok kezelése (admin CRUD) ---
    let teamMemberDraft = [];
    let editingTeamId = null;

    function addTeamMember(item) {
        if (teamMemberDraft.length >= 5) { showToast('Egy csapatnak legfeljebb 5 tagja lehet!', true); return; }
        if (teamMemberDraft.some(m => m.license === item.license)) return;
        teamMemberDraft.push({ license: item.license, name: item.name });
        renderTeamMemberDraft();
    }

    function removeTeamMember(license) {
        teamMemberDraft = teamMemberDraft.filter(m => m.license !== license);
        renderTeamMemberDraft();
    }

    function renderTeamMemberDraft() {
        const cont = document.getElementById('team-member-list');
        if (!cont) return;
        cont.innerHTML = teamMemberDraft.map(m => `
            <span class="extra-code-chip checked" style="cursor:default;">${m.name} <span style="cursor:pointer; margin-left:4px; font-weight:900;" onclick="removeTeamMember('${m.license}')">✕</span></span>
        `).join('') || `<span style="color:var(--text-dim-2); font-size:0.85rem;">Még nincs tag hozzáadva.</span>`;
    }

    function saveTeam() {
        const name = document.getElementById('team-name').value.trim();
        const contact = document.getElementById('team-contact').value.trim();
        if (!name) { showToast('A csapat nevének megadása kötelező!', true); return; }
        if (teamMemberDraft.length < 2 || teamMemberDraft.length > 5) { showToast('Egy csapatnak 2-5 tagja lehet!', true); return; }

        const conflict = Object.entries(teamsCache).find(([tid, t]) =>
            tid !== editingTeamId && (t.memberLicenses || []).some(lic => teamMemberDraft.some(m => m.license === lic))
        );
        if (conflict) { showToast(`Egy vagy több lovas már tagja a(z) "${conflict[1].name}" csapatnak!`, true); return; }

        const id = editingTeamId || generateSlug(name, Date.now().toString());
        const teamData = { name, contact, memberLicenses: teamMemberDraft.map(m => m.license) };
        db.ref('teams/' + id).set(teamData).then(() => {
            showToast('Csapat sikeresen mentve!');
            cancelTeamEdit();
        }).catch(e => showToast('Hiba: ' + e.message, true));
    }

    function editTeam(teamId) {
        const t = teamsCache[teamId];
        if (!t) return;
        editingTeamId = teamId;
        document.getElementById('team-name').value = t.name || '';
        document.getElementById('team-contact').value = t.contact || '';
        teamMemberDraft = (t.memberLicenses || []).map(lic => ({ license: lic, name: (ridersCache[sanitizeKey(lic)] && ridersCache[sanitizeKey(lic)].name) || lic }));
        renderTeamMemberDraft();
        document.getElementById('team-cancel-btn').style.display = 'block';
        window.scrollTo(0, 0);
    }

    function cancelTeamEdit() {
        editingTeamId = null;
        teamMemberDraft = [];
        document.getElementById('team-name').value = '';
        document.getElementById('team-contact').value = '';
        document.getElementById('team-cancel-btn').style.display = 'none';
        renderTeamMemberDraft();
    }

    function deleteTeam(teamId) {
        showConfirm('Csapat törlése', 'Biztosan törlöd ezt a csapatot?', () => {
            db.ref('teams/' + teamId).remove().then(() => showToast('Csapat törölve.'));
        });
    }

    function renderTeamList() {
        const cont = document.getElementById('team-list-container');
        if (!cont) return;
        const entries = Object.entries(teamsCache);
        if (entries.length === 0) { cont.innerHTML = `<p style="color:var(--text-dim); text-align:center;">Nincs még felvitt csapat.</p>`; return; }
        cont.innerHTML = entries.map(([id, t]) => {
            const memberNames = (t.memberLicenses || []).map(lic => (ridersCache[sanitizeKey(lic)] && ridersCache[sanitizeKey(lic)].name) || lic).join(', ');
            return `<div class="competitor-item">
                <div style="flex:1;"><b>${t.name}</b><br><span style="color:var(--text-dim); font-size:0.85rem;">${memberNames}</span></div>
                <div style="display:flex; gap:8px;">
                    <button class="edit-btn admin-only" onclick="editTeam('${id}')">Módosítás</button>
                    <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteTeam('${id}')">Törlés</button>
                </div>
            </div>`;
        }).join('');
    }

    // --- CSAPATBAJNOKSÁG: külföldi eredmények (admin CRUD, l. terv 3.4) ---
    let editingExternalId = null;

    // A kézi felvitel ugyanazt a rekord-alakot állítja elő, mint a FEI import (l. externalResults),
    // hogy a csapatbajnokság, a ló-ranglista és a profil ablak ne tudja megkülönböztetni a kettőt.
    const EXT_MEZOK = ['ext-rider-search', 'ext-license', 'ext-horse-search', 'ext-horseStartNum', 'ext-horseName',
        'ext-horseFeiId', 'ext-event', 'ext-venue', 'ext-country', 'ext-date', 'ext-distanceKm', 'ext-place',
        'ext-status', 'ext-score'];

    function extMezo(id) { return (document.getElementById(id)?.value || '').trim(); }

    function saveExternalResult() {
        const license = extMezo('ext-license');
        const event = extMezo('ext-event');
        const date = extMezo('ext-date');
        const distanceKm = parseFloat(extMezo('ext-distanceKm'));
        const place = parseInt(extMezo('ext-place'), 10);
        const status = extMezo('ext-status');

        if (!license) { showToast('Válassz lovast a listából!', true); return; }
        if (!event || !date || !distanceKm) { showToast('Verseny neve, dátum és táv megadása kötelező!', true); return; }
        if (status && !isNaN(place)) { showToast('Kiesési státusz mellett nem lehet helyezés – töröld az egyiket.', true); return; }

        const regi = (editingExternalId && externalResultsCache[editingExternalId]) || {};
        const riderInfo = ridersCache[sanitizeKey(license)] || {};
        const data = {
            license,
            riderName: riderInfo.name || regi.riderName || '',
            date, event,
            venue: extMezo('ext-venue'),
            country: extMezo('ext-country'),
            distanceKm,
            place: isNaN(place) ? null : place,
            status,
            score: extMezo('ext-score'),
            horseStartNum: extMezo('ext-horseStartNum'),
            horseName: extMezo('ext-horseName'),
            horseFeiId: extMezo('ext-horseFeiId'),
            // Importált rekord szerkesztésekor a forrásjelzés és az eredeti időbélyeg megmarad.
            source: regi.source || 'kezi',
            addedAt: regi.addedAt || Date.now(),
            enteredBy: (auth.currentUser && auth.currentUser.uid) || 'ismeretlen',
            enteredAt: Date.now()
        };

        const id = editingExternalId || (Date.now().toString() + Math.floor(Math.random() * 1000));
        db.ref('externalResults/' + id).set(data).then(() => {
            showToast('Külföldi eredmény mentve!');
            cancelExternalEdit();
        }).catch(e => showToast('Hiba: ' + e.message, true));
    }

    function editExternalResult(id) {
        const ex = externalResultsCache[id];
        if (!ex) return;
        editingExternalId = id;
        const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
        document.getElementById('ext-rider-search').value = riderInfo.name ? `${riderInfo.name} — ${ex.license}` : (ex.riderName || ex.license);
        document.getElementById('ext-license').value = ex.license || '';
        if (ex.horseStartNum) {
            const h = horsesCache[sanitizeKey(ex.horseStartNum)] || {};
            document.getElementById('ext-horse-search').value = h.name ? `${h.name} — ${ex.horseStartNum}` : ex.horseStartNum;
            document.getElementById('ext-horseStartNum').value = ex.horseStartNum;
        }
        // A régi kézi rekordokban raceName volt a verseny neve, az importban event - mindkettőt kezeljük.
        document.getElementById('ext-horseName').value = ex.horseName || '';
        document.getElementById('ext-horseFeiId').value = ex.horseFeiId || '';
        document.getElementById('ext-event').value = ex.event || ex.raceName || '';
        document.getElementById('ext-venue').value = ex.venue || '';
        document.getElementById('ext-country').value = ex.country || '';
        document.getElementById('ext-date').value = ex.date || '';
        document.getElementById('ext-distanceKm').value = ex.distanceKm || '';
        document.getElementById('ext-place').value = (ex.place === null || ex.place === undefined) ? '' : ex.place;
        document.getElementById('ext-status').value = ex.status || '';
        document.getElementById('ext-score').value = ex.score || '';
        document.getElementById('ext-cancel-btn').style.display = 'block';
        window.scrollTo(0, 0);
    }

    function cancelExternalEdit() {
        editingExternalId = null;
        EXT_MEZOK.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        document.getElementById('ext-cancel-btn').style.display = 'none';
    }

    function deleteExternalResult(id) {
        showConfirm('Eredmény törlése', 'Biztosan törlöd ezt a külföldi eredményt?', () => {
            db.ref('externalResults/' + id).remove().then(() => showToast('Törölve.'));
        });
    }

    function renderExternalResultsList() {
        const cont = document.getElementById('ext-list-container');
        if (!cont) return;
        const entries = Object.entries(externalResultsCache).sort((a, b) => (b[1].date || '').localeCompare(a[1].date || ''));
        if (entries.length === 0) { cont.innerHTML = `<p style="color:var(--text-dim); text-align:center;">Nincs még rögzített külföldi eredmény.</p>`; return; }
        cont.innerHTML = entries.map(([id, ex]) => {
            const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
            // A kézzel felvitt rekordban raceName van, a FEI importban event + venue - mindkettőt kezeljük.
            const verseny = ex.raceName || ex.event || '(névtelen verseny)';
            const hely = ex.venue ? ex.venue + ', ' : '';
            const loNev = ex.horseName ? ` · ${escapeHtml(ex.horseName)}` : '';
            const jelzes = ex.source === 'FEI' ? ' <span style="color:var(--teal); font-size:0.75rem; font-weight:700;">FEI</span>' : '';
            return `<div class="competitor-item">
                <div style="flex:1;"><b>${escapeHtml(riderInfo.name || ex.license)}</b> — ${escapeHtml(verseny)}${jelzes} <span style="color:var(--text-dim);">(${escapeHtml(hely + (ex.country || '?'))}, ${ex.date})</span><br>
                <span style="color:var(--text-dim); font-size:0.85rem;">${ex.distanceKm} km${ex.place ? ', ' + ex.place + '. hely' : (ex.status ? ', ' + escapeHtml(ex.status) : '')}${loNev}</span></div>
                <div style="display:flex; gap:8px;">
                    <button class="edit-btn admin-only" onclick="editExternalResult('${id}')">Módosítás</button>
                    <button class="edit-btn admin-only" style="background:var(--danger);" onclick="deleteExternalResult('${id}')">Törlés</button>
                </div>
            </div>`;
        }).join('');
    }

    // --- CSAPATBAJNOKSÁG: bajnokavatás dátuma (admin, l. terv 3.2) ---
    function saveBajnokavatasDatum(year, val) {
        db.ref('settings/bajnokavatasDatum/' + year).set(val || null).catch(e => showToast('Hiba: ' + e.message, true));
    }

    function renderBajnokavatasDatumSettings() {
        const cont = document.getElementById('bajnokavatas-datum-container');
        if (!cont) return;
        const thisYear = new Date().getFullYear();
        const years = Array.from(new Set([...getAvailableChampionshipYears(), thisYear, thisYear + 1])).sort((a, b) => b - a);
        cont.innerHTML = years.map(y => `
            <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:1px solid var(--border-soft);">
                <span style="font-weight:700; color:var(--text); min-width:90px;">${y}. év:</span>
                <input type="date" value="${bajnokavatasDatumCache[y] || ''}" placeholder="${y}-12-31" style="margin-top:0; flex:1;" onchange="saveBajnokavatasDatum(${y}, this.value)">
            </div>
        `).join('');
    }

    // ============================================================================
    // VERSENYÁTTEKINTŐ (admin) - egy verseny összes versenyzője, minden köre és ideje egy
    // táblázatban. Itt (és csak itt) van a >= 16 km/h piros jelzés a minősítők ellenőrzéséhez
    // (139. § (2) sebességkorlát) - a nyilvános versenyzői adatlap színezés nélküli.
    // Innen nyomtatható a FEI orvosi lap is, és név szerint kereshető minden idei verseny.
    // ============================================================================
    let attekintoForras = null;
    let attekintoTav = 'all';
    const MINOSITO_HATAR_KMH = 16;

    function attekintoVersenyek() {
        const lista = [];
        if (liveRaceMeta) lista.push({ id: 'live', nev: `🔴 ÉLŐ: ${liveRaceMeta.name}` });
        localRaces.mult.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
            .forEach(r => lista.push({ id: r.id, nev: `${r.date || ''} · ${r.name}` }));
        return lista;
    }

    function setAttekintoVerseny(id) { attekintoForras = id; attekintoTav = 'all'; renderAttekinto(); }
    function setAttekintoTav(tav) { attekintoTav = tav; renderAttekinto(); }

    function renderAttekinto() {
        const cont = document.getElementById('attekinto-tartalom');
        if (!cont) return;
        const versenyek = attekintoVersenyek();
        if (!versenyek.some(v => v.id === attekintoForras)) attekintoForras = versenyek.length ? versenyek[0].id : null;
        const sel = document.getElementById('attekinto-verseny');
        if (sel) sel.innerHTML = versenyek.length
            ? versenyek.map(v => `<option value="${escapeHtml(v.id)}" ${v.id === attekintoForras ? 'selected' : ''}>${escapeHtml(v.nev)}</option>`).join('')
            : '<option value="">Nincs verseny</option>';
        renderAttekintoKereso();

        const v = attekintoForras ? versenyForras(attekintoForras) : null;
        if (!v) { cont.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs megjeleníthető verseny.</p>'; return; }

        const cats = getActiveCategories(v.comps, v.config);
        if (attekintoTav !== 'all' && !cats.includes(attekintoTav)) attekintoTav = 'all';
        const tavSel = document.getElementById('attekinto-tav');
        if (tavSel) tavSel.innerHTML = `<option value="all">Minden táv</option>` +
            cats.map(c => `<option value="${c}" ${c === attekintoTav ? 'selected' : ''}>${escapeHtml(catNames[c] || c)}</option>`).join('');

        const ranks = calculateCurrentRanks(v.comps, v.config);
        const piros = sp => sp > 0 && sp >= MINOSITO_HATAR_KMH;
        let html = '';
        (attekintoTav === 'all' ? cats : [attekintoTav]).forEach(cat => {
            const comps = v.comps.filter(c => c.dist === cat).sort(eredmenyRendezo(ranks));
            if (!comps.length) return;
            const cfg = v.config[cat.replace('j', '')] || { laps: [] };
            const korSzam = Math.max((cfg.laps || []).length, ...comps.map(c => (c.laps || []).length), 1);
            // Telefonon a széles táblázat olvashatatlan - ott versenyzőnként kártya (CSS dönti el, melyik látszik).
            let kartyak = '';
            html += `<h4 class="attekinto-cim">${escapeHtml(catNames[cat] || cat)} <small>(${comps.length} versenyző)</small></h4>
                <div class="table-responsive att-asztali"><table class="ttrack-table attekinto-tabla"><tr>
                <th class="col-header">Hely</th><th class="col-header">#</th><th class="col-header" style="text-align:left;">Versenyző / ló</th>`;
            for (let i = 0; i < korSzam; i++) {
                html += `<th class="col-header">${i + 1}. kör${cfg.laps && cfg.laps[i] ? `<br><small>${escapeHtml(String(cfg.laps[i]))} km</small>` : ''}</th>`;
            }
            html += `<th class="col-header">Össz. idő</th><th class="col-header">Össz. átlag</th><th class="col-header">Állapot</th><th class="col-header"></th></tr>`;

            comps.forEach(c => {
                const kesz = (c.laps || []).filter(l => l && l.isComplete);
                const ut = kesz[kesz.length - 1];
                let gyors = false;
                let korSorok = '';
                let sor = `<tr><td><b>${escapeHtml(helyezesCimke(c, (ranks[c.bib] || {}).rank))}</b></td><td>${escapeHtml(String(c.bib))}</td>
                    <td style="text-align:left;"><b>${escapeHtml(c.name)}</b><br><small style="color:var(--text-dim);">${c.internal ? escapeHtml(c.internal) : ''}</small></td>`;
                for (let i = 0; i < korSzam; i++) {
                    const l = (c.laps || [])[i] || {};
                    if (!(l.arrSec > 0)) {
                        sor += '<td style="color:var(--text-dim-2);">-</td>';
                        korSorok += `<tr class="ures"><td>${i + 1}.</td><td colspan="3">még nincs adat</td></tr>`;
                        continue;
                    }
                    const korP = l.isComplete && piros(l.loopSpd), orvP = l.isComplete && piros(l.phaseSpd);
                    if (korP || orvP) gyors = true;
                    korSorok += `<tr><td>${i + 1}.${cfg.laps && cfg.laps[i] ? `<small>${escapeHtml(String(cfg.laps[i]))} km</small>` : ''}</td>
                        <td>${toTimeStr(l.arrSec)}<small>${l.vetSec > 0 ? toTimeStr(l.vetSec) : '–'}</small></td>
                        <td>${l.pulzusSec > 0 ? toTimeStr(l.pulzusSec) : '–'}<small>${l.pulse ? escapeHtml(String(l.pulse)) + '/perc' : ''}</small></td>
                        <td><span class="${korP ? 'gyors' : ''}">${l.isComplete && l.loopSpd > 0 ? kmh(l.loopSpd) : '–'}</span><small class="${orvP ? 'gyors' : ''}">${l.isComplete && l.phaseSpd > 0 ? kmh(l.phaseSpd) : '–'}</small></td></tr>`;
                    sor += `<td class="attekinto-kor">
                        <div>Beérk.: <b>${toTimeStr(l.arrSec)}</b></div>
                        <div>Orvosi: <b>${l.vetSec > 0 ? toTimeStr(l.vetSec) : '-'}</b></div>
                        <div>Pulzusidő: <b>${l.pulzusSec > 0 ? toTimeStr(l.pulzusSec) : '-'}</b>${l.pulse ? ` · ${escapeHtml(String(l.pulse))}` : ''}</div>
                        <div>Köridő: <b>${l.loopSec > 0 ? toTimeStr(l.loopSec) : '-'}</b></div>
                        <div class="${korP ? 'gyors' : ''}">Kör: ${l.isComplete && l.loopSpd > 0 ? kmh(l.loopSpd) : '-'} km/h</div>
                        <div class="${orvP ? 'gyors' : ''}">Orvosi: ${l.isComplete && l.phaseSpd > 0 ? kmh(l.phaseSpd) : '-'} km/h</div>
                    </td>`;
                }
                const osszIdo = ut ? ((c.dist === '20' || c.dist === '20j') && ut.vetSec > 0 ? ut.loopSec + ut.pulzusSec : ut.rideTime) : (c.manualEntry ? c.totalTimeSec : 0);
                // "Gyors eredmény" (nincs köradat): a táv és a kézzel megadott végidő hányadosa.
                const osszAtlag = ut ? ut.rideSpd
                    : (c.manualEntry && osszIdo > 0 ? (parseInt(String(c.dist || '').replace('j', ''), 10) || 0) / (osszIdo / 3600) : 0);
                if (piros(osszAtlag)) gyors = true;
                const st = getCompLiveStatus(c, v.config);
                sor += `<td><b>${osszIdo > 0 ? toTimeStr(osszIdo) : '-'}</b></td>
                    <td class="${piros(osszAtlag) ? 'gyors' : ''}"><b>${osszAtlag > 0 ? kmh(osszAtlag) + ' km/h' : '-'}</b></td>
                    <td><span class="adatlap-live-status" style="background:${st.color}; color:${st.textCol || '#fff'};">${escapeHtml(st.text)}</span>${gyors ? '<br><span class="gyors-jel">⚠ 16+ km/h</span>' : ''}</td>
                    <td><button class="edit-btn" onclick="printFeiVetCard('${escapeHtml(attekintoForras)}', '${escapeHtml(String(c.bib))}')">🩺 FEI lap</button></td></tr>`;
                html += sor;
                kartyak += `<div class="att-kartya">
                    <div class="att-kartya-fej">
                        <span class="att-hely">${escapeHtml(helyezesCimke(c, (ranks[c.bib] || {}).rank))}</span>
                        <div class="att-nev"><b>#${escapeHtml(String(c.bib))} ${escapeHtml(c.name)}</b><small>${escapeHtml(c.internal || '')}</small></div>
                        <span class="adatlap-live-status" style="background:${st.color}; color:${st.textCol || '#fff'};">${escapeHtml(st.text)}</span>
                    </div>
                    <div class="att-ossz">Össz. idő <b>${osszIdo > 0 ? toTimeStr(osszIdo) : '–'}</b> · Átlag <b class="${piros(osszAtlag) ? 'gyors' : ''}">${osszAtlag > 0 ? kmh(osszAtlag) + ' km/h' : '–'}</b>${gyors ? ' <span class="gyors-jel">⚠ 16+ km/h</span>' : ''}</div>
                    <table class="att-korok"><tr><th>Kör</th><th>Beérk.<small>Orvosi</small></th><th>Pulzusidő<small>pulzus</small></th><th>km/h<small>orvosi km/h</small></th></tr>${korSorok}</table>
                    <button class="edit-btn" onclick="printFeiVetCard('${escapeHtml(attekintoForras)}', '${escapeHtml(String(c.bib))}')">🩺 FEI orvosi lap</button>
                </div>`;
            });
            html += `</table></div><div class="att-mobil">${kartyak}</div>`;
        });
        cont.innerHTML = html || '<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Ebben a versenyben még nincs versenyző.</p>';
    }

    // Név szerinti keresés az IDEI versenyekben (élő + múltbéli) -> FEI orvosi lap nyomtatása.
    function renderAttekintoKereso() {
        const cont = document.getElementById('attekinto-kereso-lista');
        if (!cont) return;
        const q = (document.getElementById('attekinto-kereso')?.value || '').trim().toLowerCase();
        if (q.length < 2) { cont.innerHTML = '<p class="field-hint" style="margin:6px 0 0 0;">Írj be legalább 2 karaktert (lovas vagy ló neve, rajtszám, igazolási szám).</p>'; return; }
        const ev = String(new Date().getFullYear());
        const forrasok = [];
        if (liveRaceMeta) forrasok.push({ id: 'live', meta: liveRaceMeta, comps: competitors });
        localRaces.mult.filter(r => String(r.date || '').startsWith(ev))
            .forEach(r => forrasok.push({ id: r.id, meta: r, comps: parseCompetitors(r.competitors) }));
        const talalatok = [];
        forrasok.forEach(f => f.comps.forEach(c => {
            const szoveg = [c.name, c.internal, c.license, c.bib, c.startNum].join(' ').toLowerCase();
            if (szoveg.includes(q)) talalatok.push({ f, c });
        }));
        talalatok.sort((a, b) => String(b.f.meta.date || '').localeCompare(String(a.f.meta.date || '')));
        cont.innerHTML = talalatok.length ? talalatok.map(({ f, c }) => `
            <div class="competitor-item">
                <div style="flex:1; min-width:180px;"><b>${escapeHtml(c.name)}</b>${c.internal ? ' · ' + escapeHtml(c.internal) : ''}<br>
                    <small style="color:var(--text-dim);">${escapeHtml(f.meta.date || '')} · ${escapeHtml(f.meta.name)} · ${escapeHtml(catNames[c.dist] || c.dist)} · #${escapeHtml(String(c.bib))}</small></div>
                <button class="edit-btn" onclick="printFeiVetCard('${escapeHtml(f.id)}', '${escapeHtml(String(c.bib))}')">🖨️ FEI orvosi lap</button>
            </div>`).join('')
            : '<p style="text-align:center; color:var(--text-dim); padding:12px 0;">Nincs találat az idei versenyeken.</p>';
    }

    // ============================================================================
    // ÁLLATORVOS-TÖRZS SZERKESZTŐ (Beállítások > Állatorvosok): elírt nevek javítása, két írásmód
    // összevonása. Az átnevezés MINDENHOL átvezeti a nevet: törzs, élő és versenyenkénti
    // orvoslisták, valamint minden rögzített vizsgálat (kör / előzetes) vetName mezője.
    // ============================================================================
    function vetNevFrissitesek(regi, uj) {
        const u = {};
        const vizsgalatok = (alapUt, comps) => {
            Object.entries(comps || {}).forEach(([kulcs, c]) => {
                if (!c) return;
                if (c.preVet && c.preVet.vetName === regi) u[`${alapUt}/${kulcs}/preVet/vetName`] = uj;
                Object.entries(c.laps || {}).forEach(([i, l]) => { if (l && l.vetName === regi) u[`${alapUt}/${kulcs}/laps/${i}/vetName`] = uj; });
            });
        };
        liveVets.forEach(v => { if (v && v.name === regi && v.id) u[`vets/${v.id}/name`] = uj; });
        competitors.forEach(c => {
            if (c.preVet && c.preVet.vetName === regi) u[`competitors/${c.bib}/preVet/vetName`] = uj;
            (c.laps || []).forEach((l, i) => { if (l && l.vetName === regi) u[`competitors/${c.bib}/laps/${i}/vetName`] = uj; });
        });
        ['mult', 'jovo'].forEach(tipus => localRaces[tipus].forEach(r => {
            Object.entries(r.vets || {}).forEach(([id, v]) => { if (v && v.name === regi) u[`races/${tipus}/${r.id}/vets/${id}/name`] = uj; });
            vizsgalatok(`races/${tipus}/${r.id}/competitors`, r.competitors);
        }));
        return u;
    }

    // A lista az ÖSSZES létező állatorvos: a törzs (vetsDb), az élő és a versenyenkénti
    // orvoslisták, valamint minden rögzített vizsgálatban szereplő név - mindegyik egy sor,
    // mentés (javítás / összevonás) és törlés gombbal.
    function vetMindenNev() {
        const torzs = Object.values(vetsDbCache).filter(v => v && v.name).map(v => v.name);
        const vizsgalat = {};
        const szamol = n => { if (n) vizsgalat[n] = (vizsgalat[n] || 0) + 1; };
        competitors.forEach(c => { szamol(c.preVet && c.preVet.vetName); (c.laps || []).forEach(l => szamol(l && l.vetName)); });
        localRaces.mult.forEach(r => parseCompetitors(r.competitors).forEach(c => { szamol(c.preVet && c.preVet.vetName); (c.laps || []).forEach(l => szamol(l && l.vetName)); }));
        const listan = {};
        const listaba = n => { if (n) listan[n] = (listan[n] || 0) + 1; };
        liveVets.forEach(v => listaba(v && v.name));
        ['mult', 'jovo'].forEach(t => localRaces[t].forEach(r => Object.values(r.vets || {}).forEach(v => listaba(v && v.name))));
        const nevek = Array.from(new Set(torzs.concat(Object.keys(vizsgalat), Object.keys(listan)))).sort((a, b) => a.localeCompare(b, 'hu'));
        return { nevek, torzs, vizsgalat, listan };
    }

    function renderVetTorzs() {
        const cont = document.getElementById('vet-torzs-lista');
        if (!cont) return;
        const { nevek, vizsgalat, listan } = vetMindenNev();
        const uj = `<div class="competitor-item vet-torzs-sor">
                <input type="text" id="vet-uj-felvetel" placeholder="Új állatorvos neve (pl. Dr. Kovács Anna)" autocomplete="off" onkeydown="if(event.key==='Enter') vetTorzsFelvetel()">
                <button class="edit-btn" onclick="vetTorzsFelvetel()">➕ Hozzáadás</button>
            </div>`;
        if (!nevek.length) { cont.innerHTML = uj + '<p style="color:var(--text-dim);">Még nincs rögzített állatorvos.</p>'; cont.dataset.nevek = '[]'; return; }
        cont.innerHTML = uj + `<p class="field-hint" style="margin:10px 0 6px 0;">${nevek.length} állatorvos</p>` + nevek.map((n, i) => {
            const adat = [];
            if (vizsgalat[n]) adat.push(`${vizsgalat[n]} rögzített vizsgálat`);
            if (listan[n]) adat.push(`${listan[n]} verseny orvoslistáján`);
            return `<div class="competitor-item vet-torzs-sor">
                <input type="text" id="vet-uj-nev-${i}" value="${escapeHtml(n)}" autocomplete="off" onkeydown="if(event.key==='Enter') vetAtnevezes(${i})" aria-label="Állatorvos neve">
                <button class="edit-btn vet-mentes" onclick="vetAtnevezes(${i})">💾 Mentés</button>
                <button class="edit-btn is-danger" onclick="vetTorzsTorles(${i})">Törlés</button>
                <small class="vet-torzs-info">${adat.length ? adat.join(' · ') : 'csak a keresőben szerepel'}</small>
            </div>`;
        }).join('');
        cont.dataset.nevek = JSON.stringify(nevek);
    }

    function vetTorzsNev(i) {
        try { return JSON.parse(document.getElementById('vet-torzs-lista').dataset.nevek || '[]')[i]; } catch (e) { return null; }
    }

    function vetTorzsFelvetel() {
        const mezo = document.getElementById('vet-uj-felvetel');
        const nev = String(mezo.value || '').trim().replace(/\s+/g, ' ');
        if (!nev) { showToast('Add meg az állatorvos nevét!', true); return; }
        if (vetMindenNev().nevek.some(n => n.toLowerCase() === nev.toLowerCase())) { showToast('Ez az állatorvos már szerepel a listában.', true); return; }
        db.ref('vetsDb/' + sanitizeKey(nev)).update({ name: nev, updatedAt: Date.now() })
            .then(() => { mezo.value = ''; showToast('Állatorvos hozzáadva.'); renderVetTorzs(); })
            .catch(e => showToast('Hiba: ' + e.message, true));
    }

    // Mentés: változatlan névnél csak a törzsbe veszi fel (ha még nem volt benne), megváltozott
    // névnél mindenhol átírja - ha az új név már létezik, a kettő összevonódik.
    function vetAtnevezes(i) {
        const regi = vetTorzsNev(i);
        const uj = String(document.getElementById('vet-uj-nev-' + i).value || '').trim().replace(/\s+/g, ' ');
        if (!regi) return;
        if (!uj) { showToast('Add meg a helyes nevet!', true); return; }
        if (uj === regi) {
            if (Object.values(vetsDbCache).some(v => v && v.name === regi)) { showToast('Nincs változás - a név már el van mentve.'); return; }
            db.ref('vetsDb/' + sanitizeKey(regi)).update({ name: regi, updatedAt: Date.now() })
                .then(() => { showToast('Mentve.'); renderVetTorzs(); })
                .catch(e => showToast('Hiba: ' + e.message, true));
            return;
        }
        const u = vetNevFrissitesek(regi, uj);
        const vizsgalatDb = Object.keys(u).filter(k => k.endsWith('/vetName')).length;
        if (sanitizeKey(regi) !== sanitizeKey(uj)) u['vetsDb/' + sanitizeKey(regi)] = null;
        u['vetsDb/' + sanitizeKey(uj) + '/name'] = uj;
        u['vetsDb/' + sanitizeKey(uj) + '/updatedAt'] = Date.now();
        const osszevon = vetMindenNev().nevek.includes(uj);
        showConfirm('Állatorvos mentése', `"${regi}" → "${uj}". ${vizsgalatDb} rögzített vizsgálatban és az orvoslistákban is átíródik.${osszevon ? ` "${uj}" már létezik - a kettő összevonódik.` : ''}`, () => {
            db.ref('/').update(u).then(() => { showToast('Mentve.'); renderVetTorzs(); })
                .catch(e => showToast('Hiba: ' + e.message, true));
        });
    }

    // Teljes törlés: a törzsből, az élő és a versenyenkénti orvoslistákból, és a rögzített
    // vizsgálatokból is (ott csak az orvos neve lesz üres, a vizsgálat adatai megmaradnak).
    function vetNevTorlesek(nev) {
        const u = {};
        Object.entries(vetNevFrissitesek(nev, null)).forEach(([ut]) => {
            // orvoslista-bejegyzés: az egész bejegyzés törlődik, nem csak a neve
            u[ut.endsWith('/name') ? ut.slice(0, -'/name'.length) : ut] = null;
        });
        Object.entries(vetsDbCache).forEach(([k, v]) => { if (v && v.name === nev) u['vetsDb/' + k] = null; });
        u['vetsDb/' + sanitizeKey(nev)] = null;
        return u;
    }

    function vetTorzsTorles(i) {
        const nev = vetTorzsNev(i);
        if (!nev) return;
        const u = vetNevTorlesek(nev);
        const vizsgalatDb = Object.keys(u).filter(k => k.endsWith('/vetName')).length;
        const listaDb = Object.keys(u).filter(k => /(^|\/)vets\/[^/]+$/.test(k)).length;
        const reszletek = [];
        if (vizsgalatDb) reszletek.push(`${vizsgalatDb} rögzített vizsgálatból az orvos neve is törlődik (a vizsgálat adatai megmaradnak)`);
        if (listaDb) reszletek.push(`${listaDb} orvoslistáról is lekerül`);
        showConfirm('Állatorvos törlése', `Biztosan törlöd: "${nev}"?${reszletek.length ? '\n' + reszletek.join(', ') + '.' : ''}\nEz nem vonható vissza. Ha csak elírás, inkább javítsd ki a nevet és mentsd.`, () => {
            db.ref('/').update(u).then(() => { showToast('Törölve.'); renderVetTorzs(); })
                .catch(e => showToast('Hiba: ' + e.message, true));
        });
    }

    // --- ÉV TENYÉSZTŐJE - placeholder (l. terv 5.) ---
    // (a tenyésztő a ló-törzsbe a tavlovasok_import_v4.json-ból kerül be - horses/{startNum}.breeder)

    // ============================================================================
    // A FELÜLET (2026-10-06 óta az egyetlen): a <html class="uj-dizajn"> alatt él (rps-uj.css), felső
    // menüvel (az oldalsó menü gombjaira épül, így a jogosultságok ugyanazok), telefonon alsó
    // fülsávval, és egy Kezdőlappal (képváltó + összefoglaló / élő verseny).
    // ============================================================================
    const UJ_NAV = [
        { cim: 'Kezdőlap', mod: 'kezdolap' },
        { cim: 'Versenyek', elemek: ['btn-menu-versenyek'] },
        { cim: 'Élő', elemek: ['btn-menu-elo-rajtok', 'btn-menu-adatlapok'] },
        { cim: 'Bajnokság', elemek: ['btn-menu-bajnoksag-egyeni', 'btn-menu-bajnoksag-lo', 'btn-menu-bajnoksag-csapat', 'btn-menu-bajnoksag-teny'] },
        { cim: 'Lovasok és lovak', elemek: ['btn-menu-torzs-lovasok', 'btn-menu-torzs-lovak'] },
        { cim: 'Eszközök', elemek: ['btn-menu-reszido', 'btn-menu-minosites'] }
    ];

    const EMOJI_ELEJE = /^[\s‍️←-⇿⌀-⏿☀-➿⬀-⯿\u{1F000}-\u{1FAFF}]+/u;
    function emojiNelkul(s) { const t = String(s || '').replace(EMOJI_ELEJE, '').trim(); return t || String(s || '').trim(); }

    // Látszik-e a gomb az oldalsó menüben (szerepkör szerint)? A menü maga lehet rejtett (új
    // dizájnban fiók), ezért a gomb és a szülei SAJÁT display-ét nézzük, a #sidebar-ig.
    function sidebarbanLathato(el) {
        for (let e = el; e && e.id !== 'sidebar'; e = e.parentElement) {
            if (getComputedStyle(e).display === 'none') return false;
        }
        return !!el;
    }

    function ujNavElemek(csoport) {
        return (csoport.elemek || []).map(id => document.getElementById(id)).filter(b => b && sidebarbanLathato(b));
    }

    function ujNavKezelesElemek() {
        return [...document.querySelectorAll('#admin-menu .sidebar-btn, #szerepkor-menu .sidebar-btn, #nyomtatvany-menu .sidebar-btn')].filter(sidebarbanLathato);
    }

    function ujNavLenyiloBezar() { document.querySelectorAll('.uj-nav-csoport.nyitva').forEach(c => c.classList.remove('nyitva')); }

    function ujNavLenyilo(gomb) {
        const csoport = gomb.closest('.uj-nav-csoport');
        const nyitva = csoport.classList.contains('nyitva');
        ujNavLenyiloBezar();
        if (!nyitva) csoport.classList.add('nyitva');
    }

    function ujNavValaszt(id) {
        ujNavLenyiloBezar();
        if (id === 'kezdolap') { switchSidebarMode('kezdolap', null); return; }
        const b = document.getElementById(id);
        if (b) b.click();
    }

    function ujNavFrissit() {
        const nav = document.getElementById('uj-nav');
        if (!nav) return;
        const aktivMod = (document.querySelector('.mode-content.active') || {}).id;
        const aktivGomb = document.querySelector('#sidebar .sidebar-btn.active');
        const elemHtml = b => `<button class="uj-nav-elem ${b === aktivGomb ? 'aktiv' : ''}" onclick="ujNavValaszt('${b.id || ''}')" ${b.id ? '' : 'disabled'}>${escapeHtml(emojiNelkul(b.textContent))}</button>`;

        let html = '';
        UJ_NAV.forEach(cs => {
            if (cs.mod) {
                html += `<button class="uj-nav-fo ${aktivMod === cs.mod ? 'aktiv' : ''}" onclick="ujNavValaszt('${cs.mod}')">${cs.cim}</button>`;
                return;
            }
            const elemek = ujNavElemek(cs);
            if (!elemek.length) return;
            const aktiv = elemek.includes(aktivGomb);
            if (elemek.length === 1) {
                html += `<button class="uj-nav-fo ${aktiv ? 'aktiv' : ''}" onclick="ujNavValaszt('${elemek[0].id}')">${cs.cim}</button>`;
            } else {
                html += `<div class="uj-nav-csoport"><button class="uj-nav-fo ${aktiv ? 'aktiv' : ''}" onclick="ujNavLenyilo(this)">${cs.cim} <span class="uj-nyil">▾</span></button>
                    <div class="uj-nav-lenyilo">${elemek.map(elemHtml).join('')}</div></div>`;
            }
        });
        nav.innerHTML = html;

        // Kezelés (belépett szerepkörök) + fiók
        const jobb = document.getElementById('uj-nav-jobb');
        if (jobb) {
            const kezeles = ujNavKezelesElemek();
            // A nyomtatós (onclick-es, id nélküli) gombokat is el kell érni: indexszel hivatkozunk rájuk
            window.__ujKezelesGombok = kezeles;
            const fu = auth.currentUser;
            const fp = (fiokAdat && fiokAdat.profil) || {};
            jobb.innerHTML = (kezeles.length ? `<div class="uj-nav-csoport jobbra"><button class="uj-nav-fo uj-kezeles ${kezeles.includes(aktivGomb) ? 'aktiv' : ''}" onclick="ujNavLenyilo(this)">Kezelés <span class="uj-nyil">▾</span></button>
                    <div class="uj-nav-lenyilo">${kezeles.map((b, i) => `<button class="uj-nav-elem ${b === aktivGomb ? 'aktiv' : ''}" onclick="ujNavLenyiloBezar(); window.__ujKezelesGombok[${i}].click()">${escapeHtml(emojiNelkul(b.textContent))}</button>`).join('')}</div></div>` : '')
                + (fu ? `<button class="uj-fiok belepve" onclick="fiokMegnyit()" title="Fiókom">${fiokAvatarHtml(fu, fp)}<span>${escapeHtml(String(fp.nev || fu.displayName || 'Fiók').split(' ')[0])}</span></button>`
                      : `<button class="uj-fiok" onclick="fiokMegnyit('belepes')">Belépés</button>`);
        }

        // Alsó fülsáv (telefon)
        const also = document.getElementById('uj-also-sav');
        if (also) {
            const fulek = [
                { cim: 'Kezdőlap', ikon: '⌂', id: 'kezdolap', aktiv: aktivMod === 'kezdolap' },
                { cim: 'Versenyek', ikon: '◷', id: 'btn-menu-versenyek', aktiv: aktivMod === 'versenyek' || aktivMod === 'past-race-view' },
                { cim: 'Élő', ikon: '●', id: 'btn-menu-adatlapok', aktiv: aktivMod === 'adatlapok' || aktivMod === 'elo-rajtok', elo: !!liveRaceMeta },
                { cim: 'Bajnokság', ikon: '★', id: 'btn-menu-bajnoksag-egyeni', aktiv: /^bajnoksag/.test(aktivMod || '') },
            ];
            also.innerHTML = fulek.map(f => `<button class="${f.aktiv ? 'aktiv' : ''} ${f.elo ? 'elo' : ''}" onclick="ujNavValaszt('${f.id}')"><span class="uj-ikon">${f.ikon}</span>${f.cim}</button>`).join('')
                + `<button onclick="toggleMenu()"><span class="uj-ikon">☰</span>Menü</button>`;
        }
    }

    // A HTML-ben a címekben és gombokban sok az emoji - a felületen ezek nélkül tisztább.
    // A szöveg eleji emojit vesszük le (címek, gombok, fülek, lenyitható fejlécek); ha csak emoji
    // volt a szöveg (pl. "⇆" gomb), az marad.
    const UJ_EMOJI_CELOK = 'h2, h3, h4, button, summary, .menu-title, label';
    function ujEmojiTisztit(gyoker) {
        const lista = gyoker.matches && gyoker.matches(UJ_EMOJI_CELOK) ? [gyoker] : [];
        gyoker.querySelectorAll && lista.push(...gyoker.querySelectorAll(UJ_EMOJI_CELOK));
        lista.forEach(el => {
            if (el.closest('.uj-ikon, #uj-also-sav, .theme-swatch-row, .kovetes-gomb, .szurkolas-gomb, .profil-jel, .fiok-kovetett')) return;
            const tn = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
            if (!tn) return;
            const uj = tn.textContent.replace(EMOJI_ELEJE, '');
            if (uj !== tn.textContent && uj.trim() && /[\p{L}\p{N}]/u.test(uj)) tn.textContent = (tn.textContent.match(/^\s*/)[0] ? ' ' : '') + uj.replace(/^\s+/, '');
        });
    }

    // --- KEZDŐLAP ------------------------------------------------------------
    // alak: fekvő (kitölti a keretet), álló / négyzet (gépen EGÉSZBEN látszik, mögötte a kép
    // elmosott változata - így nem vágja le a lovas fejét és a lovat). pos: a vágás közepe, ahol a kép
    // kitölti a keretet (telefonon az álló képek), a lovasra/lóra igazítva.
    // csoport: széles csoportkép - gépen kitölti a keretet (az emberek a felső részen, az árnyék
    // halványabb, hogy a felirat ne takarja őket), telefonon EGÉSZBEN látszik, elmosott háttérrel.
    const UJ_KEPEK = [
        { src: 'kepek/tavlovas-1.jpg', alak: 'fekvo', pos: '45% 50%' },
        { src: 'kepek/tavlovas-12.jpg', alak: 'negyzet', pos: '42% 45%' },
        { src: 'kepek/tavlovas-13.jpg', alak: 'fekvo', pos: '58% 45%' },
        { src: 'kepek/tavlovas-2.jpg', alak: 'allo', pos: '52% 40%' },
        { src: 'kepek/tavlovas-14.jpg', alak: 'negyzet', pos: '40% 30%' },
        { src: 'kepek/tavlovas-9.jpg', alak: 'allo', pos: '45% 30%' },
        { src: 'kepek/tavlovas-18.jpg', alak: 'negyzet', pos: '50% 30%' },
        { src: 'kepek/tavlovas-5.jpg', alak: 'allo', pos: '50% 55%' },
        { src: 'kepek/tavlovas-10.jpg', alak: 'allo', pos: '55% 30%' },
        { src: 'kepek/tavlovas-15.jpg', alak: 'allo', pos: '50% 60%' },
        { src: 'kepek/tavlovas-4.jpg', alak: 'negyzet', pos: '45% 35%' },
        { src: 'kepek/tavlovas-17.jpg', alak: 'allo', pos: '50% 40%' },
        { src: 'kepek/tavlovas-3.jpg', alak: 'allo', pos: '45% 45%' },
        { src: 'kepek/tavlovas-7.jpg', alak: 'csoport', pos: '50% 10%' },
        { src: 'kepek/tavlovas-11.jpg', alak: 'negyzet', pos: '55% 40%' },
        { src: 'kepek/tavlovas-19.jpg', alak: 'negyzet', pos: '50% 35%' },
        { src: 'kepek/tavlovas-6.jpg', alak: 'allo', pos: '50% 35%' },
        { src: 'kepek/tavlovas-16.jpg', alak: 'allo', pos: '40% 45%' },
        { src: 'kepek/tavlovas-8.jpg', alak: 'allo', pos: '38% 60%' }
    ];
    let ujSliderIndex = 0, ujSliderId = null;

    function ujSliderMutat(i) {
        const kepek = document.querySelectorAll('#uj-hero .uj-hero-kep');
        if (!kepek.length) return;
        ujSliderIndex = (i + kepek.length) % kepek.length;
        kepek.forEach((k, j) => {
            // csak a mostanit és a következőt tölti be (a többi képet csak akkor, ha sorra kerül)
            if ((j === ujSliderIndex || j === (ujSliderIndex + 1) % kepek.length) && !k.dataset.betoltve) {
                k.querySelectorAll('.uj-hero-hatter, .uj-hero-elo').forEach(d => { d.style.backgroundImage = `url('${k.dataset.src}')`; });
                k.dataset.betoltve = '1';
            }
            k.classList.toggle('aktiv', j === ujSliderIndex);
        });
        document.getElementById('uj-hero')?.classList.toggle('csoport-aktiv', kepek[ujSliderIndex].classList.contains('alak-csoport'));
        document.querySelectorAll('#uj-hero .uj-pont').forEach((p, j) => p.classList.toggle('aktiv', j === ujSliderIndex));
    }
    function ujSliderLep(d) { ujSliderMutat(ujSliderIndex + d); ujSliderIdozit(); }
    function ujSliderIdozit() {
        clearInterval(ujSliderId);
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        ujSliderId = setInterval(() => {
            if (!document.getElementById('kezdolap')?.classList.contains('active') || document.hidden) return;
            ujSliderMutat(ujSliderIndex + 1);
        }, 6000);
    }

    function ujDatumSzoveg(datum) {
        const d = new Date(datum + 'T00:00:00');
        if (isNaN(d)) return escapeHtml(datum || '');
        return `${d.getFullYear()}. ${['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'][d.getMonth()]} ${d.getDate()}., ${HET_NAPJA[d.getDay()]}`;
    }

    function renderKezdolap() {
        const cont = document.getElementById('kezdolap-tartalom');
        if (!cont) return;
        const ma = napIso(new Date());
        const kovetkezok = localRaces.jovo.filter(r => (r.date || '') >= ma).sort((a, b) => a.date.localeCompare(b.date));
        const multak = localRaces.mult.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const kov = kovetkezok[0];

        // Hős-kép szövege: élő verseny > következő verseny > általános
        let heroCim, heroAl, heroGombok;
        if (liveRaceMeta) {
            heroCim = `<span class="uj-elo-jel">● ÉLŐ</span> ${escapeHtml(liveRaceMeta.name || 'Élő verseny')}`;
            heroAl = [liveRaceMeta.loc, `${competitors.length} nevező`, `${competitors.filter(c => teljesitetteE(c, raceConfig)).length} célban`].filter(Boolean).map(escapeHtml).join(' · ');
            heroGombok = `<button class="uj-gomb fo" onclick="ujNavValaszt('btn-menu-adatlapok')">Élő eredmények</button><button class="uj-gomb" onclick="ujNavValaszt('btn-menu-elo-rajtok')">Kiindulások</button>`;
        } else if (kov) {
            const hatra = napKulonbseg(ma, kov.date);
            heroCim = escapeHtml(kov.name || 'Következő verseny');
            heroAl = `${ujDatumSzoveg(kov.date)}${kov.loc ? ' · ' + escapeHtml(kov.loc) : ''} · ${hatra === 0 ? 'ma' : hatra === 1 ? 'holnap' : 'még ' + hatra + ' nap'}`;
            heroGombok = `<button class="uj-gomb fo" onclick="showFutureInfo('${escapeHtml(kov.id)}')">Részletek</button><button class="uj-gomb" onclick="ujNavValaszt('btn-menu-versenyek')">Versenynaptár</button>`;
        } else {
            heroCim = 'Magyar távlovas versenyek';
            heroAl = 'Élő időmérés, eredmények és bajnokság egy helyen';
            heroGombok = `<button class="uj-gomb fo" onclick="ujNavValaszt('btn-menu-versenyek')">Versenyek</button>`;
        }

        // A képváltót csak egyszer rakjuk ki (különben minden élő adatváltozás az első képre ugratná),
        // utána csak a rajta lévő szöveget és az alatta lévő szekciókat frissítjük.
        if (!document.getElementById('uj-hero')) {
            cont.innerHTML = `<section id="uj-hero" class="uj-hero" onmouseenter="clearInterval(ujSliderId)" onmouseleave="ujSliderIdozit()">
                ${UJ_KEPEK.map((k, i) => `<div class="uj-hero-kep alak-${k.alak} ${i === 0 ? 'aktiv' : ''}" data-src="${k.src}" ${i === 0 ? 'data-betoltve="1"' : ''} style="--pos:${k.pos};">
                    <div class="uj-hero-hatter"${i === 0 ? ` style="background-image:url('${k.src}')"` : ''}></div><div class="uj-hero-elo"${i === 0 ? ` style="background-image:url('${k.src}')"` : ''}></div></div>`).join('')}
                <div class="uj-hero-arnyek"></div>
                <div class="uj-hero-szoveg" id="uj-hero-szoveg"></div>
                <button class="uj-hero-nyil bal" onclick="ujSliderLep(-1)" aria-label="Előző kép">‹</button>
                <button class="uj-hero-nyil jobb" onclick="ujSliderLep(1)" aria-label="Következő kép">›</button>
                <div class="uj-hero-pontok">${UJ_KEPEK.map((_, i) => `<button class="uj-pont ${i === 0 ? 'aktiv' : ''}" onclick="ujSliderMutat(${i}); ujSliderIdozit()" aria-label="${i + 1}. kép"></button>`).join('')}</div>
                <div class="uj-hero-forras">Fotók: tavlovasok.hu</div>
            </section><div id="kezdolap-szekciok"></div>`;
            ujSliderIndex = 0;
            ujSliderIdozit();
        }
        document.getElementById('uj-hero-szoveg').innerHTML = `
            <div class="uj-hero-felirat">${liveRaceMeta ? 'Most zajlik' : kov ? 'Következő verseny' : 'Távlovaglás'}</div>
            <h2 class="uj-hero-cim">${heroCim}</h2>
            <div class="uj-hero-al">${heroAl}</div>
            <div class="uj-hero-gombok">${heroGombok}</div>`;

        // Élő versenynél a kép alacsonyabb, hogy az élő számok görgetés nélkül látszódjanak.
        document.getElementById('uj-hero').classList.toggle('elo', !!liveRaceMeta);
        // Élő verseny alatt az élő adatok kerülnek előre; a naptár / archívum / bajnokság alattuk marad.
        // Ezek csak a versenylista változásakor számolódnak újra (élő adatnál másodpercenként jöhet frissítés).
        const eloHtml = liveRaceMeta ? kezdolapEloSzekciok() : '';
        if (kezdolapAlso.forras !== localRaces || kezdolapAlso.nap !== ma) {
            kezdolapAlso = { forras: localRaces, nap: ma, html: kezdolapAlsoSzekciok(ma, kovetkezok, multak) };
        }
        document.getElementById('kezdolap-szekciok').innerHTML = eloHtml + kezdolapAlso.html;
    }

    let kezdolapAlso = { forras: null, nap: '', html: '' };

    function kezdolapAlsoSzekciok(ma, kovetkezok, multak) {
        let html = '';

        // Következő versenyek
        html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Versenynaptár</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-versenyek')">Összes verseny →</button></div>`;
        html += kovetkezok.length ? `<div class="uj-naptar">${kovetkezok.slice(0, 4).map(r => {
            const d = new Date(r.date + 'T00:00:00');
            const hatra = napKulonbseg(ma, r.date);
            return `<button class="uj-naptar-elem" onclick="showFutureInfo('${escapeHtml(r.id)}')">
                <span class="uj-nd"><b>${d.getDate()}</b>${HONAP_ROVID[d.getMonth()]}</span>
                <span class="uj-nt"><b>${escapeHtml(r.name || '')}</b><small>${r.loc ? escapeHtml(r.loc) + ' · ' : ''}${hatra === 0 ? 'ma' : hatra === 1 ? 'holnap' : 'még ' + hatra + ' nap'}${r.isObRound !== false ? ' · OB-forduló' : ''}</small></span>
            </button>`;
        }).join('')}</div>` : '<p class="uj-ures">Nincs kiírt jövőbeli verseny.</p>';
        html += `</section>`;

        // Legutóbbi eredmények
        html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Legutóbbi eredmények</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-versenyek')">Archívum →</button></div><div class="uj-racs">`;
        multak.slice(0, 2).forEach(r => {
            const comps = parseCompetitors(r.competitors);
            const cfg = mergeRaceConfig(r.raceConfig);
            const ranks = calculateCurrentRanks(comps, cfg);
            const gy = getActiveCategories(comps, cfg).map(d => {
                const c = comps.find(x => x.dist === d && ranks[x.bib] && ranks[x.bib].rank === 1);
                return c ? `<li><span>${escapeHtml(catNames[d] || d)}</span><b>${escapeHtml(c.name)}</b>${c.internal ? `<small>${escapeHtml(c.internal)}</small>` : ''}</li>` : '';
            }).join('');
            html += `<article class="uj-kartya">
                <div class="uj-kartya-fej"><small>${ujDatumSzoveg(r.date)}${r.loc ? ' · ' + escapeHtml(r.loc) : ''}</small><h4>${escapeHtml(r.name || '')}</h4></div>
                <ul class="uj-gyoztesek">${gy || '<li>Nincs helyezett.</li>'}</ul>
                <button class="uj-gomb" onclick="openPublicPastRace('${escapeHtml(r.id)}')">Teljes eredménylista</button>
            </article>`;
        });
        html += `</div></section>`;

        // Bajnokság élmezőnye
        const ev = new Date().getFullYear();
        html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Bajnokság ${ev} – élmezőny</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-bajnoksag-egyeni')">Teljes állás →</button></div><div class="uj-racs harom">`;
        Object.keys(CHAMPIONSHIP_CLASSES).forEach(k => {
            const lista = computeIndividualChampionship(k, ev).slice(0, 3);
            html += `<article class="uj-kartya"><div class="uj-kartya-fej"><h4>${escapeHtml(CHAMPIONSHIP_CLASSES[k].label.replace('Magyar ', ''))}</h4><small>${escapeHtml(CHAMPIONSHIP_CLASSES[k].sub)}</small></div>
                <ol class="uj-dobogo">${lista.length ? lista.map(r => `<li><span class="uj-hely">${r.rank}.</span><span class="uj-nev">${riderLink(escapeHtml(r.name), r.license)}</span><b>${r.totalPoints}</b></li>`).join('') : '<li class="uj-ures">Még nincs pont.</li>'}</ol></article>`;
        });
        html += `</div></section>`;

        // Legmegbízhatóbb lovak
        const lovak = computeHorseRanking(ev, false).slice(0, 5);
        if (lovak.length) {
            html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Legtöbb kilométer ${ev}</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-bajnoksag-lo')">Ló-ranglista →</button></div>
                <ol class="uj-lista">${lovak.map((h, i) => `<li><span class="uj-hely">${i + 1}.</span><span class="uj-nev">${horseLink(escapeHtml(h.horseName), h.startNum)}<small>${escapeHtml(h.lastRider || '')}</small></span><b>${String(h.totalKm).replace('.', ',')} km</b></li>`).join('')}</ol></section>`;
        }
        return html;
    }

    // --- ÉLŐ VERSENY A KEZDŐLAPON ------------------------------------------------
    function eloMostMp() { const n = new Date(); return n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds(); }

    function visszaszamSzoveg(diff) {
        if (diff <= 0) return 'most';
        const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    // Másodpercenként: csak a számlálók szövege változik, a kezdőlap nem rajzolódik újra.
    // Ha valaki már 30 mp-e "most" indul, újrarajzoljuk (lekerül a listáról).
    function kezdolapVisszaszamlalas() {
        if (!liveRaceMeta || !document.getElementById('kezdolap')?.classList.contains('active')) return;
        const most = eloMostMp();
        let lejart = false;
        document.querySelectorAll('#kezdolap .uj-visszaszam').forEach(el => {
            let diff = parseInt(el.dataset.ido, 10) - most;
            if (diff < -43200) diff += 86400;
            if (diff < -30) lejart = true;
            el.textContent = visszaszamSzoveg(diff);
            el.classList.toggle('kozel', diff <= 120);
        });
        if (lejart) renderKezdolap();
    }

    function eloKorok(c) {
        const base = String(c.dist || '').replace('j', '');
        const vart = (raceConfig[base] && raceConfig[base].laps) ? raceConfig[base].laps.length : 0;
        return { kesz: (c.laps || []).filter(l => l && l.isComplete).length, vart };
    }

    function kezdolapEloSzekciok() {
        const most = eloMostMp();
        const nevLink = c => `<span class="name-link" onclick="openAdatlap('${escapeHtml(c.bib)}')">#${escapeHtml(c.bib)} ${escapeHtml(c.name || '')}</span>`;
        const kiesett = competitors.filter(c => c.isEliminated).length;
        const celban = competitors.filter(c => teljesitetteE(c, raceConfig)).length;
        const palyan = competitors.length - kiesett - celban;
        const szam = (n, cimke, osztaly = '') => `<div class="uj-elo-szam ${osztaly}"><b>${n}</b><span>${cimke}</span></div>`;
        let html = `<section class="uj-szekcio uj-elo-blokk">
            <div class="uj-elo-szamok">${szam(competitors.length, 'nevező')}${szam(palyan, 'pályán / vizsgálaton', 'palyan')}${szam(celban, 'célban', 'cel')}${szam(kiesett, 'kiesett', 'ki')}</div>
        </section>`;

        // 0) A követett versenyzők (a lovasuk vagy a lovuk követett) - legfelül, ha vannak
        const kovetett = competitors.filter(kovetettVersenyzoE);
        if (kovetett.length) {
            const rangok = calculateCurrentRanks(competitors, raceConfig);
            html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>⭐ Követett versenyzőid</h3><button class="uj-link" onclick="fiokMegnyit()">Követések →</button></div>
                <ol class="uj-lista">${kovetett.map(c => {
                    const k = eloKorok(c);
                    const r = rangok[c.bib];
                    return `<li><span class="uj-hely">${r && typeof r.rank === 'number' ? r.rank + '.' : '–'}</span><span class="uj-nev">${nevLink(c)}<small>${escapeHtml(c.internal || '')} · ${escapeHtml(catNames[c.dist] || c.dist)}${k.vart ? ` · ${k.kesz}/${k.vart} kör` : ''} · ${escapeHtml(getCompLiveStatus(c, raceConfig).text)}</small></span>${szurkolasGombHtml(c.bib, true)}</li>`;
                }).join('')}</ol></section>`;
        }

        // 1) Következő kiindulások visszaszámlálással
        const kovetkezo = eloKiindulasAdatok(most).slice(0, 6);
        html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Következő kiindulások</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-elo-rajtok')">Összes →</button></div>`;
        html += kovetkezo.length ? `<ol class="uj-lista uj-kiindulas">${kovetkezo.map(k => {
            const ri = recheckInfo(k.comp, raceConfig);
            return `<li><span class="uj-nev">${nevLink(k.comp)}<small>${escapeHtml(catNames[k.comp.dist] || k.comp.dist)} · ${k.label}: ${toTimeStr(k.nextStart)}${ri ? ' · ' + escapeHtml(recheckSzoveg(ri)) : ''}</small></span>
                <b class="uj-visszaszam${k.diff <= 120 ? ' kozel' : ''}" data-ido="${k.nextStart}">${visszaszamSzoveg(k.diff)}</b></li>`;
        }).join('')}</ol>` : '<p class="uj-ures">Most senki nem várakozik indulásra.</p>';
        html += `</section>`;

        // 2) Élő állás kategóriánként (az első három)
        const ranks = calculateCurrentRanks(competitors, raceConfig);
        const kategoriak = getActiveCategories(competitors, raceConfig);
        if (kategoriak.length) {
            html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Élő állás</h3><button class="uj-link" onclick="ujNavValaszt('btn-menu-adatlapok')">Minden kategória →</button></div><div class="uj-racs harom">`;
            kategoriak.forEach(dist => {
                const comps = competitors.filter(c => c.dist === dist);
                const elol = comps.filter(c => ranks[c.bib] && typeof ranks[c.bib].rank === 'number')
                    .sort((a, b) => ranks[a.bib].rank - ranks[b.bib].rank).slice(0, 3);
                const ki = comps.filter(c => c.isEliminated).length;
                html += `<article class="uj-kartya">
                    <div class="uj-kartya-fej"><h4>${escapeHtml(catNames[dist] || dist)}</h4><small>${comps.length} induló${ki ? ` · ${ki} kiesett` : ''}</small></div>
                    <ol class="uj-dobogo">${elol.length ? elol.map(c => {
                        const k = eloKorok(c);
                        const all = getCompLiveStatus(c, raceConfig).text;
                        const r = ranks[c.bib];
                        return `<li><span class="uj-hely">${r.rank}.</span><span class="uj-nev">${nevLink(c)}<small>${escapeHtml(c.internal || '')}${k.vart ? ` · ${k.kesz}/${k.vart} kör` : ''} · ${escapeHtml(all)}</small></span><b>${escapeHtml(r.gapStr || '')}</b>${szurkolasGombHtml(c.bib, true)}</li>`;
                    }).join('') : '<li class="uj-ures">Még nincs teljesített kör.</li>'}</ol>
                    <button class="uj-gomb" onclick="ujNavValaszt('btn-menu-adatlapok'); setAdatlapFilter('${escapeHtml(dist)}')">Teljes állás</button>
                </article>`;
            });
            html += `</div></section>`;
        }

        // 3) Legutóbbi események: beérkezések, vizsgálatok, kiesések
        const esemenyek = [];
        competitors.forEach(c => {
            const k = eloKorok(c);
            const korok = (c.laps || []);
            const utolsoVet = korok.reduce((n, l, i) => (l && l.vetSec > 0 ? i : n), -1);
            korok.forEach((l, i) => {
                if (!l) return;
                const cel = k.vart && i === k.vart - 1;
                if (l.arrSec > 0) esemenyek.push({ t: l.arrSec, c, jel: cel ? '🏁' : '⏱️',
                    szoveg: cel ? 'célba ért' : `beérkezett a(z) ${i + 1}. körből`, extra: l.loopSpd ? kmh(l.loopSpd) + ' km/h' : '' });
                if (l.vetSec > 0) {
                    const kiesettItt = c.isEliminated && i === utolsoVet;
                    esemenyek.push({ t: l.vetSec, c, jel: kiesettItt ? '❌' : '🩺', rossz: kiesettItt,
                        szoveg: kiesettItt ? getElimText(c) : `${i + 1}. vizsgálat: megfelelt`, extra: '' });
                }
            });
        });
        // A még nem esedékes (jövőbeli) időket kihagyjuk; éjfél körül a nagy különbség a tegnapi.
        const kor = t => { let x = most - t; if (x < -43200) x += 86400; if (x > 43200) x -= 86400; return x; };
        const friss = esemenyek.filter(e => kor(e.t) >= -60).sort((a, b) => kor(a.t) - kor(b.t)).slice(0, 8);
        if (friss.length) {
            html += `<section class="uj-szekcio"><div class="uj-szekcio-fej"><h3>Legutóbbi események</h3></div>
                <ol class="uj-lista uj-esemenyek">${friss.map(e => `<li class="${e.rossz ? 'rossz' : ''}"><span class="uj-esemeny-ido">${toTimeStr(e.t).slice(0, 5)}</span><span class="uj-nev">${e.jel} ${nevLink(e.c)}<small>${escapeHtml(e.szoveg)}${e.extra ? ' · ' + escapeHtml(e.extra) : ''} · ${escapeHtml(catNames[e.c.dist] || e.c.dist)}</small></span></li>`).join('')}</ol></section>`;
        }
        return html;
    }

    function ujDizajnInditas() {
        ujEmojiTisztit(document.body);
        new MutationObserver(valtozasok => valtozasok.forEach(v => v.addedNodes.forEach(n => { if (n.nodeType === 1) ujEmojiTisztit(n); })))
            .observe(document.body, { childList: true, subtree: true });
        document.addEventListener('click', e => { if (!e.target.closest('.uj-nav-csoport')) ujNavLenyiloBezar(); });
        ujNavFrissit();
    }

    // ============================================================================
    // ÚJ VERZIÓ ÉSZLELÉSE: ha közben új verzió került fel, a nyitva hagyott (vagy a böngésző
    // gyorsítótárából betöltött) oldal ne ragadjon a régin. Az index.html <meta name="app-verzio">
    // számát hasonlítjuk az épp futó változatéhoz - megnyitáskor, félóránként és amikor a fül újra
    // előtérbe kerül (ez csak egy kis lekérés, az oldalhoz nem nyúl). Újratöltés csak valódi új
    // verziónál lehet, és:
    //  - bejelentkezett stábnál (orvos, beérkeztető, bíró, admin) SOHA nem magától - csak egy sáv
    //    szól "Frissítés" / "Később" gombbal, és ők döntik el, mikor (pl. két ló között);
    //  - nézőknél magától, de csak ha épp nem gépelnek / nincs nyitott ablak;
    //  - nyitott TV módban (kivetítő) egyáltalán nem - az újratöltés kidobná a teljes képernyőből.
    // A "Később" után fél óráig nem szólunk újra (fülváltáskor sem).
    // A fájlcímekben lévő ?v= miatt az új oldal biztosan az új rps.js / rps.css fájlokat kapja.
    // ============================================================================
    const APP_VERZIO = (document.querySelector('meta[name="app-verzio"]') || {}).content || '';
    const VERZIO_PROBALVA = 'rps-verzio-probalva';
    const VERZIO_KESOBB = 'rps-verzio-kesobb';
    const VERZIO_PERIODUS = 30 * 60 * 1000;

    function vanMentetlenMunka() {
        if (Object.values(formDirty).some(Boolean)) return true;
        const nyitottAblak = [...document.querySelectorAll('.modal, #customConfirm')].some(m => m.style.display === 'flex' || m.style.display === 'block');
        const fokuszMezo = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
        return nyitottAblak || fokuszMezo;
    }

    function ujVerzioBetoltes(uj) {
        try { sessionStorage.setItem(VERZIO_PROBALVA, uj); } catch (e) {}
        const url = new URL(location.href);
        url.searchParams.set('v', uj);   // új cím -> a böngésző nem a gyorsítótárból adja az oldalt
        location.replace(url.toString());
    }

    function ujVerzioSav(uj) {
        if (document.getElementById('uj-verzio-sav')) return;
        const sav = document.createElement('div');
        sav.id = 'uj-verzio-sav';
        sav.innerHTML = `<span>Új verzió érhető el. Frissíts, amikor épp nincs folyamatban munka (mentsd el, amit írsz).</span>
            <button type="button" onclick="ujVerzioBetoltes('${String(uj).replace(/[^\w.-]/g, '')}')">Frissítés</button>
            <button type="button" class="kesobb" onclick="ujVerzioKesobb(this)">Később</button>`;
        document.body.appendChild(sav);
    }

    function ujVerzioKesobb(gomb) {
        try { sessionStorage.setItem(VERZIO_KESOBB, String(Date.now())); } catch (e) {}
        gomb.parentElement.remove();
    }

    function verzioEllenorzes() {
        if (!APP_VERZIO || document.hidden) return;
        if (document.getElementById('fullscreenLiveOverlay')?.classList.contains('active')) return;
        let kesobb = 0;
        try { kesobb = Number(sessionStorage.getItem(VERZIO_KESOBB)) || 0; } catch (e) {}
        if (Date.now() - kesobb < VERZIO_PERIODUS) return;
        fetch('index.html?verzio=' + Date.now(), { cache: 'no-store' })
            .then(r => (r.ok ? r.text() : ''))
            .then(html => {
                const m = html.match(/<meta name="app-verzio" content="([^"]+)"/);
                if (!m || m[1] === APP_VERZIO) return;
                let probalva = null;
                try { probalva = sessionStorage.getItem(VERZIO_PROBALVA); } catch (e) {}
                // Ha erre a verzióra már újratöltöttünk, és mégis a régi jött (pl. a szerver még nem
                // frissült), ne legyen végtelen újratöltés - elég a sáv.
                // Bejelentkezett stábnál soha nem töltünk újra magától (verseny közben ne szakadjon meg a munka).
                const stab = !!(auth && auth.currentUser);
                if (stab || probalva === m[1] || vanMentetlenMunka()) { ujVerzioSav(m[1]); return; }
                ujVerzioBetoltes(m[1]);
            })
            .catch(() => {});
    }

    function verzioFigyelesInditas() {
        const jel = document.getElementById('app-verzio-szam');
        if (jel) jel.textContent = APP_VERZIO ? 'v' + APP_VERZIO : 'helyi';
        if (!APP_VERZIO) return;
        setTimeout(verzioEllenorzes, 4000);
        setInterval(verzioEllenorzes, VERZIO_PERIODUS);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) verzioEllenorzes(); });
    }

    window.onload = function() {
        verzioFigyelesInditas();
        ujDizajnInditas();
        let savedMode = localStorage.getItem('currentMode') || 'kezdolap';
        if (savedMode === 'terv') savedMode = 'versenyek';
        try { currentAdatlapFilter = sessionStorage.getItem('rps-adatlap-kat') || null; } catch (e) {}
        switchSidebarMode(savedMode, document.getElementById('btn-menu-' + savedMode) || document.getElementById('btn-menu-' + savedMode.replace(/-mod$/, '')));

        // A versenylistákat egyébként csak a Firebase-figyelők rajzolják, azok viszont már
        // adattal futnak le - enélkül a töltés alatt üres lenne a képernyő a csontváz helyett.
        renderLocalRaces();

        initAutocompleteFields('');      // élő nevezési form
        initAutocompleteFields('rm');    // múltbéli/jövőbeli verseny szerkesztő modal
        initAutocompleteFields('rm-gy'); // IDEIGLENES: "Gyors eredmény" fül

        // Bajnoki pontszámítás: csapattag / külföldi eredmény javaslatlisták
        attachAutocomplete('team-member-search', searchRiders, (item) => {
            addTeamMember(item);
            document.getElementById('team-member-search').value = '';
        });
        attachAutocomplete('ext-rider-search', searchRiders, (item) => {
            document.getElementById('ext-rider-search').value = `${item.name} — ${item.license}`;
            document.getElementById('ext-license').value = item.license;
        });
        attachAutocomplete('ext-horse-search', searchHorses, (item) => {
            document.getElementById('ext-horse-search').value = `${item.name} — ${item.startNum}`;
            document.getElementById('ext-horseStartNum').value = item.startNum;
            // A ló neve a rekordba is bekerül, hogy a profil/lista ne csak a start számot mutassa.
            document.getElementById('ext-horseName').value = item.name || '';
        });
    };