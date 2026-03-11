// Thinking Trader Service Worker — для push-уведомлений на мобильных
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Показ уведомлений из postMessage (когда приложение открыто)
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        const { title, body, icon } = event.data;
        self.registration.showNotification(title, {
            body,
            icon: icon || '/favicon-192.png',
            badge: '/favicon-192.png',
            vibrate: [200, 100, 200],
            tag: 'tt-alert-' + Date.now(),
            renotify: true,
        });
    }
});

// FCM Push — срабатывает даже когда браузер закрыт
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch(e) {}
    const title = data.title || 'Thinking Trader';
    const body  = data.body  || 'Ценовой алерт сработал';
    const icon  = data.icon  || '/favicon-192.png';
    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge: '/favicon-192.png',
            vibrate: [200, 100, 200],
            tag: 'tt-alert-' + Date.now(),
            renotify: true,
            data: { url: '/app' },
        })
    );
});

// Клик по уведомлению — открыть приложение
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/app';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            const match = clients.find(c => c.url.includes('/app'));
            if (match) return match.focus();
            return self.clients.openWindow(url);
        })
    );
});
