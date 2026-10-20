// Firebase Cloud Messaging Service Worker
// File: apps/customer/web/firebase-messaging-sw.js

importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
);

// Replace these values with your Firebase Web App configuration.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handle background push notifications
messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Background message received:",
    payload
  );

  const notification = payload.notification || {};

  const title =
    notification.title ||
    payload.data?.title ||
    "Truxify";

  const body =
    notification.body ||
    payload.data?.body ||
    "You have a new notification.";

  const orderId = payload.data?.orderId || "";

  const orderUrl = orderId
    ? `/orders/${encodeURIComponent(orderId)}`
    : "/";

  const notificationOptions = {
    body: body,

    icon: "/icons/Icon-192.png",
    badge: "/icons/Icon-192.png",

    data: {
      orderId: orderId,
      url: orderUrl
    },

    tag: orderId
      ? `order-${orderId}`
      : "truxify-notification",

    requireInteraction: false
  };

  self.registration.showNotification(
    title,
    notificationOptions
  );
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  console.log(
    "[firebase-messaging-sw.js] Notification clicked:",
    event.notification
  );

  event.notification.close();

  const notificationData =
    event.notification.data || {};

  const targetUrl =
    notificationData.url || "/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {

      // Focus an existing Customer App tab
      for (const client of clientList) {
        if (
          "focus" in client &&
          client.url.includes(self.location.origin)
        ) {
          return client.focus().then(() => {
            if ("navigate" in client) {
              return client.navigate(targetUrl);
            }
          });
        }
      }

      // Open a new tab if Customer App is not already open
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
