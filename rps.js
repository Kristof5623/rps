
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
            db.ref('/').once('value').then(snap => {
                let data = snap.val() || {};
                let sourceRace = data.races && data.races[fromType] && data.races[fromType][id];
                if (sourceRace) {
                    let updates = {};
                    updates['races/' + toType + '/' + id] = sourceRace;
                    updates['races/' + fromType + '/' + id] = null;
                    db.ref('/').update(updates).then(() => {
                        showToast("Verseny sikeresen áthelyezve!");
                    }).catch(e => showToast("Hiba az áthelyezéskor: " + e.message, true));
                }
            });
        });
    }

    function forceMoveToLive(sourceType, id) {
        showConfirm("Verseny Élesítése", "Biztosan ÉLŐ-be teszed ezt a versenyt?\n(A jelenlegi élő futam automatikusan lezárul és átkerül a múltba!)", () => {
            db.ref('/').once('value').then(snap => {
                let data = snap.val() || {};
                let updates = {};
                
                if (data.liveRaceMeta) {
                    let oldId = data.liveRaceMeta.id || Date.now().toString();
                    updates['races/mult/' + oldId] = {
                        id: oldId, name: data.liveRaceMeta.name, loc: data.liveRaceMeta.loc, date: data.liveRaceMeta.date, desc: data.liveRaceMeta.desc || "",
                        raceConfig: data.raceConfig || getEmptyRaceConfig(),
                        competitors: data.competitors || null
                    };
                }
                
                let sourceRace = data.races && data.races[sourceType] && data.races[sourceType][id];
                if (sourceRace) {
                    updates['liveRaceMeta'] = { id: sourceRace.id, name: sourceRace.name, loc: sourceRace.loc, date: sourceRace.date, desc: sourceRace.desc || "" };
                    updates['raceConfig'] = sourceRace.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = sourceRace.competitors || null;
                    updates['races/' + sourceType + '/' + id] = null;
                }
                
                db.ref('/').update(updates).then(() => { 
                    showToast("🚀 Verseny sikeresen ÉLŐ-be mozgatva!");
                    switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'));
                }).catch(e => showToast("Hiba a mozgatáskor: " + e.message, true));
            });
        });
    }

    function forceMoveToPastFromLive() {
        showConfirm("Verseny Lezárása", "Biztosan a Múltbéli versenyek közé rakod a jelenlegi ÉLŐ versenyt?", () => {
            db.ref('/').once('value').then(snap => {
                let data = snap.val() || {};
                if (!data.liveRaceMeta) return;
                
                let oldId = data.liveRaceMeta.id || Date.now().toString();
                let updates = {};
                
                updates['races/mult/' + oldId] = {
                    id: oldId, name: data.liveRaceMeta.name, loc: data.liveRaceMeta.loc, date: data.liveRaceMeta.date, desc: data.liveRaceMeta.desc || "",
                    raceConfig: data.raceConfig || getEmptyRaceConfig(),
                    competitors: data.competitors || null
                };
                
                updates['liveRaceMeta'] = null;
                updates['raceConfig'] = getEmptyRaceConfig();
                updates['competitors'] = null;
                
                db.ref('/').update(updates).then(() => { 
                    showToast("Verseny sikeresen lezárva és átmozgatva a Múltba!"); 
                    switchMainTab('versenyek', document.getElementById('btn-menu-versenyek'));
                }).catch(e => showToast("Hiba a lezáráskor: " + e.message, true));
            });
        });
    }

    function runAutoMigration() {
        db.ref('/').once('value').then(snap => {
            let data = snap.val() || {};
            let today = new Date().toISOString().split('T')[0];
            let meta = data.liveRaceMeta || null;
            let jovo = (data.races && data.races.jovo) ? data.races.jovo : {};
            
            let updates = {};
            let needsUpdate = false;

            if (meta && meta.date < today) {
                let id = meta.id || Date.now().toString();
                updates['races/mult/' + id] = {
                    id: id, name: meta.name, loc: meta.loc, date: meta.date, desc: meta.desc || "",
                    raceConfig: data.raceConfig || getEmptyRaceConfig(),
                    competitors: data.competitors || {}
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
                    updates['liveRaceMeta'] = { id: r.id, name: r.name, loc: r.loc, date: r.date, desc: r.desc || "" };
                    updates['raceConfig'] = r.raceConfig || getEmptyRaceConfig();
                    updates['competitors'] = r.competitors || {};
                    updates['races/jovo/' + toMoveId] = null;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                db.ref('/').update(updates).then(() => console.log("✅ Automatikus verseny migráció sikeresen lefutott!"));
            }
        });
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

        localRaces.mult.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(r => {
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
        
        if(!comps || comps.length === 0) {
            showToast("Nincs exportálható adat ebben a versenyben!", true);
            return;
        }

        let csvContent = "\uFEFF"; 
        let activeCats = getActiveCategories(comps, config);
        let ranksInfo = calculateCurrentRanks(comps, config);
        
        activeCats.forEach((cat, index) => {
            let catNameStr = catNames[cat]; 
            
            csvContent += `"${race.name}";;;;;;;;;;;;\n`;
            csvContent += `"${index + 1}.vrsz.-${catNameStr}-es verseny";;;;;;;;;;;;\n`;
            csvContent += `;;;;;;;;;;;\;\n`;
            csvContent += `"www.tavlovasok.hu";;;;;;;;;;;;\n`;
            csvContent += `"Elbírálás: Távlovaglás";;;;;;;;;;;;\n`;
            csvContent += `;;;;;;;;;;;\;\n`;
            csvContent += `;;;;;;;;;;;\;\n`;
            
            let header1 = ["Igazolási szám", "Versenyző", "Rajtszám", "Ló", "Egyesület", "Kategória", "_", "Hely", "Végeredmény", "", "", "", ""];
            let header2 = ["", "", "", "", "", "", "", "", "Idő", "Büntetőpont", "Megj.", "Sárgalap", "Pihenőnap"];

            csvContent += header1.map(v => `"${v}"`).join(";") + "\n";
            csvContent += header2.map(v => `"${v}"`).join(";") + "\n";
            
            let catComps = comps.filter(c => c.dist === cat);
            
            catComps.sort((a,b) => {
                if (a.isEliminated && !b.isEliminated) return 1;
                if (!a.isEliminated && b.isEliminated) return -1;
                if (!a.isEliminated && !b.isEliminated) { return (ranksInfo[a.bib]?.rank || 999) - (ranksInfo[b.bib]?.rank || 999); }
                return parseInt(a.bib) - parseInt(b.bib);
            });
            
            catComps.forEach(c => {
                let rankStr = ranksInfo[c.bib]?.rank || "-";
                let isKiesett = c.isEliminated || rankStr === "Kiesett";
                
                let totalTimeStr = "-";
                let megjStr = isKiesett ? "WD" : "0"; 
                
                let completedLaps = (c.laps || []).filter(l => l.isComplete);
                if (completedLaps.length > 0 && !isKiesett) {
                    let lastLap = completedLaps[completedLaps.length - 1];
                    let s = lastLap.rideTime;
                    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sc = s % 60;
                    totalTimeStr = String(h).padStart(2, '0') + ":" + String(m).padStart(2, '0') + ":" + String(sc).padStart(2, '0');
                } else if (isKiesett) {
                    totalTimeStr = "visszalépet"; 
                }

                let kategoria = "Nyitott";
                if (cat.includes('j')) { kategoria = "Junior"; }
                else if (parseInt(cat) >= 80) { kategoria = "Felnőtt"; }

                let row = [
                    "", // Igazolási szám
                    c.name,
                    c.bib, 
                    c.internal || "",
                    "", // Egyesület
                    kategoria,
                    "", // _
                    isKiesett ? "0" : rankStr,
                    totalTimeStr,
                    "0", // Büntetőpont
                    megjStr,
                    "0", // Sárgalap
                    "12" // Pihenőnap alapértelmezett
                ];
                
                csvContent += row.map(v => `"${v}"`).join(";") + "\n";
            });
            csvContent += `;;;;;;;;;;;\;\n`; 
            csvContent += `;;;;;;;;;;;\;\n`; 
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        
        let safeName = (race.name || "Eredmenyek").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        link.setAttribute("download", safeName + "_hivatalos_export.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast("Eredmények sikeresen exportálva!");
    }

    // --- LISTÁK (Múlt / Jövő / Jelenlegi) ---
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
                <div class="race-card-title">${liveRaceMeta.name} <span style="color:var(--success); font-size:0.8rem;">(ÉLŐ FUTAM)</span></div>
                <div class="race-card-date">${liveRaceMeta.date} | Helyszín: ${liveRaceMeta.loc}</div>
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                    <button class="calc-btn admin-only" style="padding:10px; margin-top:0; font-size:0.9rem;" onclick="switchMainTab('fo-mod', document.getElementById('btn-menu-fomod'))">Ugrás az ÉLŐ Kezelőhöz</button>
                    <button class="calc-btn admin-only" style="padding:10px; margin-top:0; font-size:0.9rem; background:var(--danger); color:white;" onclick="forceMoveToPastFromLive()">🛑 Lezárás (Múltbélivé tétel)</button>
                </div>
            </div>`;
        } else {
            jelenCont.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-dim);">Nincs futó automatikus verseny.</div>';
        }

        localRaces.mult.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).forEach(r => {
            multCont.innerHTML += `
            <div class="race-card" style="border-left-color: #666;">
                <div class="race-card-title">${r.name}</div>
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
                <div class="race-card-title">${r.name}</div>
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
                let rankStr = info.rank; let rankClass = rankStr === "Kiesett" ? "kiesett" : ""; let rankDisplay = rankStr === "Kiesett" ? "Kiesett" : rankStr + "º";
                let gapHtml = info.gapStr ? `<div class="adatlap-gap">Lemaradás: ${info.gapStr}</div>` : '';
                let speedStr = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
                if (completedLaps.length > 0) { speedStr = `Avg. ${completedLaps[completedLaps.length - 1].rideSpd.toFixed(2)} km/h`; }
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
                    <div class="adatlap-right"><div class="adatlap-arrow">❯</div></div>
                    <div class="adatlap-badges">${gapHtml}${speedHtml}</div>
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
        } else {
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
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
            }
        } else {
            document.getElementById('rm-name').value = '';
            document.getElementById('rm-loc').value = '';
            document.getElementById('rm-date').value = '';
            document.getElementById('rm-desc').value = '';
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
            id: id, name: name, loc: document.getElementById('rm-loc').value, date: document.getElementById('rm-date').value, desc: document.getElementById('rm-desc').value
        };
        
        db.ref('races/' + type + '/' + id).update(raceData).then(() => {
            document.getElementById('rm-id').value = id;
            modalRaceId = id; 
            document.getElementById('rm-tab-btn-kiiras').style.display = 'block';
            document.getElementById('rm-tab-btn-versenyzok').style.display = 'block';
            document.getElementById('rm-tab-btn-verseny').style.display = type === 'jovo' ? 'none' : 'block';
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
            const selectedBib = document.getElementById('rm-selectCompetitor').value;
            const activeEl = document.activeElement;
            const isInputFocused = activeEl && activeEl.tagName === 'INPUT' && document.getElementById('rm-verseny').contains(activeEl);
            if (selectedBib && !isInputFocused) { loadRmCompetitorData(); }
        });
    }

    function detachModalFirebaseListeners() {
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

        // ÚJ: Itt már hiba nélkül tudja menteni az összes adatot
        const newComp = { bib: bib, name: name, dist: dist, internal: internal, startNum: startNum, license: license, club: club, startTime: existingData.startTime, laps: existingData.laps, isEliminated: existingData.isEliminated };
        db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + bib).set(newComp).then(() => {
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

        document.getElementById('rm-compStatusToggle').checked = !comp.isEliminated;
        updateStatusLabel('rm-compStatusToggle', 'rm-compStatusLabel');

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

        let comp = modalCompetitors.find(c => c.bib == bib);
        if (comp) {
            comp.startTime = { h: document.getElementById('rm-vhR').value, m: document.getElementById('rm-vmR').value, s: document.getElementById('rm-vsR').value };
            comp.isEliminated = !document.getElementById('rm-compStatusToggle').checked; 
            for(let i=0; i<count; i++) {
                if(!comp.laps) comp.laps = [];
                if(!comp.laps[i]) comp.laps[i] = {};
                comp.laps[i].d = document.getElementById(`rm-vd${i+1}`).value;
                comp.laps[i].h = document.getElementById(`rm-vh${i+1}`).value;
                comp.laps[i].m = document.getElementById(`rm-vm${i+1}`).value;
                comp.laps[i].s = document.getElementById(`rm-vs${i+1}`).value;
                comp.laps[i].oh = document.getElementById(`rm-voh${i+1}`).value;
                comp.laps[i].om = document.getElementById(`rm-vom${i+1}`).value;
                comp.laps[i].os = document.getElementById(`rm-vos${i+1}`).value;
            }
        }

        if(rajt === 0) { document.getElementById('rm-res2').style.display='none'; return; }
        
        comp = recalcCompetitorData(comp, modalRaceConfig);
        let html = "";
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
                html += `<div class="summary-total">
                    <strong style="color:var(--primary); font-size:1.1rem; display:block; margin-bottom:8px;">Összesített statisztika</strong>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:white;">${toTimeStr(lastComplete.rideTime)}</b></div>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. átlagsebesség:</span> <b style="font-size:1.3rem; color:${avgColor}">${lastComplete.rideSpd.toFixed(2)} km/h</b></div>
                </div>`;
            }
        }
        document.getElementById('rm-res2').style.display='block'; document.getElementById('rm-res2').innerHTML = html;
        if (comp) {
            const type = document.getElementById('rm-type').value;
            const cleanComp = JSON.parse(JSON.stringify(comp)); 
            db.ref('races/' + type + '/' + modalRaceId + '/competitors/' + comp.bib).set(cleanComp);
        }
        showAnimatedBtn('rm-btn-kiertel-mentes');
    }

    // --- ÚJ SZEREPKÖR FUNKCIÓK (RECALC DATA KÖZÖS MOTOR) ---
    function recalcCompetitorData(comp, config) {
        if (!comp) return comp;
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
            
            let loopTime = arr - curStart;
            if (loopTime <= 0) loopTime += 86400;
            
            let phaseTime; let pulzusTime = 0;
            if (isFinalLap) {
                phaseTime = loopTime;
                if(vet > 0) pulzusTime = vet - arr < 0 ? vet - arr + 86400 : vet - arr;
            } else {
                phaseTime = vet > 0 ? (vet - curStart <= 0 ? vet - curStart + 86400 : vet - curStart) : loopTime;
                pulzusTime = vet > 0 ? (vet - arr < 0 ? vet - arr + 86400 : vet - arr) : 0;
            }
            
            l.loopSec = loopTime;
            l.phaseSec = phaseTime; 
            l.pulzusSec = pulzusTime;
            l.loopSpd = l.d / (loopTime/3600); 
            l.phaseSpd = l.d / (phaseTime/3600);
            
            totalPure += phaseTime;
            totalD += l.d;
            l.rideTime = totalPure; 
            l.rideSpd = totalD / (totalPure/3600);
            l.nextStart = (vet > 0 ? vet : arr) + 2400; 
            
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
        let comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getActiveLapIndex(comp, raceConfig);
        if(!comp.laps) comp.laps = [];
        if(!comp.laps[idx]) comp.laps[idx] = {};
        
        comp.laps[idx].h = document.getElementById('bk-h').value;
        comp.laps[idx].m = document.getElementById('bk-m').value;
        comp.laps[idx].s = document.getElementById('bk-s').value;
        
        comp = recalcCompetitorData(comp, raceConfig);
        db.ref('competitors/' + comp.bib).set(comp).then(() => {
            showAnimatedBtn('btn-bk-mentes');
            document.getElementById('sel-beerkeztetes').value = '';
            document.getElementById('beerkeztetes-form').style.display = 'none';
            refreshVersenyTabIfNeeded(comp.bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }
    
    // --- ORVOSI IDŐ MÓD ---
    function loadOrvosiIdoData() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        const form = document.getElementById('orvosi-ido-form');
        if(!bib) { form.style.display = 'none'; return; }
        
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
    }

    function saveOrvosiIdoData() {
        const bib = document.getElementById('sel-orvosi-ido').value;
        let comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getActiveLapIndex(comp, raceConfig);
        if(!comp.laps) comp.laps = [];
        if(!comp.laps[idx]) comp.laps[idx] = {};
        
        comp.laps[idx].oh = document.getElementById('bk-v-h').value;
        comp.laps[idx].om = document.getElementById('bk-v-m').value;
        comp.laps[idx].os = document.getElementById('bk-v-s').value;
        
        comp = recalcCompetitorData(comp, raceConfig);
        db.ref('competitors/' + comp.bib).set(comp).then(() => {
            showAnimatedBtn('btn-bk-vet-mentes');
            document.getElementById('sel-orvosi-ido').value = '';
            document.getElementById('orvosi-ido-form').style.display = 'none';
            refreshVersenyTabIfNeeded(comp.bib);
        }).catch(e => showToast("Hiba: " + e.message, true));
    }

    // --- ORVOSI MÓD ---
    function loadOrvosiData() {
        const bib = document.getElementById('sel-orvosi').value;
        const form = document.getElementById('orvosi-form');
        if(!bib) { form.style.display = 'none'; return; }
        
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;
        
        let idx = getActiveLapIndex(comp, raceConfig);
        let l = (comp.laps && comp.laps[idx]) ? comp.laps[idx] : {};
        document.getElementById('orv-lap-title').innerText = `${idx + 1}. Kör Orvosi Vizsgálata`;
        
        if(l.h && l.h !== '') {
            document.getElementById('orv-arr-time').innerText = `Beérkezés: ${toTimeStr(toSec(l.h, l.m, l.s))} (Rögzítve)`;
            document.getElementById('orv-arr-time').style.color = 'var(--success)';
        } else {
            document.getElementById('orv-arr-time').innerText = `Versenyző még a pályán van! (Nincs beérkezési idő)`;
            document.getElementById('orv-arr-time').style.color = 'var(--warning)';
        }

        if(l.oh && l.oh !== '') {
            document.getElementById('orv-vet-time').innerText = `Orvosi idő: ${toTimeStr(toSec(l.oh, l.om, l.os))} (Rögzítve)`;
            document.getElementById('orv-vet-time').style.color = 'var(--primary)';
        } else {
            document.getElementById('orv-vet-time').innerText = `Orvosi idő még nincs rögzítve!`;
            document.getElementById('orv-vet-time').style.color = 'var(--warning)';
        }

        document.getElementById('orv-pulse').value = l.pulse || '';
        document.getElementById('orv-notes').value = l.vetNotes || '';
        
        form.style.display = 'block';
    }

    function saveOrvosiData() {
        const bib = document.getElementById('sel-orvosi').value;
        let comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let idx = getActiveLapIndex(comp, raceConfig);
        if(!comp.laps) comp.laps = [];
        if(!comp.laps[idx]) comp.laps[idx] = {};
        
        comp.laps[idx].pulse = document.getElementById('orv-pulse').value;
        comp.laps[idx].vetNotes = document.getElementById('orv-notes').value;
        
        comp = recalcCompetitorData(comp, raceConfig);
        db.ref('competitors/' + comp.bib).set(comp).then(() => {
            showAnimatedBtn('btn-orv-mentes');
            document.getElementById('sel-orvosi').value = '';
            document.getElementById('orvosi-form').style.display = 'none';
        }).catch(e => showToast("Hiba: " + e.message, true));
    }

    // --- NYOMTATÁS MÓD ---
    function loadNyomtatasData() {
        const bib = document.getElementById('sel-nyomtatas').value;
        const form = document.getElementById('nyomtatas-form');
        if(!bib) { form.style.display = 'none'; return; }
        
        const comp = competitors.find(c => c.bib == bib);
        if(!comp) return;

        let phases = (comp.laps || []).filter(l => l.isComplete);
        let html = `
            <div style="border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 10px;">
                <h2 style="margin:0 0 5px 0;">#${comp.bib} - ${comp.name}</h2>
                <div style="font-size:1.1rem;">Ló neve: <b>${comp.internal || "Nincs megadva"}</b></div>
                <div style="font-size:1rem;">Kategória: <b>${catNames[comp.dist]}</b></div>
            </div>
        `;
        if (phases.length === 0) {
            html += `<p>Még nincs befejezett kör.</p>`;
        } else {
            phases.forEach((l, i) => {
                html += `
                <div style="margin-bottom: 15px; padding: 10px; border: 1px dashed #666; border-radius: 8px;">
                    <h4 style="margin: 0 0 5px 0; font-size: 1.1rem;">${i+1}. Szakasz</h4>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span>Kör idő: <b>${toTimeStr(l.loopSec)}</b></span>
                        <span>Sebesség: <b>${l.loopSpd.toFixed(2)} km/h</b></span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span>Beérkezés: <b>${toTimeStr(l.arrSec)}</b></span>
                        <span>Orvosi (Vet): <b>${l.vetSec > 0 ? toTimeStr(l.vetSec) : '-'}</b></span>
                    </div>
                    <div style="background:#eee; padding:5px; border-radius:5px; margin-top:5px; font-weight:bold;">
                        Pulzus: ${l.pulse || '-'} bpm &nbsp;|&nbsp; Értékelés: ${l.vetNotes || '-'}
                    </div>
                </div>`;
            });
            let last = phases[phases.length - 1];
            html += `
            <div style="background:#000; color:#fff; padding:10px; border-radius:8px; margin-top:15px;">
                <h3 style="margin:0 0 5px 0;">Összesített Eredmény</h3>
                <div>Menetidő: <b>${toTimeStr(last.rideTime)}</b></div>
                <div>Átlagsebesség: <b>${last.rideSpd.toFixed(2)} km/h</b></div>
                <div>Státusz: <b>${comp.isEliminated ? 'KIESETT' : 'VERSENYBEN'}</b></div>
            </div>`;
        }

        document.getElementById('print-sticker').innerHTML = html;
        form.style.display = 'block';
    }
// --- FŐ ÉLŐ VERSENY FUNKCIÓK ---
    function updateStatusLabel(toggleId = 'compStatusToggle', labelId = 'compStatusLabel') {
        const toggle = document.getElementById(toggleId);
        const label = document.getElementById(labelId);
        if (toggle.checked) {
            label.innerText = "Versenyben"; label.style.color = "var(--success)";
        } else {
            label.innerText = "Kiesett"; label.style.color = "var(--danger)";
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

        const newComp = { bib: bib, name: name, dist: dist, internal: internal, startNum: startNum, license: license, club: club, startTime: existingData.startTime, laps: existingData.laps, isEliminated: existingData.isEliminated };
        db.ref('competitors/' + bib).set(newComp).then(() => {
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

        document.getElementById('compStatusToggle').checked = !comp.isEliminated;
        updateStatusLabel('compStatusToggle', 'compStatusLabel');

        const baseDist = comp.dist.replace('j', '');
        const cfg = raceConfig[baseDist] || { h:'', m:'', s:'', laps:[] };

        document.getElementById('vhR').value = comp.startTime.h || cfg.h;
        document.getElementById('vmR').value = comp.startTime.m || cfg.m;
        document.getElementById('vsR').value = comp.startTime.s || cfg.s;

        const lapsArr = comp.laps || [];
        lapsArr.forEach((l, i) => {
            const idx = i + 1;
            if(document.getElementById(`vd${idx}`)) {
                document.getElementById(`vd${idx}`).value = l.d || '';
                document.getElementById(`vh${idx}`).value = l.h || ''; document.getElementById(`vm${idx}`).value = l.m || ''; document.getElementById(`vs${idx}`).value = l.s || '';
                document.getElementById(`voh${idx}`).value = l.oh || ''; document.getElementById(`vom${idx}`).value = l.om || ''; document.getElementById(`vos${idx}`).value = l.os || '';
            }
        });
        if(lapsArr.length === 0) {
            (cfg.laps || []).forEach((ld, i) => { if(document.getElementById(`vd${i+1}`)) document.getElementById(`vd${i+1}`).value = ld; });
        }
        calcVerseny(false);
    }
 
 
    function calcVerseny(saveToDb = true) {
        const count = parseInt(document.getElementById('lapCount').value);
        const bib = document.getElementById('selectCompetitor').value;
        const rajt = toSec(document.getElementById('vhR').value, document.getElementById('vmR').value, document.getElementById('vsR').value);

        let comp = competitors.find(c => c.bib == bib);
        if (comp) {
            comp.startTime = { h: document.getElementById('vhR').value, m: document.getElementById('vmR').value, s: document.getElementById('vsR').value };
            comp.isEliminated = !document.getElementById('compStatusToggle').checked; 

            for(let i=0; i<count; i++) {
                if(!comp.laps) comp.laps = [];
                if(!comp.laps[i]) comp.laps[i] = {};
                comp.laps[i].d = document.getElementById(`vd${i+1}`).value;
                comp.laps[i].h = document.getElementById(`vh${i+1}`).value;
                comp.laps[i].m = document.getElementById(`vm${i+1}`).value;
                comp.laps[i].s = document.getElementById(`vs${i+1}`).value;
                comp.laps[i].oh = document.getElementById(`voh${i+1}`).value;
                comp.laps[i].om = document.getElementById(`vom${i+1}`).value;
                comp.laps[i].os = document.getElementById(`vos${i+1}`).value;
            }
        }

        if(rajt === 0) { document.getElementById('res2').style.display='none'; return; }

        // Futtatjuk a közös kalkulátort
        comp = recalcCompetitorData(comp, raceConfig);

        let html = "";
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
                html += `<div class="summary-total">
                    <strong style="color:var(--primary); font-size:1.1rem; display:block; margin-bottom:8px;">Összesített statisztika</strong>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. menetidő:</span> <b style="font-size:1.3rem; color:white;">${toTimeStr(lastComplete.rideTime)}</b></div>
                    <div class="plan-data-row"><span class="plan-data-label">Össz. átlagsebesség:</span> <b style="font-size:1.3rem; color:${avgColor}">${lastComplete.rideSpd.toFixed(2)} km/h</b></div>
                </div>`;
            }
        }

        document.getElementById('res2').style.display='block'; document.getElementById('res2').innerHTML = html;

        if (saveToDb && comp) {
            const cleanComp = JSON.parse(JSON.stringify(comp)); 
            db.ref('competitors/' + comp.bib).set(cleanComp);
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
        const clockEl = document.getElementById('liveClockText');
        if(clockEl) { clockEl.innerText = new Date().toLocaleTimeString('hu-HU', { hour12: false }); }

        const live = document.getElementById('liveCountdownContainer');
        if(!document.getElementById('elo-rajtok').classList.contains('active')) return;
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
            const activeMode = document.querySelector('.mode-content.active');
            if (activeMode?.id === 'elo-rajtok') {
                enterLiveFullscreen();
                e.preventDefault();
                return;
            }
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
        if (c.isEliminated) return { text: "Kiesett", color: "var(--danger)", textCol: "#fff" };

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
            return { text: "Finished", color: "var(--success)", textCol: "#000" };
        }

        if (last.arrSec > 0 && (!last.vetSec || last.vetSec === 0)) {
            return { text: "Megérkezett", color: "var(--warning)", textCol: "#000" };
        }

        if (last.nextStart && last.nextStart > nowSec) {
            return { text: "Várakozik", color: "var(--warning)", textCol: "#000" };
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
                let aLaps = (a.laps || []).filter(l => l.isComplete).length;
                let bLaps = (b.laps || []).filter(l => l.isComplete).length;
                if (aLaps !== bLaps) return bLaps - aLaps;
                let aTime = aLaps > 0 ? a.laps[aLaps-1].rideTime : 0;
                let bTime = bLaps > 0 ? b.laps[bLaps-1].rideTime : 0;
                return aTime - bTime;
            });
            catComps.forEach((c, index) => {
                let gapStr = "";
                let lastLapIndex = (c.laps || []).filter(l => l.isComplete).length - 1;
                if (lastLapIndex >= 0 && !c.isEliminated) {
                    let sameLapComps = catComps.filter(x => x.laps && x.laps[lastLapIndex] && x.laps[lastLapIndex].isComplete);
                    let bestTime = Math.min(...sameLapComps.map(x => x.laps[lastLapIndex].rideTime));
                    let gap = c.laps[lastLapIndex].rideTime - bestTime;
                    if (gap > 0) gapStr = "+" + toTimeStr(gap);
                }
                ranksInfo[c.bib] = { rank: c.isEliminated ? "Kiesett" : (index + 1), gapStr: gapStr };
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
            if (hasComp || hasConfig) active.push(d);
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
            let rankStr = info.rank; let rankClass = rankStr === "Kiesett" ? "kiesett" : ""; let rankDisplay = rankStr === "Kiesett" ? "Kiesett" : rankStr + "º";
            let gapHtml = info.gapStr ? `<div class="adatlap-gap">Trail by ${info.gapStr}</div>` : '';
            let speedStr = ""; let completedLaps = (c.laps || []).filter(l => l.isComplete);
            if (completedLaps.length > 0) { speedStr = `Avg. ${completedLaps[completedLaps.length - 1].rideSpd.toFixed(2)} km/h`; }
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
                <div class="adatlap-right"><div class="adatlap-arrow">❯</div></div>
                <div class="adatlap-badges">${gapHtml}${speedHtml}</div>
            </div>`;
        });
    }

    function openAdatlap(bib) {
        const ctx = getAdatlapContext();
        const c = ctx.comps.find(comp => comp.bib == bib); if(!c) return;
        let phases = (c.laps || []).filter(l => l.isComplete);
        let sameCatComps = ctx.comps.filter(x => x.dist === c.dist);
        let ranksHtml = ""; let gapsHtml = "";

        phases.forEach((l, i) => {
            let phaseComps = sameCatComps.filter(x => x.laps && x.laps[i] && x.laps[i].isComplete);
            phaseComps.sort((a, b) => a.laps[i].rideTime - b.laps[i].rideTime);
            let rank = phaseComps.findIndex(x => x.bib == c.bib) + 1;
            let gap = l.rideTime - phaseComps[0].laps[i].rideTime; 
            ranksHtml += `<td style="font-weight:bold;">${rank}.</td>`;
            gapsHtml += `<td style="color:${gap===0?'var(--success)':'#FF9F0A'};">${gap===0 ? '-' : '+'+toTimeStr(gap)}</td>`;
        });

        if (c.isEliminated && phases.length > 0) {
            let rankCells = ranksHtml.split('</td>'); rankCells[phases.length - 1] = `<td style="color:var(--danger); font-weight:bold;">Kiesett`; ranksHtml = rankCells.join('</td>');
        }

        let html = `<h3>#${c.bib} ${c.name} (${catNames[c.dist]})</h3><div class="table-responsive"><table class="ttrack-table"><tr><th class="row-header">Szakasz</th>`;
        phases.forEach((_,i) => html += `<th class="col-header">${i+1}.</th>`);

        html += `</tr><tr><th class="row-header">Táv (km)</th>`; phases.forEach(l => html += `<td>${l.d}</td>`);

        html += `</tr><tr><th class="row-header">Kör idő</th>`; phases.forEach(l => html += `<td>${toTimeStr(l.loopSec || 0)}</td>`);

        html += `</tr><tr><th class="row-header">Beérkezés</th>`; phases.forEach(l => html += `<td>${toTimeStr(l.arrSec)}</td>`);
        html += `</tr><tr><th class="row-header">Kör átlag km/h</th>`; phases.forEach(l => html += `<td class="${l.loopSpd>=16?'warning-speed':'highlight-speed'}">${l.loopSpd.toFixed(2)}</td>`);

        html += `</tr><tr><th class="row-header">Orvosi (Vet)</th>`;
        phases.forEach((l) => {
            html += `<td>${l.vetSec>0 ? toTimeStr(l.vetSec) : "-"}</td>`;
        });

        html += `</tr><tr><th class="row-header">Pulzus idő</th>`; phases.forEach(l => html += `<td>${l.pulzusSec>0?toTimeStr(l.pulzusSec):"-"}</td>`);
        html += `</tr><tr><th class="row-header">Össz. menetidő</th>`; phases.forEach(l => html += `<td>${toTimeStr(l.rideTime)}</td>`);
        html += `</tr><tr><th class="row-header">Össz. átlag km/h</th>`; phases.forEach((l, i) => {
            let anySpeedingSoFar = phases.slice(0, i + 1).some(p => p.loopSpd >= 16 || p.phaseSpd >= 16);
            let isWarning = anySpeedingSoFar || l.rideSpd >= 16;
            html += `<td class="${isWarning ? 'warning-speed' : 'highlight-speed'}">${l.rideSpd.toFixed(2)}</td>`;
        });
        html += `</tr><tr><th class="row-header">Helyezés</th>${ranksHtml}</tr><tr><th class="row-header">Lemaradás</th>${gapsHtml}</tr></table></div>`;
        document.getElementById('modalBody').innerHTML = html; document.getElementById('adatlapModal').style.display = 'flex';
    }

    function closeAdatlap() { document.getElementById('adatlapModal').style.display = 'none'; }

    // --- ESZKÖZÖK ---
    function calcReszido() {
        const d = parseFloat(document.getElementById('dist1').value);
        const t1 = toSec(document.getElementById('rh1').value, document.getElementById('rm1').value, document.getElementById('rs1').value);
        const t2 = toSec(document.getElementById('rh2').value, document.getElementById('rm2').value, document.getElementById('rs2').value);
        if(!d || t1 === 0 || t2 === 0) return;
        let diff = t2 - t1; if(diff <= 0) diff += 86400;
        const spd = d / (diff / 3600); const nextStart = t2 + 2400;
        document.getElementById('res1').style.display = 'block';
        document.getElementById('res1').innerHTML = `Átlagsebesség: <b style="color:${spd>=16.0?'var(--warning)':'var(--success)'}">${spd.toFixed(2)} km/h</b><br>Menetidő: <b>${toTimeStr(diff)}</b><br><br><span style="color:var(--text-dim)">Kimeneteli idő (40p pihenő): <b style="color:white;">${toTimeStr(nextStart)}</b></span>`;
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
    
    window.onload = function() {
        let savedMode = localStorage.getItem('currentMode') || 'versenyek';
        if (savedMode === 'terv') savedMode = 'versenyek'; 
        switchSidebarMode(savedMode, document.getElementById('btn-menu-' + savedMode));
    };
