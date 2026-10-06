// End-Ride service worker - csak az értesítésekhez és a telepíthetőséghez (alkalmazásként a
// telefon kezdőképernyőjére). SZÁNDÉKOSAN NEM gyorsítótáraz semmit (nincs fetch-kezelő): az oldal
// mindig a hálózatról jön, így soha nem ragad be egy régi verzió.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Értesítésre kattintva a már nyitott End-Ride fül kerül előre, ha nincs ilyen, újat nyit.
self.addEventListener('notificationclick', e => {
    e.notification.close();
    const cel = (e.notification.data && e.notification.data.url) || self.registration.scope;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
        const nyitott = lista.find(c => c.url.startsWith(self.registration.scope));
        if (nyitott) return nyitott.focus();
        return self.clients.openWindow(cel);
    }));
});

// Később (szerveroldali küldéshez, pl. Firebase Cloud Messaging): a beérkező üzenet megjelenítése
// akkor is, ha az oldal nincs nyitva.
self.addEventListener('push', e => {
    let adat = {};
    try { adat = e.data ? e.data.json() : {}; } catch (x) { adat = { title: 'End-Ride', body: e.data ? e.data.text() : '' }; }
    const n = adat.notification || adat;
    e.waitUntil(self.registration.showNotification(n.title || 'End-Ride', {
        body: n.body || '',
        icon: 'kepek/ikon-192.png',
        badge: 'kepek/ikon-96.png',
        tag: n.tag || undefined,
        data: { url: n.url || (adat.data && adat.data.url) || self.registration.scope }
    }));
});
