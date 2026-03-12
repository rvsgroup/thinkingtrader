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
    // FCM wraps the payload: { notification:{title,body}, data:{...} }
    // iOS may also deliver via the aps.alert path — handle both shapes.
    let title = 'Thinking Trader';
    let body  = 'Price alert triggered';
    let icon  = '/favicon-192.png';

    try {
        if (event.data) {
            const raw = event.data.json();
            // Shape 1: FCM envelope  { notification: {title, body}, data: {...} }
            if (raw.notification) {
                title = raw.notification.title || title;
                body  = raw.notification.body  || body;
                icon  = raw.notification.icon  || icon;
            // Shape 2: flat data-only message  { title, body, icon }
            } else if (raw.data) {
                title = raw.data.title || title;
                body  = raw.data.body  || body;
                icon  = raw.data.icon  || icon;
            } else {
                title = raw.title || title;
                body  = raw.body  || body;
                icon  = raw.icon  || icon;
            }
        }
    } catch(e) {}

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge:   '/favicon-192.png',
            vibrate: [200, 100, 200],
            tag:     'tt-alert-' + Date.now(),
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
