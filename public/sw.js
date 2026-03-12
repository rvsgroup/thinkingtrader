// Thinking Trader Service Worker — для push-уведомлений на мобильных
//
// importScripts required: Firebase Messaging compat uses this to route
// FCM pushes to this SW on iOS (APNs bridge) and Android Chrome.
// Without it the SDK may register its own stub SW and steal the push events.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            "AIzaSyB0uC--M6rVbJS-kmzt_l9rOkwJUDxFGwI",
    authDomain:        "thinking-trader.firebaseapp.com",
    projectId:         "thinking-trader",
    storageBucket:     "thinking-trader.firebasestorage.app",
    messagingSenderId: "392476633112",
    appId:             "1:392476633112:web:2b49fab3fc88aeef093b6d",
});

// Calling firebase.messaging() in the SW registers it as the FCM push handler.
// This is required for background delivery on iOS 16.4+ PWA.
const messaging = firebase.messaging();

// onBackgroundMessage fires when FCM delivers a push while the app is closed/hidden.
// We show the notification manually so we control title/body/icon.
messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || payload.data?.title || 'Thinking Trader';
    const body  = payload.notification?.body  || payload.data?.body  || 'Price alert triggered';
    return self.registration.showNotification(title, {
        body,
        icon:    '/favicon-192.png',
        badge:   '/favicon-192.png',
        vibrate: [200, 100, 200],
        tag:     'tt-alert-' + Date.now(),
        renotify: true,
        data:    { url: '/app' },
    });
});

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
