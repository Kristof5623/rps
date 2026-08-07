
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
    let liveVets = [];
    // speedThresholds[dist] = { min, max } km/h, mindkettő opcionális (üres = nincs figyelve az a határ).
    // min: ez alatt időtúllépés (OT) kockázat. max: efölött sebesség miatti kiesés (SP) kockázat, 139. § (2).
    let speedThresholds = {};
    let ridersCache = {}; // riders/{license} - lo-lovas-integracio.md
    let horsesCache = {}; // horses/{startNum}
    let clubsCache = {}; // clubs/{clubKey} - önálló egyesület-törzs
    let uiTheme = 'default'; // admin választja (settings/uiTheme), mindenkinek szinkronban - l. THEME_LIST
    // colors: [primary (dot), bg, card] - a swatch előnézet ebből épül fel (renderThemeSwatches)
    const THEME_LIST = [
        { key: 'default',  label: '☀️ Alap',      colors: ['#0A84FF', '#000000', '#1c1c1e'] },
        { key: 'alt',      label: '🌅 Alkony',     colors: ['#FF7A45', '#150a08', '#241209'] },
        { key: 'forest',   label: '🌲 Fenyves',    colors: ['#28C97A', '#060f0a', '#0f2318'] },
        { key: 'violet',   label: '💜 Ametiszt',   colors: ['#A66EF0', '#0f0a1a', '#1f1530'] },
        { key: 'graphite', label: '⚙️ Acél',       colors: ['#5CA9E8', '#0a0d10', '#161b21'] },
        { key: 'wine',     label: '🍷 Rubin',      colors: ['#E0475C', '#130709', '#26121A'] },
        { key: 'ocean',    label: '🌊 Óceán',      colors: ['#22C9D6', '#04121a', '#0c2430'] },
        { key: 'gold',     label: '✨ Éjarany',    colors: ['#E8B33D', '#0a0906', '#1c170e'] },
        { key: 'daylight', label: '🌤️ Verőfény',  colors: ['#0A6FE8', '#eef4fb', '#ffffff'] },
        { key: 'wheat',    label: '🌾 Búzamező',   colors: ['#A8631A', '#faf3e6', '#fffdfa'] },
        { key: 'mint',     label: '🌿 Menta',      colors: ['#159873', '#eef7f3', '#ffffff'] },
    ];

    function applyThemeColorMeta(key) {
        const t = THEME_LIST.find(x => x.key === key) || THEME_LIST[0];
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', t.colors[1]);
    }

    // Villanás-mentes indulás: amíg a Firebase beállítás betöltődik, a legutóbb ismert témát használjuk
    document.documentElement.setAttribute('data-theme', localStorage.getItem('uiTheme') || 'default');
    applyThemeColorMeta(localStorage.getItem('uiTheme') || 'default');
    
    let viewingPastRaceData = null; 
    let pastAdatlapFilter = null; 
    
    // FŐ ÉLŐ VERSENY ADATOK
    let liveRaceMeta = null;
    let competitors = [];
    let editingBib = null;
    let raceConfig = getEmptyRaceConfig();

    // LOKÁLIS VERSENYLISTÁK A FIREBASE-BŐL
    let localRaces = { mult: [], jovo: [] };

    // MODAL VERSENY ADATOK
    let modalRaceId = null;
    let modalRaceConfig = getEmptyRaceConfig();
    let modalCompetitors = [];
    let modalEditingBib = null;
    // let modalGyorsEditingBib = null; // IDEIGLENES "Gyors eredmény" fül szerkesztési állapota - kikapcsolva, l. lentebb

    const catNames = {
        "100": "100 km", "100j": "100 km Junior",
        "80":  "80 km", "80j": "80 km Junior",
        "60":  "60 km", "40":  "40 km", "20":  "20 km"
    };

    function getEmptyRaceConfig() {
        return {
            "100": { h:'', m:'', s:'', laps: ['', '', '', ''] },
            "80":  { h:'', m:'', s:'', laps: ['', '', ''] },
            "60":  { h:'', m:'', s:'', laps: ['', '', ''] },
            "40":  { h:'', m:'', s:'', laps: ['', ''] },
            "20":  { h:'', m:'', s:'', laps: [''] }
        };
    }

    function parseCompetitors(data) {
        if (!data) return [];
        return Object.values(data).filter(c => c && c.bib !== undefined);
    }

    // --- LÓ- ÉS LOVAS-TÖRZSADAT (docs/lo-lovas-integracio.md, P1/2) ---
    function sanitizeKey(s) {
        return String(s).trim().replace(/[.#$\[\]]/g, '_');
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
        showConfirm("Verseny Élesítése", "Biztosan ÉLŐ-be teszed ezt a versenyt?\n(A jelenlegi élő futam automatikusan lezárul és átkerül a múltba!)", () => {
            // Célzott olvasások a "/" gyökér helyett - lásd forceMoveRace megjegyzését.
            Promise.all([
                db.ref('liveRaceMeta').once('value'),
                db.ref('raceConfig').once('value'),
                db.ref('competitors').once('value'),
                db.ref('races/' + sourceType + '/' + id).once('value')
            ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap, sourceSnap]) => {
                let updates = {};
                let curLiveMeta = liveMetaSnap.val();
                let curRaceConfig = raceConfigSnap.val();
                let curCompetitors = competitorsSnap.val();

                if (curLiveMeta) {
                    let oldId = curLiveMeta.id || Date.now().toString();
                    updates['races/mult/' + oldId] = {
                        id: oldId, name: curLiveMeta.name, loc: curLiveMeta.loc, date: curLiveMeta.date, desc: curLiveMeta.desc || "",
                        isObRound: curLiveMeta.isObRound || false,
                        raceConfig: curRaceConfig || getEmptyRaceConfig(),
                        competitors: curCompetitors || null
                    };
                }

                let sourceRace = sourceSnap.val();
                if (sourceRace) {
                    updates['liveRaceMeta'] = { id: sourceRace.id, name: sourceRace.name, loc: sourceRace.loc, date: sourceRace.date, desc: sourceRace.desc || "", isObRound: sourceRace.isObRound || false };
                    updates['raceConfig'] = sourceRace.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = sourceRace.competitors || null;
                    updates['races/' + sourceType + '/' + id] = null;
                }

                db.ref('/').update(updates).then(() => {
                    showToast("🚀 Verseny sikeresen ÉLŐ-be mozgatva!");
                    switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'));
                }).catch(e => showToast("Hiba a mozgatáskor: " + e.message, true));
            }).catch(e => showToast("Hiba a mozgatáskor: " + e.message, true));
        });
    }

    function forceMoveToPastFromLive() {
        showConfirm("Verseny Lezárása", "Biztosan a Múltbéli versenyek közé rakod a jelenlegi ÉLŐ versenyt?", () => {
            // Célzott olvasások a "/" gyökér helyett - lásd forceMoveRace megjegyzését.
            Promise.all([
                db.ref('liveRaceMeta').once('value'),
                db.ref('raceConfig').once('value'),
                db.ref('competitors').once('value')
            ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap]) => {
                let curLiveMeta = liveMetaSnap.val();
                if (!curLiveMeta) return;

                let oldId = curLiveMeta.id || Date.now().toString();
                let updates = {};

                updates['races/mult/' + oldId] = {
                    id: oldId, name: curLiveMeta.name, loc: curLiveMeta.loc, date: curLiveMeta.date, desc: curLiveMeta.desc || "",
                    isObRound: curLiveMeta.isObRound || false,
                    raceConfig: raceConfigSnap.val() || getEmptyRaceConfig(),
                    competitors: competitorsSnap.val() || null
                };

                updates['liveRaceMeta'] = null;
                updates['raceConfig'] = getEmptyRaceConfig();
                updates['competitors'] = null;

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
            db.ref('races/jovo').once('value')
        ]).then(([liveMetaSnap, raceConfigSnap, competitorsSnap, jovoSnap]) => {
            let curRaceConfig = raceConfigSnap.val();
            let curCompetitors = competitorsSnap.val();

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
                    isObRound: meta.isObRound || false,
                    raceConfig: curRaceConfig || getEmptyRaceConfig(),
                    competitors: curCompetitors || {}
                };
                updates['raceConfig'] = getEmptyRaceConfig();
                updates['competitors'] = {};
                updates['liveRaceMeta'] = null;
                meta = null;
                needsUpdate = true;
            }

            if (!meta) {
                let toMoveId = Object.keys(jovo).find(key => jovo[key].date === today);
                if (toMoveId) {
                    let r = jovo[toMoveId];
                    updates['liveRaceMeta'] = { id: r.id, name: r.name, loc: r.loc, date: r.date, desc: r.desc || "", isObRound: r.isObRound || false };
                    updates['raceConfig'] = r.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = r.competitors || {};
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
            renderLocalRaces();
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
            renderLocalRaces();
            
            if (document.getElementById('export-mod').classList.contains('active')) {
                renderExportList();
            }
            
            if (viewingPastRaceData && document.getElementById('past-race-view').classList.contains('active')) {
                const updatedRace = localRaces.mult.find(x => x.id === viewingPastRaceData.id);
                if(updatedRace) { viewingPastRaceData = updatedRace; renderPastAdatlapList(); }
            }

            refreshOpenBajnoksagViews();
        });

        db.ref('raceConfig').on('value', (snapshot) => {
            raceConfig = mergeRaceConfig(snapshot.val());
            renderKiiras();
            if (!viewingPastRaceData && document.getElementById('adatlapok').classList.contains('active') && currentAdatlapFilter) { renderAdatlapList(); }
        });

        db.ref('competitors').on('value', (snapshot) => {
            competitors = parseCompetitors(snapshot.val());
            updateCompetitorDisplays();
            
            if(!viewingPastRaceData && document.getElementById('adatlapok').classList.contains('active') && currentAdatlapFilter) { renderAdatlapList(); }
            
            if(document.getElementById('fo-mod').classList.contains('active') && document.getElementById('verseny').style.display === 'block') {
                const selectedBib = document.getElementById('selectCompetitor').value;
                const activeEl = document.activeElement;
                const formContainsFocus = activeEl && document.getElementById('verseny').contains(activeEl);
                if (selectedBib && !formContainsFocus) { loadCompetitorData(); }
            }
            if(document.getElementById('beerkeztetes-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-beerkeztetes').value;
                const activeEl = document.activeElement;
                const formContainsFocus = activeEl && document.getElementById('beerkeztetes-form').contains(activeEl);
                if (selectedBib && !formContainsFocus) { loadBeerkeztetesData(); }
            }
            if(document.getElementById('orvosi-ido-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-orvosi-ido').value;
                const activeEl = document.activeElement;
                const formContainsFocus = activeEl && document.getElementById('orvosi-ido-form').contains(activeEl);
                if (selectedBib && !formContainsFocus) { loadOrvosiIdoData(); }
            }
            if(document.getElementById('orvosi-mod').classList.contains('active')) {
                const selectedBib = document.getElementById('sel-orvosi').value;
                const activeEl = document.activeElement;
                const formContainsFocus = activeEl && document.getElementById('orvosi-form').contains(activeEl);
                if (selectedBib && !formContainsFocus) { loadOrvosiData(); }
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
        });
        db.ref('horses').on('value', snap => {
            horsesCache = snap.val() || {};
            if (document.getElementById('torzs-lovak')?.classList.contains('active')) renderTorzsLovakList();
        });
        db.ref('clubs').on('value', snap => { clubsCache = snap.val() || {}; });

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
            uiTheme = snap.val() || 'default';
            localStorage.setItem('uiTheme', uiTheme);
            document.documentElement.setAttribute('data-theme', uiTheme);
            applyThemeColorMeta(uiTheme);
            renderThemeSwatches();
        });

        // Bajnoki pontszámítás törzsadatai (bajnoki-pontszamitas.md)
        db.ref('teams').on('value', snap => { teamsCache = snap.val() || {}; refreshOpenBajnoksagViews(); });
        db.ref('externalResults').on('value', snap => { externalResultsCache = snap.val() || {}; refreshOpenBajnoksagViews(); });
        db.ref('settings/bajnokavatasDatum').on('value', snap => { bajnokavatasDatumCache = snap.val() || {}; refreshOpenBajnoksagViews(); });
    }

    // Csak azt a bajnoksági nézetet frissíti, ami épp aktív - a többi majd megnyitáskor újraszámol.
    function refreshOpenBajnoksagViews() {
        if (document.getElementById('bajnoksag-egyeni')?.classList.contains('active')) renderEgyeniBajnoksag();
        if (document.getElementById('bajnoksag-lo')?.classList.contains('active')) renderLoRanglista();
        if (document.getElementById('bajnoksag-csapat')?.classList.contains('active')) {
            if (document.getElementById('csapat-rang')?.style.display !== 'none') renderCsapatRanglista();
            if (document.getElementById('csapat-kezel')?.style.display === 'block') renderTeamList();
            if (document.getElementById('csapat-kulf')?.style.display === 'block') renderExternalResultsList();
            if (document.getElementById('csapat-datum')?.style.display === 'block') renderBajnokavatasDatumSettings();
        }
    }

    startDatabaseListeners();

    // --- AUTENTIKÁCIÓ ÉS JOGOSULTSÁGOK ---
    auth.onAuthStateChanged((user) => {
        if (user) {
            db.ref('users/' + user.uid + '/role').once('value').then((snapshot) => {
                const role = snapshot.val() || 'guest';
                applyAuthUI(true, role);
                if(role === 'admin') runAutoMigration();
            }).catch(e => {
                applyAuthUI(true, 'guest');
            });
        } else {
            applyAuthUI(false, null);
        }
    });

    function applyAuthUI(isLoggedIn, role) {
        document.body.classList.remove('role-admin', 'role-doctor', 'role-checkin', 'role-judge', 'role-printer');
        
        if (isLoggedIn) {
            document.body.classList.add('role-' + role);
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('logout-section').style.display = 'flex';
            
            let roleNameHu = role;
            if(role === 'judge') roleNameHu = "Bíró";
            if(role === 'checkin') roleNameHu = "Beérkeztető";
            if(role === 'doctor') roleNameHu = "Állatorvos";
            if(role === 'printer') roleNameHu = "Nyomtató";
            document.getElementById('logged-in-role-text').innerText = "✅ " + roleNameHu.toUpperCase() + " mód";
            
            // --- GOMBOK LÁTHATÓSÁGÁNAK KÉZI FELÜLÍRÁSA A SZEREPKÖRÖK SZERINT ---
            let btnBk = document.getElementById('btn-menu-beerkeztetes');
            let btnOrvIdo = document.getElementById('btn-menu-orvosi-ido');
            let btnOrv = document.getElementById('btn-menu-orvosi');
            let btnNyom = document.getElementById('btn-menu-nyomtatas');

            // Alaphelyzet: Hagyjuk a CSS-t dolgozni (Pl. az Admin mindent lát)
            if(btnBk) btnBk.style.display = '';
            if(btnOrvIdo) btnOrvIdo.style.display = '';
            if(btnOrv) btnOrv.style.display = '';
            if(btnNyom) btnNyom.style.display = '';

            // 1. BEÉRKEZTETŐ JOGOSULTSÁG
            if (role === 'checkin') {
                if(btnBk) btnBk.style.setProperty('display', 'flex', 'important');
                if(btnOrvIdo) btnOrvIdo.style.setProperty('display', 'flex', 'important');
                if(btnOrv) btnOrv.style.setProperty('display', 'none', 'important');
                if(btnNyom) btnNyom.style.setProperty('display', 'none', 'important');
                switchSidebarMode('beerkeztetes-mod', btnBk);
            } 
            // 2. ÁLLATORVOS JOGOSULTSÁG
            else if (role === 'doctor') {
                if(btnBk) btnBk.style.setProperty('display', 'flex', 'important');
                if(btnOrvIdo) btnOrvIdo.style.setProperty('display', 'flex', 'important');
                if(btnOrv) btnOrv.style.setProperty('display', 'flex', 'important');
                if(btnNyom) btnNyom.style.setProperty('display', 'flex', 'important');
                switchSidebarMode('orvosi-mod', btnOrv);
            }
            // 3. NYOMTATÓ JOGOSULTSÁG
            else if (role === 'printer') {
                if(btnBk) btnBk.style.setProperty('display', 'none', 'important');
                if(btnOrvIdo) btnOrvIdo.style.setProperty('display', 'none', 'important');
                if(btnOrv) btnOrv.style.setProperty('display', 'none', 'important');
                if(btnNyom) btnNyom.style.setProperty('display', 'flex', 'important');
                switchSidebarMode('nyomtatas-mod', btnNyom);
            }

            if(role === 'judge') { switchSubMode('verseny', document.getElementById('btn-verseny')); }
            
        } else {
            document.getElementById('login-section').style.display = 'block';
            document.getElementById('logout-section').style.display = 'none';
        }
    }

    function doLogin() {
        const u = document.getElementById('loginUser').value.trim();
        const p = document.getElementById('loginPass').value;
        const err = document.getElementById('loginError');
        const fullEmail = u + "@verseny.hu";

        auth.signInWithEmailAndPassword(fullEmail, p)
            .then(() => {
                err.style.display = 'none';
                document.getElementById('loginPass').value = '';
                switchMainTab('versenyek', document.getElementById('btn-menu-versenyek'));
            })
            .catch(() => {
                err.style.display = 'block';
                setTimeout(() => { err.style.display = 'none'; }, 3000);
                document.getElementById('loginPass').value = '';
            });
    }

    function doLogout() {
        auth.signOut().then(() => {
            document.getElementById('loginUser').value = '';
            switchSidebarMode('versenyek', document.getElementById('btn-menu-versenyek'));
        });
    }

    function toggleMenu() {
        document.getElementById('sidebar').classList.toggle('open');
        document.querySelector('.overlay').classList.toggle('open');
    }

    function switchSidebarMode(targetId, btn) {
        if(btn && btn.id === 'btn-menu-adatlapok') { viewingPastRaceData = null; }
        document.querySelectorAll('.mode-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.sidebar-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
        if(btn) btn.classList.add('active');
        localStorage.setItem('currentMode', targetId); 
        if(window.innerWidth <= 800) { document.getElementById('sidebar').classList.remove('open'); document.querySelector('.overlay').classList.remove('open'); }
        
        if (targetId === 'adatlapok') renderAdatlapList();
        if (targetId === 'export-mod') renderExportList();
        if (targetId === 'torzs-lovasok') renderTorzsLovasokList();
        if (targetId === 'torzs-lovak') renderTorzsLovakList();
        if (targetId === 'bajnoksag-egyeni') renderEgyeniBajnoksag();
        if (targetId === 'bajnoksag-lo') renderLoRanglista();
        if (targetId === 'bajnoksag-csapat') switchCsapatTab('csapat-rang', document.querySelector('#bajnoksag-csapat .tabs .tab-btn'));
    }

    function switchMainTab(targetId, btn) { switchSidebarMode(targetId, btn || document.getElementById('btn-menu-fomod')); }

    function switchSubMode(mode, btn) {
        document.querySelectorAll('.sub-mode-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('#fo-mod .tab-btn').forEach(el => el.classList.remove('active'));
        document.getElementById(mode).style.display = 'block';
        btn.classList.add('active');

        if (mode === 'verseny') {
            const selectedBib = document.getElementById('selectCompetitor').value;
            const activeEl = document.activeElement;
            const formCont = document.getElementById('verseny-form-container');
            const formContainsFocus = activeEl && formCont && formCont.contains(activeEl);
            if (selectedBib && !formContainsFocus) {
                loadCompetitorData();
            }
        }
    }

    function refreshVersenyTabIfNeeded(bib) {
        const versenyTab = document.getElementById('verseny');
        if (!versenyTab || versenyTab.style.display !== 'block') return;
        const selectedBib = document.getElementById('selectCompetitor').value;
        if (!selectedBib || selectedBib !== bib) return;
        const activeEl = document.activeElement;
        const formCont = document.getElementById('verseny-form-container');
        const formContainsFocus = activeEl && formCont && formCont.contains(activeEl);
        if (!formContainsFocus) {
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
        let html = `<strong>Kategória rajtja:</strong><br><span style="font-size:1.5rem; color:white; font-family:monospace;">${toTimeStr(toSec(catConf.h, catConf.m, catConf.s))}</span><br><br><strong>Körök távolságai:</strong><br><div style="display:inline-block; text-align:left; margin-top:5px;">`;
        if(catConf.laps && catConf.laps.length > 0) {
            catConf.laps.forEach((l, i) => { html += `<b>${i+1}. kör:</b> &nbsp;&nbsp;${l || '0'} km<br>`; });
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
        let html = `<strong>Dátum:</strong> <span style="color:white;">${r.date}</span><br><strong>Helyszín:</strong> <span style="color:white;">${r.loc}</span><br><br><strong>Leírás:</strong><br><span style="color:white;">${r.desc || 'Nincs leírás megadva.'}</span><br><br><strong>Kategóriák és Rajtidők:</strong><br><div style="text-align:left; display:inline-block; margin-top:5px;">`;
        
        const cfg = mergeRaceConfig(r.raceConfig);
        let hasCats = false;
        ["100", "80", "60", "40", "20"].forEach(d => {
            if(cfg[d] && cfg[d].h !== "") {
                html += `• ${catNames[d]}: <b style="color:white;">${toTimeStr(toSec(cfg[d].h, cfg[d].m, cfg[d].s))}</b> <small>(${(cfg[d].laps||[]).length} kör)</small><br>`;
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
            <div class="race-card" style="border-left-color: #217346; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div class="race-card-title">${r.name}</div>
                    <div class="race-card-date">${r.date} | Helyszín: ${r.loc}</div>
                </div>
                <button class="calc-btn" style="background:#217346; color:white; width:auto; padding:10px 15px; font-size:0.9rem; margin-top:0;" onclick="exportSpecificRaceToCSV('${r.id}')">📥 Letöltés Excelbe</button>
            </div>`;
        });
    }

    function exportSpecificRaceToCSV(id) {
        const race = localRaces.mult.find(x => x.id === id);
        if(!race) { showToast("A verseny nem található!", true); return; }
        
        let comps = parseCompetitors(race.competitors);
        let config = mergeRaceConfig(race.raceConfig);
        
        if(!comps || comps.length === 0) { showToast("Nincs exportálható adat ebben a versenyben!", true); return; }

        let activeCats = getActiveCategories(comps, config);
        let ranksInfo = calculateCurrentRanks(comps, config);
        let raceName = race.name || "Eredmenyek";
        
        let html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel">
        <head><meta charset="utf-8"></head><body>`;

        activeCats.forEach((cat, index) => {
            let catNameStr = catNames[cat] || (cat+" km"); 

            html += `<table border="1" style="border-collapse: collapse; font-family: Calibri, sans-serif;">`;
            html += `<tr><td colspan="13" style="font-size: 14pt;"><b>${raceName}</b></td></tr>`;
            html += `<tr><td colspan="13" style="font-size: 12pt;"><b>${index + 1}.vrsz.-${catNameStr}-es verseny</b></td></tr>`;
            html += `<tr><td colspan="13"></td></tr>`;
            html += `<tr><td colspan="13">www.tavlovasok.hu</td></tr>`;
            html += `<tr><td colspan="13">Elbírálás: Távlovaglás</td></tr>`;
            html += `<tr><td colspan="13"></td></tr>`;
            html += `<tr><td colspan="13"></td></tr>`;

            // LILA HÁTTERES, VASTAG FEJLÉCEK (Rajtszám az első!)
            html += `<tr>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Rajtszám</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Igazolási szám</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Versenyző</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Ló Startszám</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Ló</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Egyesület</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Kategória</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Hely</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Végeredmény (Idő)</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Büntetőpont</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Megj. (Kiesés)</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Sárgalap</th>
                <th style="background-color:#D9D2E9; border:1px solid #000;">Pihenőnap</th>
            </tr>`;

            let catComps = comps.filter(c => c.dist === cat);
            
            catComps.sort((a,b) => {
                if (a.isEliminated && !b.isEliminated) return 1;
                if (!a.isEliminated && b.isEliminated) return -1;
                if (!a.isEliminated && !b.isEliminated) { return (ranksInfo[a.bib]?.rank || 999) - (ranksInfo[b.bib]?.rank || 999); }
                return parseInt(a.bib) - parseInt(b.bib);
            });
            
            catComps.forEach(c => {
                let rInfo = ranksInfo[c.bib] || { rank: "-" };
                let rankStr = rInfo.rank;
                let isKiesett = c.isEliminated || rankStr === "Kiesett";
                
                let totalTimeStr = "-";
                let megjStr = ""; 
                
                let completedLaps = (c.laps || []).filter(l => l.isComplete);
                if (completedLaps.length > 0 && !isKiesett) {
                    let lastLap = completedLaps[completedLaps.length - 1];
                    if ((c.dist === "20" || c.dist === "20j") && lastLap.vetSec > 0) {
                        totalTimeStr = toTimeStr(lastLap.loopSec + lastLap.pulzusSec);
                    } else {
                        let s = lastLap.rideTime;
                        const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sc = s % 60;
                        totalTimeStr = String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0') + ":" + String(sc).padStart(2, '0');
                    }
                    megjStr = "0";
                } else if (isKiesett) {
                    totalTimeStr = getElimText(c);
                    let lastLap = c.laps && c.laps.length > 0 ? c.laps.slice().reverse().find(l => l.vetNotes) : null;
                    
                    // ÚJ EXPORT LOGIKA: Közvetlenül a kód kiírása (FTQ- előtag eltávolításával)
                    if (c.status && c.status.startsWith('FTQ-')) {
                        megjStr = c.status.replace('FTQ-', ''); // Pl. "FTQ-GA" -> "GA"
                    } else if (['WD', 'RET', 'DSQ', 'FNR'].includes(c.status)) {
                        megjStr = c.status;
                    } else if (c.status === "Visszalépett" || c.status === "Retired" || c.status === "DNS") {
                        megjStr = "WD";
                    } else {
                        megjStr = "ELIM";
                    }

                    // Ha a doki beírt valami extra megjegyzést, hozzáfűzzük a kód mellé
                    if (lastLap && lastLap.vetNotes) {
                        megjStr += " (" + lastLap.vetNotes + ")";
                    }
                }

                let kategoria = "Nyitott";
                if (cat.includes('j')) { kategoria = "Junior"; }
                else if (parseInt(cat) >= 80) { kategoria = "Felnőtt"; }

                html += `<tr>
                    <td style="font-weight:bold; border:1px solid #000; text-align:center;">${c.bib}</td>
                    <td style="border:1px solid #000; text-align:center;">${c.license || ''}</td>
                    <td style="border:1px solid #000;">${c.name}</td>
                    <td style="border:1px solid #000; text-align:center;">${c.startNum || ''}</td>
                    <td style="border:1px solid #000;">${c.internal || ''}</td>
                    <td style="border:1px solid #000;">${c.club || ''}</td>
                    <td style="border:1px solid #000; text-align:center;">${kategoria}</td>
                    <td style="border:1px solid #000; text-align:center;">${isKiesett ? '-' : rankStr}</td>
                    <td style="font-weight:bold; border:1px solid #000; text-align:center;">${totalTimeStr}</td>
                    <td style="border:1px solid #000; text-align:center;">0</td>
                    <td style="border:1px solid #000; text-align:center;">${megjStr}</td>
                    <td style="border:1px solid #000;"></td>
                    <td style="border:1px solid #000; text-align:center;">12</td>
                </tr>`;
            });
            
            html += `<tr><td colspan="13"></td></tr>`;
            html += `</table><br><br>`;
        });

        html += `</body></html>`;

        let blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel' });
        let url = URL.createObjectURL(blob);
        let a = document.createElement('a');
        a.href = url;
        a.download = raceName.replace(/ /g, '_') + '_Hivatalos_Eredmenyek.xls';
        a.click();
        showToast("Eredmények sikeresen exportálva!");
    }

    // --- LISTÁK (Múlt / Jövő / Jelenlegi) ---
    function obBadge(r) {
        return r && r.isObRound ? `<span style="background:var(--primary-dim); color:var(--primary); font-size:0.7rem; font-weight:800; padding:3px 9px; border-radius:20px; margin-left:8px; vertical-align:middle;">🏆 OB-FORDULÓ</span>` : '';
    }

    function renderLocalRaces() {
        const multCont = document.getElementById('v-mult-list');
        const jovoCont = document.getElementById('v-jovo-list');
        const jelenCont = document.getElementById('v-jelen-list');
        if(!multCont || !jovoCont || !jelenCont) return;

        multCont.innerHTML = localRaces.mult.length > 0 ? '' : '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Nincs múltbéli verseny rögzítve.</div>';
        jovoCont.innerHTML = localRaces.jovo.length > 0 ? '' : '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Nincs jövőbeli verseny rögzítve.</div>';

        if(liveRaceMeta) {
            jelenCont.innerHTML = `
            <div class="race-card" style="border-left-color: var(--success); background:#202820;">
                <div class="race-card-title">${liveRaceMeta.name} <span style="color:var(--success); font-size:0.8rem;">(ÉLŐ FUTAM)</span>${obBadge(liveRaceMeta)}</div>
                <div class="race-card-date">${liveRaceMeta.date} | Helyszín: ${liveRaceMeta.loc}</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                    <button class="calc-btn admin-only" style="padding:10px; margin-top:0; font-size:0.9rem;" onclick="switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'))">Ugrás az ÉLŐ Kezelőhöz</button>
                    <button class="calc-btn admin-only" style="padding:10px; margin-top:0; font-size:0.9rem; background:var(--danger); color:white;" onclick="forceMoveToPastFromLive()">🛑 Lezárás (Múltbélivé tétel)</button>
                </div>
            </div>`;
        } else {
            jelenCont.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Nincs futó automatikus verseny.</div>';
        }

        localRaces.mult.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach(r => {
            multCont.innerHTML += `
            <div class="race-card" style="border-left-color: #666;">
                <div class="race-card-title">${r.name}${obBadge(r)}</div>
                <div class="race-card-date">${r.date} | Helyszín: ${r.loc}</div>
                <button class="calc-btn" style="padding:10px; margin-top:10px; background: #444; color: white;" onclick="openPublicPastRace('${r.id}')">📊 Eredmények megtekintése</button>
                <div class="race-admin-controls admin-only" style="margin-top:10px; border-top:1px dashed #444; padding-top:10px;">
                    <button class="edit-btn" onclick="openRaceModal('mult', '${r.id}')">Szerkesztés</button>
                    <button class="edit-btn" style="background:var(--teal); color:white;" onclick="forceMoveRace('mult', 'jovo', '${r.id}')">⏪ Vissza Jövőbelibe</button>
                    <button class="edit-btn" style="background:var(--success); color:black;" onclick="forceMoveToLive('mult', '${r.id}')">▶️ Újra ÉLŐ-be</button>
                    <button class="edit-btn" style="background:var(--danger);" onclick="deleteRace('mult', '${r.id}')">Törlés</button>
                </div>
            </div>`;
        });

        localRaces.jovo.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(r => {
            jovoCont.innerHTML += `
            <div class="race-card" style="border-left-color: var(--warning);">
                <div class="race-card-title">${r.name}${obBadge(r)}</div>
                <div class="race-card-date">${r.date} | Helyszín: ${r.loc}</div>
                <button class="calc-btn" style="padding:10px; margin-top:10px; background: var(--teal); color: white;" onclick="showFutureInfo('${r.id}')">ℹ️ Részletek megtekintése</button>
                <div class="race-admin-controls admin-only" style="margin-top:10px; border-top:1px dashed #444; padding-top:10px;">
                    <button class="edit-btn" onclick="openRaceModal('jovo', '${r.id}')">Szerkesztés</button>
                    <button class="edit-btn" style="background:var(--success); color:black;" onclick="forceMoveToLive('jovo', '${r.id}')">▶️ Élesítés (ÉLŐ)</button>
                    <button class="edit-btn" style="background:var(--danger);" onclick="deleteRace('jovo', '${r.id}')">Törlés</button>
                </div>
            </div>`;
        });
    }
    
    // --- VENDÉG NÉZET MÚLTBÉLI VERSENYEKHEZ ---
    function openPublicPastRace(id) {
        const r = localRaces.mult.find(x => x.id === id);
        if(!r) return;
        viewingPastRaceData = r;
        pastAdatlapFilter = null;
        document.getElementById('pastRaceModalTitle').innerText = r.name + " - Eredmények";
        switchSidebarMode('past-race-view', null);
        renderPastAdatlapList();
    }

    function closePastRaceModal() {
        viewingPastRaceData = null;
        switchSidebarMode('versenyek', document.getElementById('btn-menu-versenyek'));
    }

    function setPastAdatlapFilter(cat) { pastAdatlapFilter = cat; renderPastAdatlapList(); }

    function renderPastAdatlapList() {
        const cont = document.getElementById('pastRaceAdatlapList');
        if(!viewingPastRaceData) return;
        const comps = parseCompetitors(viewingPastRaceData.competitors);
        const config = mergeRaceConfig(viewingPastRaceData.raceConfig);
        let activeCats = getActiveCategories(comps, config);

        if (!pastAdatlapFilter || pastAdatlapFilter === 'all') {
            let html = `<div style="display:flex; flex-direction:column; gap:10px;">`;
            if (activeCats.length === 0) { html += `<p style="text-align:center; color:var(--text-dim);">Nincsenek adatok ebben a versenyben.</p>`; } 
            else { activeCats.forEach(cat => { html += `<button class="calc-btn" style="background:var(--teal); color:white; font-size:1.2rem; padding:20px; margin-top:0;" onclick="setPastAdatlapFilter('${cat}')">${catNames[cat]}</button>`; }); }
            cont.innerHTML = html + `<button class="calc-btn" style="background:#444; color:white; margin-top:20px; font-size:0.9rem; padding:10px;" onclick="closePastRaceModal()">🔙 Vissza a versenyekhez</button></div>`;
        } else {
            let catComps = comps.filter(c => c.dist === pastAdatlapFilter);
            let total = catComps.length;
            let elim = catComps.filter(c => c.isEliminated).length;
            let qual = 0;
            catComps.forEach(c => {
                if (c.isEliminated) return;
                let baseDist = c.dist.replace('j', '');
                let expectedLaps = (config[baseDist] && config[baseDist].laps) ? config[baseDist].laps.length : 3;
                let completed = (c.laps || []).filter(l => l.isComplete).length;
                if (completed >= expectedLaps) qual++;
            });

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
                <div id="pastAdatlapItemsContainer"></div>
            `;
            cont.innerHTML = html;
            
            const itemsCont = document.getElementById('pastAdatlapItemsContainer');
            let ranksInfo = calculateCurrentRanks(comps, config);

            catComps.sort((a,b) => {
                if (a.isEliminated && !b.isEliminated) return 1;
                if (!a.isEliminated && b.isEliminated) return -1;
                if (!a.isEliminated && !b.isEliminated) { return (ranksInfo[a.bib]?.rank || 999) - (ranksInfo[b.bib]?.rank || 999); }
                return parseInt(a.bib) - parseInt(b.bib);
            });

            catComps.forEach(c => {
                let info = ranksInfo[c.bib] || { rank: "-", gapStr: "" };
                let rankStr = info.rank; let rankClass = c.isEliminated ? "kiesett" : "";
                let rankDisplay = c.isEliminated ? "ELIM" : rankStr + "º";
                let gapHtml = info.gapStr ? `<div class="adatlap-gap">Lemaradás: ${info.gapStr}</div>` : '';
                let speedStr = ""; let speedFlagHtml = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
                if (completedLaps.length > 0) {
                    let lastLap = completedLaps[completedLaps.length - 1];
                    speedStr = `Avg. ${lastLap.rideSpd.toFixed(2)} km/h`;
                    speedFlagHtml = getSpeedFlagBadgesHtml(c, completedLaps);
                }
                let speedHtml = speedStr ? `<div class="adatlap-speed-badge">${speedStr}</div>` : '';
                
                let statusObj = getCompLiveStatus(c, config);
                let liveStatusHtml = `<span class="adatlap-live-status" style="background:${statusObj.color}; color:${statusObj.textCol||'#fff'};">${statusObj.text}</span>`;

                itemsCont.innerHTML += `
                <div class="adatlap-card" onclick="openAdatlap('${c.bib}', true)">
                    <div class="adatlap-rank ${rankClass}">${rankDisplay}</div>
                    <div class="adatlap-info">
                        <div class="adatlap-name-row"><span class="adatlap-bib">${c.bib}</span> <span class="adatlap-name">${c.name}</span> ${liveStatusHtml}</div>
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
            // document.getElementById('rm-tab-btn-gyors').style.display = 'none'; // IDEIGLENES "Gyors eredmény" - kikapcsolva
        } else {
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
            // document.getElementById('rm-tab-btn-gyors').style.display = type === 'jovo' ? 'none' : 'block'; // IDEIGLENES "Gyors eredmény" - kikapcsolva
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
                document.getElementById('rm-isObRound').checked = !!race.isObRound;
            }
        } else {
            document.getElementById('rm-name').value = '';
            document.getElementById('rm-loc').value = '';
            document.getElementById('rm-date').value = '';
            document.getElementById('rm-desc').value = '';
            document.getElementById('rm-isObRound').checked = false;
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
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
            // document.getElementById('rm-tab-btn-gyors').style.display = type === 'jovo' ? 'none' : 'block'; // IDEIGLENES "Gyors eredmény" - kikapcsolva
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
            btn.style.background = '#28a745';
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
            // updateRmGyorsCompetitorDisplays(); // IDEIGLENES "Gyors eredmény" - kikapcsolva
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

    // --- MODAL: KIÍRÁS FUNKCIÓK ÉS DINAMIKUS KÖRÖK ---
    function changeRmLapCount(dist, count) {
        let currentLaps = modalRaceConfig[dist].laps || [];
        let newCount = parseInt(count);
        if (newCount > currentLaps.length) {
            for(let i = currentLaps.length; i < newCount; i++) currentLaps.push('');
        } else if (newCount < currentLaps.length) {
            currentLaps = currentLaps.slice(0, newCount);
        }
        modalRaceConfig[dist].laps = currentLaps;
        renderRmKiiras();
    }

    function renderRmKiiras() {
        const cont = document.getElementById('rm-kiirasContainer'); cont.innerHTML = '';
        const dists = ["100", "80", "60", "40", "20"];
        dists.forEach(d => {
            if(!modalRaceConfig[d]) return;
            let currentLapCount = (modalRaceConfig[d].laps || []).length;
            let html = `<div class="kiiras-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h3 style="margin:0; color:white;">${catNames[d]} Kategória</h3>
                    <select class="admin-only" style="width:auto; padding:6px; background:#444; border:none; color:white; border-radius:6px; margin:0;" onchange="changeRmLapCount('${d}', this.value)">
                        ${[1,2,3,4,5,6,7,8].map(num => `<option value="${num}" ${currentLapCount === num ? 'selected' : ''}>${num} kör</option>`).join('')}
                    </select>
                </div>
                <label>Hivatalos Rajt:</label>
                <div class="time-group">
                    <input type="number" placeholder="00" value="${modalRaceConfig[d].h}" onchange="updateRmRaceConfig('${d}', 'h', this.value)" oninput="jump(this, 'rm-kr_${d}_m')"> :
                    <input type="number" id="rm-kr_${d}_m" placeholder="00" value="${modalRaceConfig[d].m}" onchange="updateRmRaceConfig('${d}', 'm', this.value)" oninput="jump(this, 'rm-kr_${d}_s')"> :
                    <input type="number" id="rm-kr_${d}_s" placeholder="00" value="${modalRaceConfig[d].s}" onchange="updateRmRaceConfig('${d}', 's', this.value)">
                </div>
                <label>Körök távolságai (km):</label>
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">`;
            modalRaceConfig[d].laps.forEach((lapDist, idx) => {
                html += `<input type="number" step="0.1" placeholder="${idx+1}. kör" value="${lapDist}" style="width:65px;" onchange="updateRmRaceLap('${d}', ${idx}, this.value)">`;
            });
            html += `</div></div>`;
            cont.innerHTML += html;
        });
    }
    function updateRmRaceConfig(dist, field, val) { modalRaceConfig[dist][field] = val; }
    function updateRmRaceLap(dist, idx, val) { 
        if(!modalRaceConfig[dist].laps) modalRaceConfig[dist].laps = [];
        modalRaceConfig[dist].laps[idx] = val; 
    }
    function saveRmKiiras() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const type = document.getElementById('rm-type').value;
        db.ref('races/' + type + '/' + modalRaceId + '/raceConfig').set(modalRaceConfig).then(() => {
            showAnimatedBtn('saveRmKiirasBtn');
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
    }

    function saveRmVet() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const name = document.getElementById('rm-regVetName').value.trim();
        if(!name) { showToast("Add meg az orvos nevét!", true); return; }
        const type = document.getElementById('rm-type').value;
        const id = Date.now().toString();
        db.ref('races/' + type + '/' + modalRaceId + '/vets/' + id).set({ id, name }).then(() => {
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

    // --- MODAL: VERSENYZŐ FUNKCIÓK ---
    function saveRmCompetitor() {
        if(!modalRaceId) { showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true); return; }
        const type = document.getElementById('rm-type').value;
        
        // ÚJ: Beolvassuk az összes mezőt (ezek hiányoztak!)
        const bib = document.getElementById('rm-regBib').value;
        const name = document.getElementById('rm-regName').value;
        const startNum = document.getElementById('rm-regStartNum').value; 
        const license = document.getElementById('rm-regLicense').value;   
        const club = document.getElementById('rm-regClub').value;         
        const dist = document.getElementById('rm-regDist').value;
        const internal = document.getElementById('rm-regInternal').value; 
        
        if (!bib || !name) { showToast("Név és rajtszám kötelező!", true); return; }
        
        if (modalEditingBib && modalEditingBib !== bib) { db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + modalEditingBib).remove(); }

        let existingData = { startTime: { h: '', m: '', s: '' }, laps: [], isEliminated: false };
        const targetBib = modalEditingBib ? modalEditingBib : bib;
        const oldComp = modalCompetitors.find(c => c.bib == targetBib);
        if (oldComp) {
            existingData.startTime = oldComp.startTime || existingData.startTime;
            existingData.laps = oldComp.laps || [];
            existingData.isEliminated = oldComp.isEliminated || false;
        }

        // Ló/lovas törzsadat upsert (lo-lovas-integracio.md, 7. szakasz)
        const horseRiderUpdates = {};
        if (startNum) horseRiderUpdates['horses/' + sanitizeKey(startNum)] = { startNum: startNum, name: internal.trim(), updatedAt: Date.now() };
        if (license)  horseRiderUpdates['riders/' + sanitizeKey(license)]  = { license: license, name: name.trim(), club: club, updatedAt: Date.now() };
        if (Object.keys(horseRiderUpdates).length) db.ref('/').update(horseRiderUpdates);

        // Tranzakció: ha a célhelyen (ez a bib) időközben már van szerver-oldali adat (laps/startTime),
        // azt tartjuk meg - a helyi existingData csak akkor esik latba, ha a hely még valóban üres.
        db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + bib).transaction(currentComp => {
            const base = currentComp || existingData;
            return {
                bib: bib, name: name, dist: dist, internal: internal, startNum: startNum, license: license, club: club,
                startTime: base.startTime || { h: '', m: '', s: '' },
                laps: base.laps || [],
                isEliminated: base.isEliminated || false,
                // A nevezés csak egy pillanatfelvétel - ezek nélkül a mentés törölné az orvosi
                // döntést, ha az korábban már megvolt (idomodell-es-hibak.md, A rész).
                // A Firebase SDK nem fogad el "undefined" mezőértéket, ezért null a biztonságos alap
                // (null = a kulcs egyszerűen nem jön létre, pont mint eddig, ha még nem volt orvosi adat).
                status: base.status || null,
                extraCodes: base.extraCodes || [],
                preVet: base.preVet || null
            };
        }).then(() => {
            showAnimatedBtn('rm-addCompBtn');
            cancelRmEdit();
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
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
    // helyezéseket kapjuk meg. Kikapcsolva (felhasználói kérés) - ha kell megint,
    // csak vedd ki a /* */ jelölést, ne írd újra.
    // ============================================================================
    /*
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

        if (!bib || !name) { showToast("Név és rajtszám kötelező!", true); return; }

        if (modalGyorsEditingBib && modalGyorsEditingBib !== bib) { db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + modalGyorsEditingBib).remove(); }

        // Ló/lovas törzsadat upsert (lo-lovas-integracio.md, 7. szakasz) - ugyanaz a minta, mint a normál nevezésnél.
        const horseRiderUpdates = {};
        if (startNum) horseRiderUpdates['horses/' + sanitizeKey(startNum)] = { startNum: startNum, name: internal.trim(), updatedAt: Date.now() };
        if (license)  horseRiderUpdates['riders/' + sanitizeKey(license)]  = { license: license, name: name.trim(), club: club, updatedAt: Date.now() };
        if (Object.keys(horseRiderUpdates).length) db.ref('/').update(horseRiderUpdates);

        const compData = {
            bib: bib, name: name, dist: dist, internal: internal, startNum: startNum, license: license, club: club,
            status: status, isEliminated: status !== 'Active',
            manualEntry: true,
            manualPlace: isNaN(place) ? null : place,
            totalTimeSec: timeSec > 0 ? timeSec : null,
            laps: []
        };

        db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + bib).set(compData).then(() => {
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
    */

    // --- MODAL: TELJES VERSENY (EREDMÉNYEK) ---
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

        if (comp.status) document.getElementById('rm-compStatusSelect').value = comp.status;
        else document.getElementById('rm-compStatusSelect').value = comp.isEliminated ? 'Kiesett' : 'Active';

        const baseDist = comp.dist.replace('j', '');
        const cfg = modalRaceConfig[baseDist] || { h:'', m:'', s:'', laps:[] };
        
        document.getElementById('rm-vhR').value = comp.startTime.h || cfg.h;
        document.getElementById('rm-vmR').value = comp.startTime.m || cfg.m;
        document.getElementById('rm-vsR').value = comp.startTime.s || cfg.s;

        const lapsArr = comp.laps || [];
        lapsArr.forEach((l, i) => {
            const idx = i + 1;
            if(document.getElementById(`rm-vd${idx}`)) {
                document.getElementById(`rm-vd${idx}`).value = l.d || '';
                document.getElementById(`rm-vh${idx}`).value = l.h || ''; document.getElementById(`rm-vm${idx}`).value = l.m || ''; document.getElementById(`rm-vs${idx}`).value = l.s || '';
                document.getElementById(`rm-voh${idx}`).value = l.oh || ''; document.getElementById(`rm-vom${idx}`).value = l.om || ''; document.getElementById(`rm-vos${idx}`).value = l.os || '';
            }
        });
        if(lapsArr.length === 0) {
            (cfg.laps || []).forEach((ld, i) => { if(document.getElementById(`rm-vd${i+1}`)) document.getElementById(`rm-vd${i+1}`).value = ld; });
        }
        calcRmVerseny();
    }

    function calcRmVerseny() {
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
            target.isEliminated = (statusVal !== 'Active');
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
                <div class="plan-data-row"><span class="plan-data-label">Kör idő:</span> <b style="color:white;">${toTimeStr(l.loopSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Beérkezés:</span> <b style="color:white;">${toTimeStr(l.arrSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Átlag:</span> <b style="color:${loopColor}">${l.loopSpd.toFixed(2)} km/h</b></div>
                ${l.vetSec > 0 ? `
                <div style="margin-top:6px; border-top:1px dashed #444; padding-top:6px;"></div>
                <div class="plan-data-row"><span class="plan-data-label">Orvosi idő:</span> <b style="color:white;">${toTimeStr(isFinalLap ? (l.loopSec + l.pulzusSec) : l.phaseSec)}</b></div>
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
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:white;">${toTimeStr(totalTime)}</b></div>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. átlagsebesség:</span> <b style="font-size:1.3rem; color:${avgColor}">${lastComplete.rideSpd.toFixed(2)} km/h</b></div>
                </div>`;
            }
        }
        document.getElementById('rm-res2').style.display='block'; document.getElementById('rm-res2').innerHTML = html;
        if (comp) {
            const type = document.getElementById('rm-type').value;
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + comp.bib).transaction(currentComp => {
                if (!currentComp) return currentComp;
                const result = recalcCompetitorData(applyForm(currentComp), modalRaceConfig);
                delete result._timeWarnings; // ideiglenes, kijelzésre való - nem mentjük el
                return result;
            });
        }
        showAnimatedBtn('rm-btn-kiertel-mentes');
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
        if (rajt === 0) return comp;
        
        let curStart = rajt;
        let totalPure = 0;
        let totalD = 0;
        if (!comp.laps) comp.laps = [];
        
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
            if (!l.isComplete) { comp.laps[i] = l; continue; }
            
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
            // normalizálva 0-86399 közé, hogy éjfél körül ne "24:xx:xx"-ként jelenjen meg és a várakozó-státusz ne ragadjon be (P0/2)
            l.nextStart = ((vet > 0 ? vet : arr) + 2400) % 86400;

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

    // --- BEÉRKEZTETÉS MÓD ---
    function loadBeerkeztetesData() {
        const bib = document.getElementById('sel-beerkeztetes').value;
        const form = document.getElementById('beerkeztetes-form');
        if(!bib) { form.style.display = 'none'; return; }
        
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;
        
        let idx = getActiveLapIndex(comp, raceConfig);
        document.getElementById('bk-lap-title').innerText = `${idx + 1}. Kör Beérkeztetése`;
        let l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        
        document.getElementById('bk-h').value = l.h || '';
        document.getElementById('bk-m').value = l.m || '';
        document.getElementById('bk-s').value = l.s || '';
        
        form.style.display = 'block';
    }

    function saveBeerkeztetesData() {
        const bib = document.getElementById('sel-beerkeztetes').value;
        const h = document.getElementById('bk-h').value, m = document.getElementById('bk-m').value, s = document.getElementById('bk-s').value;

        // Tranzakció: a szerveren lévő legfrissebb állapotot olvassa be és azon hajtja végre
        // ugyanezt a módosítást - ha közben más (pl. az orvos) is írt, nem veszik el az ő mentése.
        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            let idx = getActiveLapIndex(currentComp, raceConfig);
            if (!currentComp.laps) currentComp.laps = [];
            if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
            currentComp.laps[idx].h = h;
            currentComp.laps[idx].m = m;
            currentComp.laps[idx].s = s;
            const result = recalcCompetitorData(currentComp, raceConfig);
            delete result._timeWarnings; // ideiglenes, kijelzésre való (élőben már jelezve gépeléskor) - nem mentjük el
            return result;
        }).then(() => {
            showAnimatedBtn('btn-bk-mentes');
            document.getElementById('sel-beerkeztetes').value = '';
            document.getElementById('bk-bibInput').value = ''; // <--- EZ TÖRLI A KERESŐT
            document.getElementById('beerkeztetes-form').style.display = 'none';
            refreshVersenyTabIfNeeded(bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }
    
    // --- ORVOSI IDŐ MÓD ---
    function loadOrvosiIdoData() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const form = document.getElementById('orvosi-ido-form');
        if(!bib) { form.style.display = 'none'; renderWarningBanner('orv-ido-recovery-warning', null); return; }
        
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;
        
        let idx = getActiveLapIndex(comp, raceConfig);
        document.getElementById('bk-vet-lap-title').innerText = `${idx + 1}. Kör Orvosi Idő`;
        let l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};

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
        checkOrvosiIdoRecovery();
    }

    function saveOrvosiIdoData() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const oh = document.getElementById('bk-v-h').value, om = document.getElementById('bk-v-m').value, os = document.getElementById('bk-v-s').value;

        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            let idx = getActiveLapIndex(currentComp, raceConfig);
            if (!currentComp.laps) currentComp.laps = [];
            if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
            currentComp.laps[idx].oh = oh;
            currentComp.laps[idx].om = om;
            currentComp.laps[idx].os = os;
            const result = recalcCompetitorData(currentComp, raceConfig);
            delete result._timeWarnings; // ideiglenes, kijelzésre való (élőben már jelezve gépeléskor) - nem mentjük el
            return result;
        }).then(() => {
            showAnimatedBtn('btn-bk-vet-mentes');
            document.getElementById('sel-orvosi-ido').value = '';
            document.getElementById('oi-bibInput').value = ''; // <--- EZ TÖRLI A KERESŐT
            document.getElementById('orvosi-ido-form').style.display = 'none';
            refreshVersenyTabIfNeeded(bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }

    // --- ÁLLATORVOSOK FELVITELE (ÚJ FUNKCIÓK) ---
    function saveVet() {
        const name = document.getElementById('regVetName').value.trim();
        if(!name) { showToast("Add meg az orvos nevét!", true); return; }
        const id = Date.now().toString();
        db.ref('vets/' + id).set({ id: id, name: name });
        document.getElementById('regVetName').value = '';
        showToast("Állatorvos sikeresen hozzáadva!");
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
        if(!bib) { form.style.display = 'none'; renderWarningBanner('orv-recovery-warning', null); renderExtraCodesCheckboxes([]); return; }

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
            renderWarningBanner('orv-recovery-warning', getRecoveryWarning(toSec(l.h, l.m, l.s), toSec(l.oh, l.om, l.os), isFinalLap));
        }

        // Adatok betöltése
        document.getElementById('orv-pulse').value = l.pulse || '';
        document.getElementById('orv-hrri').value = l.hrri || '';
        document.getElementById('orv-nyalka').value = l.nyalka || '';
        document.getElementById('orv-crt').value = l.crt || '';
        document.getElementById('orv-farizom').value = l.farizom || '';
        document.getElementById('orv-vizhaztartas').value = l.vizhaztartas || '';
        document.getElementById('orv-belhang').value = l.belhang || '';
        document.getElementById('orv-mozgas').value = l.mozgas || '';
        document.getElementById('orv-vet-name').value = l.vetName || '';
        document.getElementById('orv-notes').value = l.vetNotes || '';
        
        function adjustVetDecisionColors(sel) {
            const val = sel.value;
            if(val === 'Passed' || val === 'Active') sel.style.color = 'var(--success)';
            else if(['WD', 'RET', 'FNR'].includes(val)) sel.style.color = 'var(--warning)';
            else sel.style.color = 'var(--danger)';
        }

        if (comp.isEliminated || comp.status !== 'Active') {
            let s = comp.status;
            if (s === 'Visszalépett' || s === 'Retired' || s === 'DNS') s = 'WD';
            else if (s === 'Kiesett' || s === 'Eliminated') s = 'FTQ-ME'; 
            
            let exists = Array.from(document.getElementById('orvStatusSelect').options).some(opt => opt.value === s);
            document.getElementById('orvStatusSelect').value = exists ? s : 'FTQ-ME';
        } else {
            // ÚJ: Alapértelmezetten a zöld "Active" (Továbbengedve) opciót kapja meg!
            document.getElementById('orvStatusSelect').value = 'Active';
        }
        adjustVetDecisionColors(document.getElementById('orvStatusSelect'));
        renderExtraCodesCheckboxes(comp.extraCodes);

        form.style.display = 'block';
        checkPulseWarning();
    }

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

        db.ref('competitors/' + bib).transaction(currentComp => {
            if (!currentComp) return currentComp;
            let idx = getVetLapIndex(currentComp);
            let targetObj;

            if (idx === -1) {
                if (!currentComp.preVet) currentComp.preVet = {};
                targetObj = currentComp.preVet;
            } else {
                if (!currentComp.laps) currentComp.laps = [];
                if (!currentComp.laps[idx]) currentComp.laps[idx] = {};
                targetObj = currentComp.laps[idx];
            }

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

            // JAVÍTÁS: Itt is az 'Active' a zöld utat jelentő kód!
            if (decision === 'Active' || decision === 'Passed') {
                currentComp.isEliminated = false;
                currentComp.status = 'Active';
                targetObj.vetDecision = "Továbbengedve";
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
            document.getElementById('print-sticker').innerHTML = `<p style="color:white; text-align:center;">Nincs rögzített adat.</p>`;
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
        let recStr = (l.arrSec > 0 && l.vetSec > 0) ? toTimeStr(l.vetSec - l.arrSec) : '-';
        let outStr = (l.nextStart > 0 && !isFinalLap && l.vetDecision !== 'Eliminated') ? toTimeStr(l.nextStart) : (isFinalLap ? 'FINISH' : '-');

        // --- ÚJ: SEBESSÉGEK ÉS IDŐK SZÁMÍTÁSA ---
        let lapDist = (raceConfig[baseDist] && raceConfig[baseDist].laps && raceConfig[baseDist].laps[lastIdxReal]) ? parseFloat(raceConfig[baseDist].laps[lastIdxReal]) : 0;
        let lapTimeSec = (l.arrSec > 0 && l.startSec > 0) ? (l.arrSec - l.startSec) : 0;
        let lapTimeStr = lapTimeSec > 0 ? toTimeStr(lapTimeSec) : '-';
        let lapSpeed = (lapDist > 0 && lapTimeSec > 0) ? (lapDist / (lapTimeSec / 3600)).toFixed(2) + ' km/h' : '-';

        let totalDist = 0; 
        let totalTimeSec = 0;
        for(let i=0; i<=lastIdxReal; i++) {
            let p = comp.laps[i];
            let d = (raceConfig[baseDist] && raceConfig[baseDist].laps && raceConfig[baseDist].laps[i]) ? parseFloat(raceConfig[baseDist].laps[i]) : 0;
            if(p && p.arrSec > 0 && p.startSec > 0) { 
                totalDist += d; 
                totalTimeSec += (p.arrSec - p.startSec); 
            }
        }
        let avgSpeed = (totalDist > 0 && totalTimeSec > 0) ? (totalDist / (totalTimeSec / 3600)).toFixed(2) + ' km/h' : '-';

        let raceNameStr = liveRaceMeta ? liveRaceMeta.name : "Élő Verseny";

        // --- ÚJ: HELYEZÉS ÉS LEMARADÁS ---
        let ranksInfo = calculateCurrentRanks(competitors, raceConfig);
        let myRankInfo = ranksInfo[comp.bib] || { rank: "-", gapStr: "" };
        let rankDisplay = myRankInfo.rank === "Kiesett" ? "Kiesett" : myRankInfo.rank + ".";
        let gapDisplay = myRankInfo.gapStr ? myRankInfo.gapStr : "-";

        let distName = catNames[comp.dist] || (comp.dist + " km");

        // SZERKEZET: 145mm x 95mm. 
        let html = `
            <div style="width: 145mm; height: 95mm; border: 3px solid #000; padding: 2mm; box-sizing: border-box; background: #fff; color: #000; font-family: Arial, sans-serif; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; margin: 0 auto; line-height: 1.2;">
                
                <div style="flex: 0 0 auto;">
                    <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                        <tr>
                            <td style="width: 18%; border: 2px solid #000; text-align: center; background: #dddddd ; color: #000000; font-size: 26pt; font-weight: bold; padding: 1mm;">#${comp.bib}</td>
                            <td style="width: 48%; padding-left: 2.5mm; padding-right: 2.5mm; vertical-align: top; overflow: hidden;">
                                <div style="text-align: center; background: #f0f0f0; padding: 1mm; margin-bottom: 1.5mm; border: 1px solid #000; border-radius: 3px; font-size: 10pt; font-weight: bold; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${raceNameStr}
                                </div>
                                <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase; line-height: 1.1; word-wrap: break-word; overflow-wrap: break-word;">${comp.name}</div>
                                <div style="font-size: 11pt; margin-top: 1mm; word-wrap: break-word; overflow-wrap: break-word;">${comp.internal || "Ló neve hiányzik"}</div>
                            </td>
                            <td style="width: 49%; vertical-align: top;">
                                <table style="width: 100%; border-collapse: collapse; text-align: center; table-layout: fixed;">
                                    <tr style="background: #e0e0e0; font-size: 8pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">ARR</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">VET</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">PULSE</td>
                                    </tr>
                                    <tr style="font-size: 11pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">${arrStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">${inStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">${recStr}</td>
                                    </tr>
                                    <tr style="background: #e0e0e0; font-size: 7.5pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">KÖR IDŐ</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">KÖR ÁTL.</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">ÖSSZ ÁTL.</td>
                                    </tr>
                                    <tr style="font-size: 9pt; font-weight: bold;">
                                        <td style="border: 1px solid #000; padding: 1mm;">${lapTimeStr}</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">${lapSpeed}</td>
                                        <td style="border: 1px solid #000; padding: 1mm;">${avgSpeed}</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </div>

                <div style="flex: 1 1 auto; margin: 1.5mm 0; min-height: 0;">
                    <table style="width: 100%; height: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 1mm">
                        <tr style="background: #e0e0e0; color: #000; font-size: 8pt; text-transform: uppercase;">
                            <th style="border: 2px solid #000; padding: 1mm; width: 14%;">TÁV</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 20%;">ÁLLÁS</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 22%;">PULZUS (HR)</th>
                            <th style="border: 2px solid #000; padding: 1mm; width: 44%;">KLINIKAI PARAMÉTEREK</th>
                        </tr>
                        <tr>
                            <td style="border: 2px solid #000; padding: 0; height: 100%;">
                                <table style="width: 100%; height: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="background: #ffffff; border-bottom: 2px solid #000; text-align: center; vertical-align: middle; padding: 1mm;">
                                            <div style="font-size: 15pt; font-weight: bold; text-transform: uppercase;">${distName}</div>
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
                                <div style="font-size: 20pt; font-weight: bold; margin-bottom: 2mm;">${rankDisplay}</div>
                                <div style="font-size: 8pt; color: #000000; text-transform: uppercase;">Lemaradás</div>
                                <div style="font-size: 10pt; font-weight: bold; margin-top: 1mm;">${gapDisplay}</div>
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
                                            <div style="font-size: 8pt; color: #000000;">Nyálkahártya</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.nyalka || '-'}</div>
                                        </td>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000; width: 50%;">
                                            <div style="font-size: 8pt; color: #000000;">Kapilláris (CRT)</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.crt || '-'}</div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000; border-right: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000;">Vízháztartás</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.vizhaztartas || '-'}</div>
                                        </td>
                                        <td style="padding: 1.5mm; border-bottom: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000;">Bélműködés</div>
                                            <div style="font-size: 12pt; font-weight: bold; text-transform: uppercase;">${l.belhang || '-'}</div>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 1.5mm; border-right: 1px solid #000;">
                                            <div style="font-size: 8pt; color: #000000;">Farizom / Nyereg</div>
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
                                <div style="font-size: 9pt; text-transform: uppercase;">Kimeneteli Idő / OUT</div>
                                <div style="font-size: 24pt; font-weight: bold; letter-spacing: 1px; color: #000; line-height: 1.1;">
                                    ${outStr}
                                </div>
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
    function openVetHistory(bib) {
        let comp = null;
        
        // 1. Először keressük az élő versenyzők között
        if (competitors && competitors.length > 0) {
            comp = competitors.find(c => c.bib == bib);
        }
        
        // 2. Ha nincs meg, akkor keressük a jelenleg megnyitott Múltbéli versenyben!
        // (parseCompetitors-t használjuk, mert a Firebase néha "lyukas" tömbként adja vissza
        // a competitors objektumot, és egy nyers Object.values/Array.isArray simán undefined
        // elemeket is beengedett volna -> emiatt nem nyílt meg a karton egyes versenyzőknél)
        if (!comp && viewingPastRaceData && viewingPastRaceData.competitors) {
            let pastArr = parseCompetitors(viewingPastRaceData.competitors);
            comp = pastArr.find(c => c.bib == bib);
        }

        if(!comp) {
            showToast("A versenyző orvosi adatai nem találhatók!", true);
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
            });
        }

        if (columns.length === 0) {
            showToast("Még nincs rögzített orvosi adat ehhez a versenyzőhöz.", true);
            return;
        }

        let html = `
            <div style="background:#1c1c1e; padding:0; border-radius:12px; color:#fff; width: 100%; max-width: 850px; margin: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow:hidden;">
                
                <div style="background: var(--teal); color: #fff; padding: 20px; text-align: center;">
                    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 5px;">${comp.bib} | ${comp.name}</div>
                    <div style="font-size: 1.5rem; font-weight: 900; text-transform: uppercase;">${comp.internal || "Ló neve hiányzik"}</div>
                </div>
                
                <div style="padding: 20px; overflow-x: auto;">
                    <table style="width:100%; border-collapse: collapse; text-align:center; font-size:1rem; font-family: sans-serif;">
                        <tr style="background:#137A7F; color:#fff;">
                            <th style="padding:12px; border-bottom:2px solid #1c1c1e; text-align:left; width:30%;">Szakasz</th>
        `;

        columns.forEach(col => {
            html += `<th style="padding:12px; border-bottom:2px solid #1c1c1e;">${col.title}</th>`;
        });
        html += `</tr>`;

        const renderVetRowCustom = (label, valFn) => {
            let rowHtml = `<tr style="border-bottom: 3px solid #1c1c1e; background: #2c2c2e;">
                <td style="padding:10px; text-align:left; font-weight:bold; color:#fff; background:#3a3a3c;">${label}</td>`;
            columns.forEach(col => {
                rowHtml += `<td style="padding:10px; color:#fff;">${valFn(col)}</td>`;
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

        html += `
                    </table>
                </div>
                
                <div style="text-align:center; padding: 15px 20px 20px 20px; background: #1c1c1e;">
                    <button class="calc-btn" style="width:auto; padding:10px 40px; border-radius:25px; background:#444; color:#fff; border: none; font-weight:bold; font-size: 1.1rem; cursor:pointer;" onclick="closeAdatlap()">Bezárás</button>
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

    function changeLapCount(dist, count) {
        let currentLaps = raceConfig[dist].laps || [];
        let newCount = parseInt(count);
        if (newCount > currentLaps.length) {
            for(let i = currentLaps.length; i < newCount; i++) currentLaps.push('');
        } else if (newCount < currentLaps.length) {
            currentLaps = currentLaps.slice(0, newCount);
        }
        raceConfig[dist].laps = currentLaps;
        renderKiiras();
    }

    function renderKiiras() {
        const cont = document.getElementById('kiirasContainer'); cont.innerHTML = '';
        const dists = ["100", "80", "60", "40", "20"];
        dists.forEach(d => {
            if(!raceConfig[d]) return;
            let currentLapCount = (raceConfig[d].laps || []).length;
            let html = `<div class="kiiras-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                    <h3 style="margin:0; color:white;">${catNames[d]} Kategória</h3>
                    <select class="admin-only" style="width:auto; padding:6px; background:#444; border:none; color:white; border-radius:6px; margin:0;" onchange="changeLapCount('${d}', this.value)">
                        ${[1,2,3,4,5,6,7,8].map(num => `<option value="${num}" ${currentLapCount === num ? 'selected' : ''}>${num} kör</option>`).join('')}
                    </select>
                </div>
                <label>Hivatalos Rajt:</label>
                <div class="time-group">
                    <input type="number" placeholder="00" value="${raceConfig[d].h}" onchange="updateRaceConfig('${d}', 'h', this.value)" oninput="jump(this, 'kr_${d}_m')"> :
                    <input type="number" id="kr_${d}_m" placeholder="00" value="${raceConfig[d].m}" onchange="updateRaceConfig('${d}', 'm', this.value)" oninput="jump(this, 'kr_${d}_s')"> :
                    <input type="number" id="kr_${d}_s" placeholder="00" value="${raceConfig[d].s}" onchange="updateRaceConfig('${d}', 's', this.value)">
                </div>
                <label>Körök távolságai (km):</label>
                <div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">`;
            raceConfig[d].laps.forEach((lapDist, idx) => {
                html += `<input type="number" step="0.1" placeholder="${idx+1}. kör" value="${lapDist}" style="width:65px;" onchange="updateRaceLap('${d}', ${idx}, this.value)">`;
            });
            html += `</div></div>`;
            cont.innerHTML += html;
        });
    }

    function updateRaceConfig(dist, field, val) { raceConfig[dist][field] = val; }
    function updateRaceLap(dist, idx, val) { 
        if(!raceConfig[dist].laps) raceConfig[dist].laps = [];
        raceConfig[dist].laps[idx] = val; 
    } 

    function saveKiiras() {
        db.ref('raceConfig').set(raceConfig).then(() => {
            showAnimatedBtn('saveKiirasBtn');
            showToast('Kiírás sikeresen mentve!');
        }).catch(e => showToast('Hiba a mentéskor: ' + e.message, true));
    }

    // --- BEÁLLÍTÁSOK FÜL: design téma választó (kártyák) ---
    function setUiTheme(key) {
        db.ref('settings/uiTheme').set(key).catch(e => showToast('Hiba: ' + e.message, true));
    }

    function renderThemeSwatches() {
        const cont = document.getElementById('themeSwatchRow');
        if (!cont) return;
        cont.innerHTML = THEME_LIST.map(t => `
            <div class="theme-swatch ${uiTheme === t.key ? 'active' : ''}" onclick="setUiTheme('${t.key}')">
                <div class="theme-swatch-preview" style="background:linear-gradient(135deg, ${t.colors[1]} 0%, ${t.colors[2]} 100%);"><div class="dot" style="background:${t.colors[0]}; color:${t.colors[0]};"></div></div>
                <div class="theme-swatch-label">${t.label}</div>
                <div class="theme-swatch-check">✓ Aktív</div>
            </div>
        `).join('');
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
        const dists = ["20", "40", "60", "80", "80j", "100", "100j"];
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
        const bib = document.getElementById('regBib').value;
        const name = document.getElementById('regName').value;
        const startNum = document.getElementById('regStartNum').value;
        const license = document.getElementById('regLicense').value;
        const club = document.getElementById('regClub').value;
        const dist = document.getElementById('regDist').value;
        const internal = document.getElementById('regInternal').value; 
        if (!bib || !name) { showToast("Név és rajtszám kötelező!", true); return; }

        if (editingBib && editingBib !== bib) { db.ref('competitors/' + editingBib).remove(); }

        let existingData = { startTime: { h: '', m: '', s: '' }, laps: [], isEliminated: false };
        const targetBib = editingBib ? editingBib : bib;
        const oldComp = competitors.find(c => c.bib == targetBib);
        if (oldComp) {
            existingData.startTime = oldComp.startTime || existingData.startTime;
            existingData.laps = oldComp.laps || [];
            existingData.isEliminated = oldComp.isEliminated || false;
        }

        // Ló/lovas törzsadat upsert (lo-lovas-integracio.md, 7. szakasz) - a nevezés csak egy pillanatfelvétel innentől
        const horseRiderUpdates = {};
        if (startNum) horseRiderUpdates['horses/' + sanitizeKey(startNum)] = { startNum: startNum, name: internal.trim(), updatedAt: Date.now() };
        if (license)  horseRiderUpdates['riders/' + sanitizeKey(license)]  = { license: license, name: name.trim(), club: club, updatedAt: Date.now() };
        if (Object.keys(horseRiderUpdates).length) db.ref('/').update(horseRiderUpdates);

        // Tranzakció: ha a célhelyen (ez a bib) időközben már van szerver-oldali adat (laps/startTime,
        // pl. a beérkeztető vagy az orvos épp most mentett), azt tartjuk meg felülírás helyett.
        db.ref('competitors/' + bib).transaction(currentComp => {
            const base = currentComp || existingData;
            return {
                bib: bib, name: name, dist: dist, internal: internal, startNum: startNum, license: license, club: club,
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
        }).then(() => {
            showAnimatedBtn('addCompBtn');
            cancelEdit();
        }).catch(e => showToast("Hiba a mentéskor: " + e.message, true));
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

        const lapsArr = comp.laps || [];
        lapsArr.forEach((l, i) => {
            const idx = i + 1;
            if(document.getElementById(`vd${idx}`)) {
                if(l.d) document.getElementById(`vd${idx}`).value = l.d; 
                document.getElementById(`vh${idx}`).value = l.h || ''; document.getElementById(`vm${idx}`).value = l.m || ''; document.getElementById(`vs${idx}`).value = l.s || '';
                document.getElementById(`voh${idx}`).value = l.oh || ''; document.getElementById(`vom${idx}`).value = l.om || ''; document.getElementById(`vos${idx}`).value = l.os || '';
            }
        });
        
        calcVerseny(false);
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

        const lapsArr = comp.laps || [];
        lapsArr.forEach((l, i) => {
            const idx = i + 1;
            if(document.getElementById(`vd${idx}`)) {
                if(l.d) document.getElementById(`vd${idx}`).value = l.d; 
                document.getElementById(`vh${idx}`).value = l.h || ''; document.getElementById(`vm${idx}`).value = l.m || ''; document.getElementById(`vs${idx}`).value = l.s || '';
                document.getElementById(`voh${idx}`).value = l.oh || ''; document.getElementById(`vom${idx}`).value = l.om || ''; document.getElementById(`vos${idx}`).value = l.os || '';
            }
        });
        
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
            target.startTime = startTime;
            target.status = statusVal;
            target.isEliminated = (statusVal !== 'Active');
            lapValues.forEach((lv, i) => {
                if (!target.laps) target.laps = [];
                if (!target.laps[i]) target.laps[i] = {};
                Object.assign(target.laps[i], lv);
            });
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
                <div class="plan-data-row"><span class="plan-data-label">Kör idő:</span> <b style="color:white;">${toTimeStr(l.loopSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Beérkezés:</span> <b style="color:white;">${toTimeStr(l.arrSec)}</b></div>
                <div class="plan-data-row"><span class="plan-data-label">Átlag:</span> <b style="color:${loopColor}">${l.loopSpd.toFixed(2)} km/h</b></div>
                ${l.vetSec > 0 ? `
                <div style="margin-top:6px; border-top:1px dashed #444; padding-top:6px;"></div>
                <div class="plan-data-row"><span class="plan-data-label">Orvosi idő:</span> <b style="color:white;">${toTimeStr(isFinalLap ? (l.loopSec + l.pulzusSec) : l.phaseSec)}</b></div>
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
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:white;">${toTimeStr(totalTime)}</b></div>
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
            showAnimatedBtn('btn-kiertel-mentes');
        }
    }
    // --- ALAPOK ÉS SEGÉDFÜGGVÉNYEK ---
    function jump(c, n) { if (c.value.length >= 2) { const e = document.getElementById(n); if(e) e.focus(); } }
    
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
    function getRecoveryWarning(arrSec, vetSec, isFinalLap) {
        if (!(arrSec > 0) || !(vetSec > 0)) return null;
        const roll = resolveRollover(vetSec - arrSec);
        if (roll.suspicious) {
            return { level: 'warn', text: `Pulzusidő: ${toTimeStr(roll.diff)} — szokatlanul távolinak tűnik az előző eseményhez képest. Ellenőrizd, nem gépeltél-e el egy számjegyet, mielőtt mented.` };
        }
        let rec = roll.diff;
        const limitSec = isFinalLap ? 1200 : 900;
        const limitMin = isFinalLap ? 20 : 15;
        if (rec > limitSec) {
            return { level: 'danger', text: `Pulzusidő: ${toTimeStr(rec)} — túllépte a ${limitMin} perces limitet (97. § (2)). LP kód megfontolandó.` };
        }
        if (rec > 600) {
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

        const idx = getActiveLapIndex(comp, raceConfig);
        const l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        const arrSec = toSec(l.h, l.m, l.s);
        const vetSec = toSec(document.getElementById('bk-v-h').value, document.getElementById('bk-v-m').value, document.getElementById('bk-v-s').value);

        const baseDist = comp.dist.replace('j', '');
        const cfg = raceConfig[baseDist] || { laps: [] };
        const expectedLaps = cfg.laps ? cfg.laps.length : 1;
        const isFinalLap = (idx === expectedLaps - 1);

        renderWarningBanner('orv-ido-recovery-warning', getRecoveryWarning(arrSec, vetSec, isFinalLap));
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
        const idx = getActiveLapIndex(comp, raceConfig);
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

        const live = document.getElementById('liveCountdownContainer');
        
        // ÚJ: Az óra frissül, ha az Élő fülön vagyunk VAGY ha nyitva van a TV mód!
        const isEloRajtokActive = document.getElementById('elo-rajtok').classList.contains('active');
        const isFullscreenActive = document.getElementById('fullscreenLiveOverlay')?.classList.contains('active');
        if (!isEloRajtokActive && !isFullscreenActive) return;
        
        const now = new Date(); const nowS = now.getHours()*3600 + now.getMinutes()*60 + now.getSeconds();

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
            html += `<div class="live-item"><div><b>#${item.comp.bib} ${item.comp.name}</b><br><small>${item.label}: ${toTimeStr(item.nextStart)}</small></div><div class="live-time ${blinkClass}">${formatLiveTime(d)}</div></div>`;
        });
        live.innerHTML = html || '<div style="text-align:center; padding:20px;">Nincs várakozó.</div>';
        const fullscreenContent = document.getElementById('fullscreenLiveContent');
        if (fullscreenContent && document.getElementById('fullscreenLiveOverlay')?.classList.contains('active')) {
            fullscreenContent.innerHTML = live.innerHTML;
        }
    }, 1000);

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

    function getCompLiveStatus(c, config) {
        if (c.isEliminated) return { text: getElimText(c), color: "var(--danger)", textCol: "#fff" };

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
            return { text: "Körön van", color: "var(--primary)", textCol: "#fff" };
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

        return { text: "Körön van", color: "var(--primary)", textCol: "#fff" };
    }

    function calculateCurrentRanks(comps, config) {
        let ranksInfo = {};
        ["20", "40", "60", "80", "80j", "100", "100j"].forEach(dist => {
            let catComps = comps.filter(c => c.dist === dist);
            catComps.sort((a, b) => {
                if (a.isEliminated && !b.isEliminated) return 1;
                if (!a.isEliminated && b.isEliminated) return -1;

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
                
                return aTime - bTime;
            });
            
            catComps.forEach((c, index) => {
                let gapStr = "";
                let lastLapIndex = (c.laps || []).filter(l => l.isComplete).length - 1;
                if (lastLapIndex >= 0 && !c.isEliminated) {
                    let sameLapComps = catComps.filter(x => x.laps && x.laps[lastLapIndex] && x.laps[lastLapIndex].isComplete);
                    
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
                let rank = c.isEliminated ? "Kiesett" : (c.manualEntry && c.manualPlace ? c.manualPlace : (index + 1));
                ranksInfo[c.bib] = { rank: rank, gapStr: gapStr };
            });
        });
        return ranksInfo;
    }

    function getActiveCategories(comps, config) {
        let active = [];
        ["100", "100j", "80", "80j", "60", "40", "20"].forEach(d => {
            let hasComp = comps.some(c => c.dist === d);
            let baseDist = d.replace('j','');
            let hasConfig = config[baseDist] && config[baseDist].h !== '';
            if (hasComp || (!d.includes('j') && hasConfig)) active.push(d);
        });
        return active;
    }

    function setAdatlapFilter(filter) { currentAdatlapFilter = filter; renderAdatlapList(); }

    function openCatSwapModal() {
        const ctx = getAdatlapContext();
        let activeCats = getActiveCategories(ctx.comps, ctx.config);
        let html = "";
        activeCats.forEach(cat => {
            html += `<button class="calc-btn" style="background:var(--teal); color:white; padding:12px; margin-top:0;" onclick="closeCatSwapModal(); setAdatlapFilter('${cat}')">${catNames[cat]}</button>`;
        });
        html += `<button class="calc-btn" style="background:#e0e0e0; color:#000; margin-top:20px; padding:10px;" onclick="closeCatSwapModal()">Bezárás</button>`;
        document.getElementById('catSwapModalBody').innerHTML = html;
        document.getElementById('catSwapModal').style.display = 'flex';
    }

    function closeCatSwapModal() { document.getElementById('catSwapModal').style.display = 'none'; }

    function renderAdatlapList() {
        const ctx = getAdatlapContext();
        const cont = document.getElementById('adatlapList'); 

        let titleEl = document.getElementById('adatlapok-title');
        titleEl.innerText = "📊 " + (viewingPastRaceData ? ctx.name + " Eredményei" : "Versenyzői Adatlapok");

        let activeCats = getActiveCategories(ctx.comps, ctx.config);

        if (!currentAdatlapFilter || currentAdatlapFilter === 'all') {
            let html = `<div style="display:flex; flex-direction:column; gap:10px; margin-top:0;">`;
            if (activeCats.length === 0) { html += `<p style="text-align:center; color:var(--text-dim);">Még nincs beállított kategória vagy versenyző.</p>`; } 
            else { activeCats.forEach(cat => { html += `<button class="calc-btn" style="background:var(--teal); color:white; font-size:1.2rem; padding:20px; margin-top:0;" onclick="setAdatlapFilter('${cat}')">${catNames[cat]}</button>`; }); }
            cont.innerHTML = html + `</div>`;
        } else {
            let catComps = ctx.comps.filter(c => c.dist === currentAdatlapFilter);
            let total = catComps.length;
            let elim = catComps.filter(c => c.isEliminated).length;
            let qual = 0;
            catComps.forEach(c => {
                if (c.isEliminated) return;
                let baseDist = c.dist.replace('j', '');
                let expectedLaps = (ctx.config[baseDist] && ctx.config[baseDist].laps) ? ctx.config[baseDist].laps.length : 3;
                let completed = (c.laps || []).filter(l => l.isComplete).length;
                if (completed >= expectedLaps) qual++;
            });

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
        let html = '';
        if (hasMax) html += `<span class="inline-flag danger">⚠ SP</span>`;
        if (hasMin) html += `<span class="inline-flag warning">⚠ OT</span>`;
        return html;
    }

    function renderAdatlapItems(ctx) {
        const cont = document.getElementById('adatlapItemsContainer'); if(!cont) return; cont.innerHTML = '';
        let filtered = ctx.comps.filter(c => c.dist === currentAdatlapFilter);
        let ranksInfo = calculateCurrentRanks(ctx.comps, ctx.config);

        filtered.sort((a,b) => {
            if (a.isEliminated && !b.isEliminated) return 1;
            if (!a.isEliminated && b.isEliminated) return -1;
            if (!a.isEliminated && !b.isEliminated) { return (ranksInfo[a.bib]?.rank || 999) - (ranksInfo[b.bib]?.rank || 999); }
            return parseInt(a.bib) - parseInt(b.bib);
        });

        filtered.forEach(c => {
            let info = ranksInfo[c.bib] || { rank: "-", gapStr: "" };
            let rankStr = info.rank; let rankClass = c.isEliminated ? "kiesett" : "";
            let rankDisplay = c.isEliminated ? "ELIM" : rankStr + "º";
            let gapHtml = info.gapStr ? `<div class="adatlap-gap">Trail by ${info.gapStr}</div>` : '';
            let speedStr = ""; let speedFlagHtml = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
            if (completedLaps.length > 0) {
                let lastLap = completedLaps[completedLaps.length - 1];
                speedStr = `Avg. ${lastLap.rideSpd.toFixed(2)} km/h`;
                // Admin állítja be távonként (Beállítások fül): max -> SP kockázat, min -> OT kockázat
                speedFlagHtml = getSpeedFlagBadgesHtml(c, completedLaps);
            }
            let speedHtml = speedStr ? `<div class="adatlap-speed-badge">${speedStr}</div>` : '';

            let statusObj = getCompLiveStatus(c, ctx.config);
            let liveStatusHtml = `<span class="adatlap-live-status" style="background:${statusObj.color}; color:${statusObj.textCol||'#fff'};">${statusObj.text}</span>`;

            cont.innerHTML += `
            <div class="adatlap-card" onclick="openAdatlap('${c.bib}')">
                <div class="adatlap-rank ${rankClass}">${rankDisplay}</div>
                <div class="adatlap-info">
                    <div class="adatlap-name-row"><span class="adatlap-bib">${c.bib}</span> <span class="adatlap-name">${c.name}</span> ${liveStatusHtml}</div>
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

    function openAdatlap(bib, isPast = false) {
        const ctx = getAdatlapContext();
        const c = ctx.comps.find(comp => comp.bib == bib); if(!c) return;

        // IDEIGLENES: "Gyors eredmény" (kör-/időadatok nélküli, kézzel rögzített helyezés) esetén
        // nincs kör-bontás amit meg lehetne jeleníteni - helyette egy egyszerű összefoglaló kártya.
        if (c.manualEntry) {
            const placeStr = c.isEliminated ? getElimText(c) : (c.manualPlace ? c.manualPlace + '. hely' : 'nincs rögzített helyezés');
            document.getElementById('modalBody').innerHTML = `
                <div style="background:#111; padding:0; border-radius:12px; color:#fff; width: 100%; max-width: 500px; margin: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow:hidden;">
                    <div style="background: var(--teal); color: #fff; padding: 20px; text-align: center;">
                        <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 5px;">${c.bib} | ${c.name}</div>
                        <div style="font-size: 1.5rem; font-weight: 900; text-transform: uppercase;">${c.internal || "Ló neve hiányzik"}</div>
                        <div style="margin-top: 15px; display: inline-block; background: rgba(0,0,0,0.25); padding: 6px 18px; border-radius: 8px; font-size: 1rem; color: #fff;">
                            🏁 <b>Táv:</b> ${catNames[c.dist] || (c.dist + ' km')}
                        </div>
                    </div>
                    <div style="padding: 24px; text-align:center;">
                        <p style="color:#aaa; font-size:0.82rem; margin-bottom:18px;">⚡ Gyorsan rögzített eredmény - nincsenek részletes kör-/időadatok.</p>
                        <div style="font-size:2rem; font-weight:900; color:#fff; margin-bottom:8px;">${placeStr}</div>
                        ${c.totalTimeSec ? `<div style="color:#ddd; font-size:1.1rem;">Teljes menetidő: <b>${toTimeStr(c.totalTimeSec)}</b></div>` : ''}
                        ${c.club ? `<div style="color:#888; font-size:0.9rem; margin-top:10px;">${c.club}</div>` : ''}
                    </div>
                    <div style="text-align:center; padding: 15px 20px 20px 20px; background: #111; display:flex; flex-direction:column; align-items:center; gap:10px;">
                        <button class="admin-only" style="width:auto; padding:8px 22px; border-radius:20px; border:none; cursor:pointer; font-weight:800; font-size:0.85rem; background:${c.obPont !== false ? 'var(--success)' : 'var(--card-3)'}; color:${c.obPont !== false ? 'black' : '#ddd'};" onclick="toggleObPont('${c.bib}')">${c.obPont !== false ? '🏆 OB-pontra jogosult' : '🚫 OB-pontról lemondva'} (kattints a váltáshoz)</button>
                        <button class="calc-btn" style="width:auto; padding:10px 40px; border-radius:25px; background:#1c1c1e; color:#fff; border: 1px solid #333; font-weight:bold; font-size: 1.1rem; cursor:pointer; margin-top:0;" onclick="closeAdatlap()">Bezárás</button>
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
        }

        let html = `
            <div style="background:#111; padding:0; border-radius:12px; color:#fff; width: 100%; max-width: 900px; margin: auto; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow:hidden;">
                
                <div style="background: var(--teal); color: #fff; padding: 20px; text-align: center; position: relative;">
                    <div style="font-size: 1.1rem; font-weight: bold; margin-bottom: 5px;">${c.bib} | ${c.name}</div>
                    <div style="font-size: 1.5rem; font-weight: 900; text-transform: uppercase;">${c.internal || "Ló neve hiányzik"}</div>
                    
                    <div style="margin-top: 15px; display: inline-block; background: rgba(0,0,0,0.25); padding: 6px 18px; border-radius: 8px; font-size: 1rem; color: #fff;">
                        <span style="margin-right:20px;">🏁 <b>Táv:</b> ${distName}</span>
                        <span>⏱ <b>Rajtidő:</b> ${rajTidoStr}</span>
                    </div>
                </div>
                
                <div style="padding: 20px; overflow-x: auto;">
                    <table style="width:100%; border-collapse: collapse; text-align:center; font-size:0.95rem; font-family: sans-serif;">
                        <tr style="background:var(--teal); color:#fff;">
                            <th style="padding:12px; border-bottom:2px solid #fff; text-align:left; width:25%;">Szakasz</th>
        `;
        
        phases.forEach((_,i) => html += `<th style="padding:12px; border-bottom:2px solid #fff;">${i+1}. KÖR</th>`);
        html += `</tr>`;

        const renderDataRow = (label, valueFn) => {
            let row = `<tr style="border-bottom: 3px solid #272729; background: #18181a;"><td style="padding:10px; text-align:left; font-weight:bold; color:#fff; background:#111;">${label}</td>`;
            phases.forEach((l, i) => { row += `<td style="padding:10px; color:#ddd;">${valueFn(l, i)}</td>`; });
            row += `</tr>`; return row;
        };

        html += renderDataRow('Táv (km)', l => `<b style="background:#242426; color:#fff; padding:2px 6px; border:1px solid #3a3a3c; border-radius:4px;">${l.d || '-'}</b>`);
        html += renderDataRow('Rajt', l => l.startSec > 0 ? toTimeStr(l.startSec) : "-");
        html += renderDataRow('Beérkezés', l => l.arrSec > 0 ? toTimeStr(l.arrSec) : "-");
        html += renderDataRow('Kör idő', l => l.loopSec > 0 ? toTimeStr(l.loopSec) : "-");
        html += renderDataRow('Kör átlag km/h', l => l.loopSpd > 0 ? `<span style="${l.loopSpd >= 16 ? 'color:var(--danger);font-weight:bold;' : 'color:#ddd;'}">${l.loopSpd.toFixed(2)}</span>` : "-");
        html += renderDataRow('Orvosi (Vet)', l => {
            if (!l.isComplete) return "-";
            if (is20km && l.vetSec > 0) return toTimeStr(l.loopSec + l.pulzusSec);
            return l.vetSec > 0 ? toTimeStr(l.vetSec) : "-";
        });
        html += renderDataRow('Pulzus idő', l => l.pulzusSec > 0 ? toTimeStr(l.pulzusSec) : "-");
        html += renderDataRow('Orvosi átlag km/h', l => l.phaseSpd > 0 ? `<span style="${l.phaseSpd >= 16 ? 'color:var(--danger);font-weight:bold;' : 'color:#ddd;'}">${l.phaseSpd.toFixed(2)}</span>` : "-");
        html += renderDataRow('Össz. menetidő', (l, i) => {
            if (!l.isComplete) return "-";
            let finalLap = i === phases.length - 1;
            if (is20km && finalLap && l.vetSec > 0) {
                return `<b style="color:#fff;">${toTimeStr(l.loopSec + l.pulzusSec)}</b>`;
            }
            return l.rideTime > 0 ? `<b style="color:#fff;">${toTimeStr(l.rideTime)}</b>` : "-";
        });
        html += renderDataRow('Össz. átlag km/h', (l, i) => {
            if (!l.isComplete) return "-";
            let anySpeedingSoFar = phases.slice(0, i + 1).some(p => p.loopSpd >= 16 || p.phaseSpd >= 16);
            let isWarning = anySpeedingSoFar || l.rideSpd >= 16;
            return l.rideSpd > 0 ? `<b style="${isWarning ? 'color:var(--danger);' : 'color:#fff;'}">${l.rideSpd.toFixed(2)}</b>` : "-";
        });
        html += renderDataRow('Helyezés', (l, i) => ranks[i] === `<span style="color:var(--danger); font-weight:bold;">Kiesett</span>` ? ranks[i] : (ranks[i] ? `<b style="color:#fff;">${ranks[i]}.</b>` : "-"));
        html += renderDataRow('Lemaradás', (l, i) => gaps[i] ? `<span style="color:#ddd;">${gaps[i]}</span>` : "-");

        html += `
                    </table>
                </div>
                <div style="text-align:center; padding: 15px 20px 20px 20px; background: #111; display:flex; flex-direction:column; align-items:center; gap:10px;">
                    <button class="admin-only" style="width:auto; padding:8px 22px; border-radius:20px; border:none; cursor:pointer; font-weight:800; font-size:0.85rem; background:${c.obPont !== false ? 'var(--success)' : 'var(--card-3)'}; color:${c.obPont !== false ? 'black' : '#ddd'};" onclick="toggleObPont('${c.bib}')" title="Bajnoki (OB) pontszerzésre jogosult-e ez a versenyző - ha lemond, ennek a versenynek az eredménye nem számít bele az egyéni bajnokságba">${c.obPont !== false ? '🏆 OB-pontra jogosult' : '🚫 OB-pontról lemondva'} (kattints a váltáshoz)</button>
                    <button class="calc-btn" style="width:auto; padding:10px 40px; border-radius:25px; background:#1c1c1e; color:#fff; border: 1px solid #333; font-weight:bold; font-size: 1.1rem; cursor:pointer; margin-top:0;" onclick="closeAdatlap()">Bezárás</button>
                </div>
            </div>`;
        
        document.getElementById('modalBody').innerHTML = html; 
        document.getElementById('adatlapModal').style.display = 'flex';
    }

    function closeAdatlap() { document.getElementById('adatlapModal').style.display = 'none'; }

    // --- ESZKÖZÖK ---
    function calcReszido() {
        const d = parseFloat(document.getElementById('dist1').value);
        const t1 = toSec(document.getElementById('rh1').value, document.getElementById('rm1').value, document.getElementById('rs1').value);
        const t2 = toSec(document.getElementById('rh2').value, document.getElementById('rm2').value, document.getElementById('rs2').value);
        if(!d || t1 === 0 || t2 === 0) return;
        const roll = resolveRollover(t2 - t1);
        const diff = roll.diff;
        const spd = d / (diff / 3600); const nextStart = (t2 + 2400) % 86400;
        const warnHtml = roll.suspicious
            ? `<div class="warning-banner level-warn" style="margin-top:0; margin-bottom:12px;"><span class="wb-icon">⚠️</span><span>Ez az idő szokatlanul távolinak tűnik - ellenőrizd, nem gépeltél-e el egy számjegyet.</span></div>`
            : '';
        document.getElementById('res1').style.display = 'block';
        document.getElementById('res1').innerHTML = `${warnHtml}Átlagsebesség: <b style="color:${spd>=16.0?'var(--warning)':'var(--success)'}">${spd.toFixed(2)} km/h</b><br>Menetidő: <b>${toTimeStr(diff)}</b><br><br><span style="color:var(--text-dim)">Kimeneteli idő (40p pihenő): <b style="color:white;">${toTimeStr(nextStart)}</b></span>`;
    }

    function calcMinosites() {
        const d = parseFloat(document.getElementById('distJ').value);
        const t1 = toSec(document.getElementById('jh1').value, document.getElementById('jm1').value, document.getElementById('js1').value);
        if(!d || t1 === 0) return;
        document.getElementById('res3').style.display = 'block';
        document.getElementById('res3').innerHTML = `Szükséges beérkezési idő:<br><strong style="font-size:1.8rem; color:var(--success);">${toTimeStr(t1 + Math.ceil(d / (CALC_LIMIT / 3600)))}</strong>`;
    }

    // --- TÖMEGES IMPORTÁLÁS FELUGRÓ ABLAKKAL ---
    function importCompetitorsFromPrompt(isModal) {
        // A böngésző saját beviteli ablakát dobja fel
        const jsonText = prompt("Kérlek, másold be ide (Ctrl+V vagy jobb klikk -> Beillesztés) a JSON kódot:");
        
        // Ha a Mégse gombra nyomott, vagy üresen hagyta
        if (!jsonText || jsonText.trim() === "") {
            return; 
        }

        try {
            const data = JSON.parse(jsonText.trim());
            const compsToImport = data.competitors ? data.competitors : data;
            
            if (!compsToImport || Object.keys(compsToImport).length === 0) {
                showToast("A kód üres vagy nem tartalmaz versenyzőket!", true);
                return;
            }

            let dbRef;
            if (isModal) {
                if (!modalRaceId) {
                    showToast("Hiba: Előbb mentsd el a verseny alapadatait!", true);
                    return;
                }
                const type = document.getElementById('rm-type').value || 'jovo';
                dbRef = db.ref('races/' + type + '/' + modalRaceId + '/competitors');
            } else {
                dbRef = db.ref('competitors');
            }

            dbRef.update(compsToImport).then(() => {
                showToast(`Sikeres importálás: ${Object.keys(compsToImport).length} versenyző hozzáadva!`);
                if (isModal) updateRmCompetitorDisplays();
            }).catch(err => {
                showToast("Hiba az adatbázis feltöltésekor: " + err.message, true);
            });

        } catch (err) {
            showToast("Hibás a kód! Biztos, hogy az egészet (a { } zárójelekkel együtt) kimásoltad?", true);
        }
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
                .url-box { font-size: 3rem; font-weight: 900; margin-top: 20px; color: #000000; display: inlrgb(0, 0, 0)block; padding: 15px 40px; border-radius: 15px; letter-spacing: 2px; }
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
        tavlovas: { label: 'Magyar Távlovas Bajnokság', sub: '80–160 km, felnőtt', distKeys: ['80', '100'], maxHorses: 2 },
        rovid:    { label: 'Magyar Rövidtávú Távlovas Bajnokság', sub: '40–60 km, bármilyen korú', distKeys: ['40', '60'], maxHorses: 2 },
        junior:   { label: 'Magyar Junior Bajnokság', sub: '80–120 km, junior', distKeys: ['80j', '100j'], maxHorses: 2 },
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
                rows.push({
                    raceId: race.id, raceDate: race.date || '', raceName: race.name, isObRound: !!race.isObRound,
                    bib: c.bib, name: c.name, license: c.license || '', club: c.club || '',
                    startNum: c.startNum || '', horseName: c.internal || '',
                    dist: c.dist, km: parseInt(baseDist, 10),
                    completedKm: getCompletedKm(c, cfg), place: place, isEliminated: !!c.isEliminated,
                    status: c.status || (c.isEliminated ? 'FTQ-ME' : 'Active'), extraCodes: c.extraCodes || [],
                    obPont: c.obPont !== false
                });
            });
        });
        return rows;
    }

    // --- TÖRZSADATOK: lovas/ló profil (összes eddigi versenyeredmény - nem csak OB-forduló, ez egy
    // személyes előzmény-nézet, nem bajnoki számítás) ---
    function getRiderHistory(license) {
        return getAllPastRaceRows().filter(r => r.license === license).sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || ''));
    }

    function getHorseHistory(startNum) {
        return getAllPastRaceRows().filter(r => r.startNum === startNum).sort((a, b) => (b.raceDate || '').localeCompare(a.raceDate || ''));
    }

    function renderProfileHistoryTable(history, mode) {
        if (!history.length) return `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs rögzített versenyeredmény.</p>`;
        let html = `<div class="table-responsive"><table class="ttrack-table"><tr>
            <th class="col-header" style="text-align:left;">Dátum</th>
            <th class="col-header" style="text-align:left;">Verseny</th>
            <th class="col-header">Táv</th>
            <th class="col-header" style="text-align:left;">${mode === 'rider' ? 'Ló' : 'Lovas'}</th>
            <th class="col-header">Eredmény</th>
        </tr>`;
        history.forEach(r => {
            const finished = !r.isEliminated && r.place != null;
            const resultStr = finished ? `${r.place}. hely` : getElimText({ isEliminated: true, status: r.status, extraCodes: r.extraCodes });
            const other = mode === 'rider' ? (r.horseName || '-') : r.name;
            html += `<tr>
                <td style="text-align:left; white-space:nowrap;">${r.raceDate || '-'}</td>
                <td style="text-align:left; font-weight:700;">${r.raceName || '-'}</td>
                <td>${catNames[r.dist] || r.dist}</td>
                <td style="text-align:left;">${other}</td>
                <td><b style="color:${finished ? 'var(--primary)' : 'var(--danger)'};">${resultStr}</b></td>
            </tr>`;
        });
        html += `</table></div>`;
        return html;
    }

    // Az adatlapModal generikus üres tartalmát (#modalBody) használja - ugyanaz a modal, mint az
    // openAdatlap()-nál, csak más tartalommal, hogy ne kelljen új modal-markupot felvenni.
    function openRiderProfile(license) {
        const rider = ridersCache[sanitizeKey(license)] || {};
        const history = getRiderHistory(license);
        document.getElementById('modalBody').innerHTML = `
            <div style="text-align:center; margin-bottom:15px;">
                <h3 style="color:var(--primary); margin:0;">${rider.name || license}</h3>
                <p style="color:var(--text-dim); margin-top:4px;">${rider.club ? rider.club + ' · ' : ''}Ig. szám: ${license}</p>
            </div>
            ${renderProfileHistoryTable(history, 'rider')}
        `;
        document.getElementById('adatlapModal').style.display = 'flex';
    }

    function openHorseProfile(startNum) {
        const horse = horsesCache[sanitizeKey(startNum)] || {};
        const history = getHorseHistory(startNum);
        document.getElementById('modalBody').innerHTML = `
            <div style="text-align:center; margin-bottom:15px;">
                <h3 style="color:var(--primary); margin:0;">${horse.name || startNum}</h3>
                <p style="color:var(--text-dim); margin-top:4px;">Start szám: ${startNum}</p>
            </div>
            ${renderProfileHistoryTable(history, 'horse')}
        `;
        document.getElementById('adatlapModal').style.display = 'flex';
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

    // A "K" előtaggal kezdődő igazolási szám külföldi versenyzőt jelöl (l. felhasználói megerősítés) -
    // az egyéni bajnokság kizárólag a magyar versenyzőknek szól, még ha egy külföldi vendég be is
    // fut egy hazai OB-fordulón.
    function isForeignLicense(license) {
        return /^\s*K/i.test(license || '');
    }

    // --- 1. EGYÉNI BAJNOKSÁG (3 osztály, "legkorábban nevezett N ló" szabály + 174.§(3) dedup) ---
    // Csak magyar versenyzőkre vonatkozik - a külföldiek (K-előtagú igazolási szám) kimaradnak.
    function computeIndividualChampionship(classKey, year) {
        const cls = CHAMPIONSHIP_CLASSES[classKey];
        const win = getChampionshipWindow(year);
        const rows = getAllPastRaceRows().filter(r =>
            r.isObRound && cls.distKeys.includes(r.dist) && r.obPont && r.place != null && isDateInWindow(r.raceDate, win) && !isForeignLicense(r.license)
        );

        const byRider = {};
        rows.forEach(r => {
            const key = r.license || ('bib:' + r.bib + ':' + r.name);
            if (!byRider[key]) byRider[key] = { license: r.license, name: r.name, club: r.club, results: [] };
            byRider[key].results.push(r);
            if (r.name) byRider[key].name = r.name;
            if (r.club) byRider[key].club = r.club;
        });

        const riders = Object.values(byRider).map(rider => {
            const byHorse = {};
            rider.results.forEach(r => {
                const hKey = r.startNum || ('horse:' + r.horseName);
                if (!byHorse[hKey]) byHorse[hKey] = { startNum: r.startNum, horseName: r.horseName, results: [], firstDate: r.raceDate };
                byHorse[hKey].results.push(r);
                if (r.raceDate && r.raceDate < byHorse[hKey].firstDate) byHorse[hKey].firstDate = r.raceDate;
            });
            const horsesSorted = Object.values(byHorse).sort((a, b) => (a.firstDate || '').localeCompare(b.firstDate || ''));
            const usedHorses = horsesSorted.slice(0, cls.maxHorses);
            const excludedHorseCount = horsesSorted.length - usedHorses.length;

            let totalPoints = 0;
            const horseBreakdown = usedHorses.map(h => {
                // 174. § (3): azonos verseny, azonos táv-kategória két futamánál csak a jobbik pont számít
                const byRaceCat = {};
                h.results.forEach(r => {
                    const rcKey = r.raceId + '|' + r.dist;
                    const pts = getPoints(getPointBand(r.completedKm), r.place);
                    if (!byRaceCat[rcKey] || pts > byRaceCat[rcKey].points) byRaceCat[rcKey] = Object.assign({ points: pts }, r);
                });
                const dedupedResults = Object.values(byRaceCat).sort((a, b) => (a.raceDate || '').localeCompare(b.raceDate || ''));
                const horsePoints = dedupedResults.reduce((s, r) => s + r.points, 0);
                totalPoints += horsePoints;
                return { startNum: h.startNum, horseName: h.horseName, points: horsePoints, results: dedupedResults };
            });

            return { license: rider.license, name: rider.name, club: rider.club, totalPoints, horses: horseBreakdown, excludedHorseCount };
        });

        riders.sort((a, b) => b.totalPoints - a.totalPoints);
        return riders;
    }

    // Összesített nézet: mindhárom bajnoki osztály eredményét egyetlen ranglistába vonja össze
    // (osztály-szűrés nélkül) - egy lovas, aki több osztályban is szerzett pontot, összesítve
    // szerepel, a classBreakdown mutatja, honnan jött a pontja.
    function computeIndividualChampionshipAll(year) {
        const merged = {};
        Object.keys(CHAMPIONSHIP_CLASSES).forEach(classKey => {
            computeIndividualChampionship(classKey, year).forEach(r => {
                const key = r.license || r.name;
                if (!merged[key]) merged[key] = { license: r.license, name: r.name, club: r.club, totalPoints: 0, classBreakdown: [] };
                merged[key].totalPoints += r.totalPoints;
                if (r.name) merged[key].name = r.name;
                if (r.club) merged[key].club = r.club;
                merged[key].classBreakdown.push({ classKey, label: CHAMPIONSHIP_CLASSES[classKey].label, points: r.totalPoints });
            });
        });
        return Object.values(merged).sort((a, b) => b.totalPoints - a.totalPoints);
    }

    // --- 2. LÓ-RANGLISTA (a lo-lovas-integracio.md törzsadatára épül - minden kategóriájú verseny számít) ---
    function computeHorseRanking(year) {
        const win = getChampionshipWindow(year);
        const byHorse = {};

        getAllPastRaceRows().filter(r => isDateInWindow(r.raceDate, win) && r.completedKm > 0 && r.startNum).forEach(r => {
            if (!byHorse[r.startNum]) byHorse[r.startNum] = { startNum: r.startNum, horseName: r.horseName, totalKm: 0, raceCount: 0, clubs: {}, lastRider: '', lastDate: '' };
            const e = byHorse[r.startNum];
            e.totalKm += r.completedKm;
            e.raceCount += 1;
            if (r.horseName) e.horseName = r.horseName;
            if (r.club) e.clubs[r.club] = (e.clubs[r.club] || 0) + r.completedKm;
            if (r.raceDate >= e.lastDate) { e.lastDate = r.raceDate; e.lastRider = r.name; }
        });

        // Külföldi (externalResults) eredmények is beszámítanak, ha ismert a ló azonosítója (l. terv 3.4).
        Object.values(externalResultsCache).filter(ex => ex.horseStartNum && isDateInWindow(ex.date, win)).forEach(ex => {
            const km = parseFloat(ex.distanceKm) || 0;
            if (km <= 0) return;
            if (!byHorse[ex.horseStartNum]) {
                const h = horsesCache[sanitizeKey(ex.horseStartNum)] || {};
                byHorse[ex.horseStartNum] = { startNum: ex.horseStartNum, horseName: h.name || ex.horseStartNum, totalKm: 0, raceCount: 0, clubs: {}, lastRider: '', lastDate: '' };
            }
            const e = byHorse[ex.horseStartNum];
            e.totalKm += km;
            e.raceCount += 1;
            const riderInfo = ridersCache[sanitizeKey(ex.license)] || {};
            if (riderInfo.club) e.clubs[riderInfo.club] = (e.clubs[riderInfo.club] || 0) + km;
            if (ex.date >= e.lastDate) { e.lastDate = ex.date; e.lastRider = riderInfo.name || ex.license; }
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
    function computeTeamChampionship(year) {
        const win = getChampionshipWindow(year);
        const rows = getAllPastRaceRows();

        // Ki "OB-jogosult" ebben az időszakban: legalább egyszer elindult hazai ob-fordulón, >= 40 km-en
        // (visszamenőleg is teljesülhet - l. terv 3.3, ezért a teljes időszakot előre összegyűjtjük).
        const obParticipants = new Set();
        rows.filter(r => isDateInWindow(r.raceDate, win) && r.isObRound && r.km >= 40 && r.license).forEach(r => obParticipants.add(r.license));

        const homeQualified = rows.filter(r => isDateInWindow(r.raceDate, win) && r.km >= 40 && r.place != null && r.license && obParticipants.has(r.license));
        const externalQualified = Object.values(externalResultsCache).filter(e => isDateInWindow(e.date, win) && e.license && obParticipants.has(e.license));

        const teams = Object.entries(teamsCache).map(([teamId, t]) => {
            const members = t.memberLicenses || [];
            let totalKm = 0;
            const memberBreakdown = members.map(lic => {
                const homeKm = homeQualified.filter(r => r.license === lic).reduce((s, r) => s + r.completedKm, 0);
                const extKm = externalQualified.filter(e => e.license === lic).reduce((s, e) => s + (parseFloat(e.distanceKm) || 0), 0);
                const km = Math.round((homeKm + extKm) * 100) / 100;
                totalKm += km;
                const riderInfo = ridersCache[sanitizeKey(lic)] || {};
                return { license: lic, name: riderInfo.name || lic, km, isObQualified: obParticipants.has(lic) };
            });
            return { teamId, name: t.name, contact: t.contact || '', totalKm: Math.round(totalKm * 100) / 100, members: memberBreakdown };
        });

        teams.sort((a, b) => b.totalKm - a.totalKm);
        return teams;
    }

    // --- RENDER: Egyéni bajnokság ---
    let egyeniClassKey = 'tavlovas';
    let egyeniYear = new Date().getFullYear();

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

        const clubView = document.getElementById('egyeni-club-toggle')?.checked;
        const isAll = egyeniClassKey === 'osszesitett';
        const riders = isAll ? computeIndividualChampionshipAll(egyeniYear) : computeIndividualChampionship(egyeniClassKey, egyeniYear);

        let html;
        if (isAll) {
            html = `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;"><h4 style="margin:0; color:var(--text);">Összesített ranglista</h4><p class="field-hint" style="margin-bottom:0;">Mindhárom bajnoki osztály (Távlovas, Rövidtávú, Junior) összpontjai egyben, osztály-szűrés nélkül - mindenki rajta van, akinek van pontja.</p></div>`;
        } else {
            const cls = CHAMPIONSHIP_CLASSES[egyeniClassKey];
            html = `<div class="kiiras-card" style="border-left-color:var(--primary); margin-top:0;"><h4 style="margin:0; color:var(--text);">${cls.label}</h4><p class="field-hint" style="margin-bottom:0;">${cls.sub} · legfeljebb ${cls.maxHorses} ló pontjai számítanak lovasonként · csak magyar versenyzők (K-jelű igazolási számok kimaradnak)</p></div>`;
        }

        if (riders.length === 0) {
            html += `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még pontszerző eredmény ${isAll ? 'erre az évre' : 'ebben az osztályban erre az évre'}.</p>`;
        } else if (clubView) {
            const clubs = computeClubBreakdownPoints(riders);
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Összpont</th></tr>`;
            clubs.forEach((c, i) => { html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${c.club}</td><td><b>${c.points}</b></td></tr>`; });
            html += `</table></div>`;
        } else if (isAll) {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Lovas</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Összpont</th><th class="col-header">Osztályok</th></tr>`;
            riders.forEach((r, i) => {
                const clsStr = r.classBreakdown.map(c => `${c.label.replace('Magyar ', '').replace(' Bajnokság', '')}: ${c.points} p`).join(', ');
                html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${r.name}</td><td style="text-align:left; color:var(--text-dim);">${r.club || '-'}</td><td><b style="color:var(--primary);">${r.totalPoints}</b></td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${clsStr}</td></tr>`;
            });
            html += `</table></div>`;
        } else {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Lovas</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Pont</th><th class="col-header">Lovak</th></tr>`;
            riders.forEach((r, i) => {
                const horseStr = r.horses.map(h => `${h.horseName || '?'} (${h.points} p)`).join(', ');
                const excl = r.excludedHorseCount > 0 ? ` <span style="color:var(--text-dim-2); font-size:0.78rem;">(+${r.excludedHorseCount} ló nem számít)</span>` : '';
                html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${r.name}</td><td style="text-align:left; color:var(--text-dim);">${r.club || '-'}</td><td><b style="color:var(--primary);">${r.totalPoints}</b></td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${horseStr}${excl}</td></tr>`;
            });
            html += `</table></div>`;
        }
        cont.innerHTML = html;
    }

    // --- RENDER: Ló-ranglista ---
    let loYear = new Date().getFullYear();

    function renderLoRanglista() {
        const yearSel = document.getElementById('lo-year-select');
        if (yearSel && yearSel.options.length === 0) populateYearSelect('lo-year-select', loYear);
        if (yearSel) loYear = parseInt(yearSel.value, 10) || loYear;

        const horses = computeHorseRanking(loYear);
        const cont = document.getElementById('lo-ranglista-content');
        if (!cont) return;
        const clubView = document.getElementById('lo-club-toggle')?.checked;

        let html = '';
        if (horses.length === 0) {
            html = `<p style="text-align:center; color:var(--text-dim); padding:20px 0;">Nincs még rögzített teljesítés erre az évre.</p>`;
        } else if (clubView) {
            const clubs = computeClubBreakdownKm(horses);
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Egyesület</th><th class="col-header">Össz. km</th></tr>`;
            clubs.forEach((c, i) => { html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${c.club}</td><td><b>${c.km}</b></td></tr>`; });
            html += `</table></div>`;
        } else {
            html += `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Ló</th><th class="col-header">Össz. km</th><th class="col-header">Rajtok</th><th class="col-header" style="text-align:left;">Utoljára</th></tr>`;
            horses.forEach((h, i) => {
                html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${h.horseName || '?'} <span style="color:var(--text-dim-2); font-size:0.78rem;">#${h.startNum}</span></td><td><b style="color:var(--primary);">${h.totalKm}</b></td><td>${h.raceCount}</td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${h.lastRider || '-'}</td></tr>`;
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

        let html = `<div class="table-responsive"><table class="ttrack-table"><tr><th class="col-header">#</th><th class="col-header" style="text-align:left;">Csapat</th><th class="col-header">Össz. km</th><th class="col-header" style="text-align:left;">Tagok</th></tr>`;
        teams.forEach((t, i) => {
            const memberStr = t.members.map(m => `${m.name} (${m.km} km)${m.isObQualified ? '' : ' ⚠️'}`).join(', ');
            html += `<tr><td>${i + 1}.</td><td style="text-align:left; font-weight:700;">${t.name}</td><td><b style="color:var(--primary);">${t.totalKm}</b></td><td style="text-align:left; font-size:0.85rem; color:var(--text-dim);">${memberStr}</td></tr>`;
        });
        html += `</table></div><p class="field-hint">⚠️ = a tag ebben az időszakban még nem indult hazai OB-fordulón legalább 40 km-en, ezért egyelőre nem jogosult a csapatpontra (visszamenőleg pótolható).</p>`;
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

    function saveExternalResult() {
        const license = document.getElementById('ext-license').value.trim();
        const horseStartNum = document.getElementById('ext-horseStartNum').value.trim();
        const raceName = document.getElementById('ext-raceName').value.trim();
        const country = document.getElementById('ext-country').value.trim();
        const date = document.getElementById('ext-date').value;
        const distanceKm = parseFloat(document.getElementById('ext-distanceKm').value);
        const place = parseInt(document.getElementById('ext-place').value, 10);

        if (!license) { showToast('Válassz lovast a listából!', true); return; }
        if (!raceName || !date || !distanceKm) { showToast('Verseny neve, dátum és táv megadása kötelező!', true); return; }

        const data = {
            license, horseStartNum: horseStartNum || null, raceName, country, date,
            distanceKm, place: isNaN(place) ? null : place,
            enteredBy: (auth.currentUser && auth.currentUser.uid) || 'ismeretlen', enteredAt: Date.now()
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
        document.getElementById('ext-rider-search').value = riderInfo.name ? `${riderInfo.name} — ${ex.license}` : ex.license;
        document.getElementById('ext-license').value = ex.license;
        if (ex.horseStartNum) {
            const h = horsesCache[sanitizeKey(ex.horseStartNum)] || {};
            document.getElementById('ext-horse-search').value = h.name ? `${h.name} — ${ex.horseStartNum}` : ex.horseStartNum;
            document.getElementById('ext-horseStartNum').value = ex.horseStartNum;
        }
        document.getElementById('ext-raceName').value = ex.raceName || '';
        document.getElementById('ext-country').value = ex.country || '';
        document.getElementById('ext-date').value = ex.date || '';
        document.getElementById('ext-distanceKm').value = ex.distanceKm || '';
        document.getElementById('ext-place').value = ex.place || '';
        document.getElementById('ext-cancel-btn').style.display = 'block';
        window.scrollTo(0, 0);
    }

    function cancelExternalEdit() {
        editingExternalId = null;
        ['ext-rider-search', 'ext-license', 'ext-horse-search', 'ext-horseStartNum', 'ext-raceName', 'ext-country', 'ext-date', 'ext-distanceKm', 'ext-place'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
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
            return `<div class="competitor-item">
                <div style="flex:1;"><b>${riderInfo.name || ex.license}</b> — ${ex.raceName} <span style="color:var(--text-dim);">(${ex.country || '?'}, ${ex.date})</span><br>
                <span style="color:var(--text-dim); font-size:0.85rem;">${ex.distanceKm} km${ex.place ? ', ' + ex.place + '. hely' : ''}</span></div>
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

    // --- ÉV TENYÉSZTŐJE - placeholder (l. terv 5.) ---
    // (a tenyésztő adata még nincs eltárolva a ló-törzsben, ez egy későbbi kiegészítés lesz)

    window.onload = function() {
        let savedMode = localStorage.getItem('currentMode') || 'versenyek';
        if (savedMode === 'terv') savedMode = 'versenyek';
        switchSidebarMode(savedMode, document.getElementById('btn-menu-' + savedMode));

        initAutocompleteFields('');     // élő nevezési form
        initAutocompleteFields('rm');    // múltbéli/jövőbeli verseny szerkesztő modal
        // initAutocompleteFields('rm-gy'); // IDEIGLENES "Gyors eredmény" fül - kikapcsolva

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
        });
    };