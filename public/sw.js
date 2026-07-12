// Later — Service Worker for push notifications
// Handles inactivity reminders and reveal alerts

const INACTIVITY_CHECK_INTERVAL = 30 * 1000; // Check every 30s
const INACTIVITY_THRESHOLD = 15 * 60 * 1000; // 15 minutes
const MAX_REMINDERS = 3;

// Per-gallery state
const galleryState = {};

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  const { type, data } = event.data;

  switch (type) {
    case 'SCHEDULE_REMINDERS': {
      const { galleryId, galleryTitle, shotsLeft, revealAt, captureUrl, galleryUrl } = data;
      
      // Clear any existing interval for this gallery
      if (galleryState[galleryId]?.intervalId) {
        clearInterval(galleryState[galleryId].intervalId);
      }

      galleryState[galleryId] = {
        galleryTitle,
        shotsLeft,
        revealAt,
        captureUrl,
        galleryUrl,
        lastActivity: Date.now(),
        reminderCount: 0,
        revealNotified: false,
        intervalId: null,
      };

      // Start checking
      const intervalId = setInterval(() => checkGallery(galleryId), INACTIVITY_CHECK_INTERVAL);
      galleryState[galleryId].intervalId = intervalId;
      break;
    }

    case 'UPDATE_SHOTS': {
      const { galleryId, shotsLeft } = data;
      if (galleryState[galleryId]) {
        galleryState[galleryId].shotsLeft = shotsLeft;
        galleryState[galleryId].lastActivity = Date.now();
        galleryState[galleryId].reminderCount = 0; // Reset reminder count on activity
      }
      break;
    }

    case 'PHOTO_TAKEN': {
      const { galleryId } = data;
      if (galleryState[galleryId]) {
        galleryState[galleryId].lastActivity = Date.now();
        galleryState[galleryId].reminderCount = 0;
      }
      break;
    }

    case 'CANCEL_REMINDERS': {
      const { galleryId } = data;
      if (galleryState[galleryId]) {
        if (galleryState[galleryId].intervalId) {
          clearInterval(galleryState[galleryId].intervalId);
        }
        delete galleryState[galleryId];
        // Dismiss any existing notification
        self.registration.getNotifications({ tag: `later-reminder-${galleryId}` })
          .then(notifications => notifications.forEach(n => n.close()));
      }
      break;
    }
  }
});

function checkGallery(galleryId) {
  const state = galleryState[galleryId];
  if (!state) return;

  const now = Date.now();
  const revealTime = new Date(state.revealAt).getTime();

  // Check if reveal time has passed
  if (now >= revealTime && !state.revealNotified) {
    state.revealNotified = true;
    showRevealNotification(galleryId, state);
    // Clean up — no more reminders needed
    if (state.intervalId) {
      clearInterval(state.intervalId);
    }
    return;
  }

  // Check for inactivity reminder
  if (state.shotsLeft > 0 && state.reminderCount < MAX_REMINDERS && now < revealTime) {
    const timeSinceActivity = now - state.lastActivity;
    
    // Fire reminder at 15 min intervals
    const expectedReminders = Math.floor(timeSinceActivity / INACTIVITY_THRESHOLD);
    
    if (expectedReminders > state.reminderCount) {
      state.reminderCount = expectedReminders;
      showInactivityNotification(galleryId, state);
    }
  }
}

function showInactivityNotification(galleryId, state) {
  const revealTime = new Date(state.revealAt).getTime();
  const now = Date.now();
  const timeLeft = revealTime - now;
  
  const timeStr = formatTimeLeft(timeLeft);

  self.registration.showNotification(`Later — ${state.galleryTitle}`, {
    body: `You have ${state.shotsLeft} shot${state.shotsLeft === 1 ? '' : 's'} left · Event ends ${timeStr}`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `later-reminder-${galleryId}`,
    renotify: true,
    requireInteraction: false,
    data: {
      url: state.captureUrl,
      type: 'inactivity',
    },
    actions: [
      { action: 'open', title: 'Open Camera' },
    ],
  });
}

function showRevealNotification(galleryId, state) {
  self.registration.showNotification(`Later — ${state.galleryTitle}`, {
    body: 'The vault is open! Tap to see all the memories.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `later-reveal-${galleryId}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: state.galleryUrl,
      type: 'reveal',
    },
    actions: [
      { action: 'open', title: 'View Gallery' },
    ],
  });
}

function formatTimeLeft(ms) {
  if (ms <= 0) return 'soon';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `in ${days} day${days === 1 ? '' : 's'}`;
  }
  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }
  return `in ${minutes}m`;
}

// Handle notification click — open/focus the correct URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url;
  if (!url) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a tab open with this URL
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(url);
    })
  );
});

// Keep SW alive
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
