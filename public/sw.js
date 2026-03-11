// Thinking Trader Service Worker — для push-уведомлений на мобильных
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Показ уведомлений из postMessage
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

// Клик по уведомлению — открыть приложение
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            if (clients.length > 0) {
                return clients[0].focus();
            }
            return self.clients.openWindow('/app');
        })
    );
});
