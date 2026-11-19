// apps/customer/web/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyMockKeyForTruxifyWebPush99",
  authDomain: "truxify-prod.firebaseapp.com",
  projectId: "truxify-prod",
  storageBucket: "truxify-prod.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
});

const messaging = firebase.messaging();

// Handle background push messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);
  
  const notificationTitle = payload.notification?.title || 'Truxify Update';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new delivery update.',
    icon: '/icons/Icon-192.png',
    data: {
      click_action: payload.data?.click_action || '/orders/' + (payload.data?.orderId || '')
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click events (deep-linking and tab focusing)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.click_action || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          return client.navigate(targetUrl);
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
