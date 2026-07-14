// Later — Service Worker for push notifications
// Uses setTimeout-based scheduling, triggered by visibilitychange in main thread.
// State is re-sent on every page load so SW revival doesn't lose context.

// In-memory state — reset if SW is killed and restarted (main thread re-sends on load)
const timers = {}; // galleryId -> { inactivityTimer, revealTimer }
const state = {};  // galleryId -> full gallery data

self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};
  if (!type) return;

  switch (type) {

    case 'SCHEDULE_REMINDERS': {
      const { galleryId, galleryTitle, shotsLeft, revealAt, captureUrl, galleryUrl, reminderCount, settings } = data;

      // Default settings for backward compatibility if old event
      const config = settings || {
        enabled: true,
        inactivityInterval: 10,
        recurrentInactivity: false,
        beforeEndReminder: 5,
        notifyOnReveal: true,
      };

      if (!config.enabled) return;

      // Store fresh state (handles SW revival)
      state[galleryId] = {
        galleryTitle,
        shotsLeft,
        revealAt,
        captureUrl,
        galleryUrl,
        reminderCount: reminderCount || 0,
      };

      clearTimers(galleryId);

      const now = Date.now();
      const revealTime = new Date(revealAt).getTime();
      const timeToReveal = revealTime - now;

      // Only schedule things if reveal is within 24 hours (SW won't survive longer)
      if (timeToReveal > 0 && timeToReveal < 24 * 60 * 60 * 1000) {
        timers[galleryId] = timers[galleryId] || {};
        const promises = [];

        // 1. Schedule reveal notification
        if (config.notifyOnReveal) {
          promises.push(new Promise((resolve) => {
            timers[galleryId].revealTimer = setTimeout(() => {
              showRevealNotification(galleryId);
              resolve();
            }, timeToReveal);
          }));
        }

        // 2. Schedule before-end notification
        if (config.beforeEndReminder > 0) {
          const beforeEndMs = config.beforeEndReminder * 60 * 1000;
          const timeToBeforeEnd = timeToReveal - beforeEndMs;
          if (timeToBeforeEnd > 0) {
            promises.push(new Promise((resolve) => {
              timers[galleryId].beforeEndTimer = setTimeout(() => {
                const s = state[galleryId];
                if (s && s.shotsLeft > 0) {
                  showBeforeEndNotification(galleryId, s, config.beforeEndReminder);
                }
                resolve();
              }, timeToBeforeEnd);
            }));
          }
        }

        // 3. Schedule inactivity reminder
        const currentReminderCount = state[galleryId].reminderCount || 0;
        if (shotsLeft > 0 && config.inactivityInterval > 0 && currentReminderCount < 3) {
          const inactivityMs = config.inactivityInterval * 60 * 1000;
          
          promises.push(new Promise((resolve) => {
            timers[galleryId].inactivityTimer = setTimeout(() => {
              const s = state[galleryId];
              if (!s || s.shotsLeft <= 0) {
                resolve();
                return;
              }

              // Fire the notification
              showInactivityNotification(galleryId, s);
              s.reminderCount = (s.reminderCount || 0) + 1;

              // Recurrent scheduling
              if (config.recurrentInactivity && s.reminderCount < 3) {
                timers[galleryId].inactivityTimer = setTimeout(() => {
                  const s2 = state[galleryId];
                  if (!s2 || s2.shotsLeft <= 0) {
                    resolve();
                    return;
                  }
                  showInactivityNotification(galleryId, s2);
                  s2.reminderCount = (s2.reminderCount || 0) + 1;

                  if (config.recurrentInactivity && s2.reminderCount < 3) {
                    timers[galleryId].inactivityTimer = setTimeout(() => {
                      const s3 = state[galleryId];
                      if (!s3 || s3.shotsLeft <= 0) {
                        resolve();
                        return;
                      }
                      showInactivityNotification(galleryId, s3);
                      resolve();
                    }, inactivityMs);
                  } else {
                    resolve();
                  }
                }, inactivityMs);
              } else {
                resolve();
              }
            }, inactivityMs);
          }));
        }

        if (event.waitUntil && promises.length > 0) {
          event.waitUntil(Promise.all(promises));
        }
      } else if (timeToReveal <= 0 && config.notifyOnReveal) {
        // Already past reveal time
        showRevealNotification(galleryId);
      }
      break;
    }

    // Called when the user returns to the tab — cancel inactivity timers
    case 'PAGE_VISIBLE': {
      const { galleryId } = data;
      if (timers[galleryId]?.inactivityTimer) {
        clearTimeout(timers[galleryId].inactivityTimer);
        timers[galleryId].inactivityTimer = null;
      }
      // Reset reminder count when user comes back
      if (state[galleryId]) {
        state[galleryId].reminderCount = 0;
      }
      // Dismiss any existing inactivity notification
      self.registration.getNotifications({ tag: `later-reminder-${galleryId}` })
        .then(notifications => notifications.forEach(n => n.close()));
      break;
    }

    // Called after a photo is taken — update shot count and reset inactivity timer
    case 'PHOTO_TAKEN': {
      const { galleryId, shotsLeft } = data;
      if (state[galleryId]) {
        state[galleryId].shotsLeft = shotsLeft;
        state[galleryId].reminderCount = 0;
      }
      // Clear inactivity timer — the SCHEDULE_REMINDERS from visibilitychange will restart it
      if (timers[galleryId]?.inactivityTimer) {
        clearTimeout(timers[galleryId].inactivityTimer);
        timers[galleryId].inactivityTimer = null;
      }
      break;
    }

    // Called when all shots used or gallery revealed
    case 'CANCEL_REMINDERS': {
      const { galleryId } = data;
      clearTimers(galleryId);
      delete state[galleryId];
      self.registration.getNotifications({ tag: `later-reminder-${galleryId}` })
        .then(notifications => notifications.forEach(n => n.close()));
      self.registration.getNotifications({ tag: `later-before-end-${galleryId}` })
        .then(notifications => notifications.forEach(n => n.close()));
      self.registration.getNotifications({ tag: `later-reveal-${galleryId}` })
        .then(notifications => notifications.forEach(n => n.close()));
      break;
    }
  }
});

function clearTimers(galleryId) {
  if (timers[galleryId]) {
    if (timers[galleryId].inactivityTimer) clearTimeout(timers[galleryId].inactivityTimer);
    if (timers[galleryId].beforeEndTimer) clearTimeout(timers[galleryId].beforeEndTimer);
    if (timers[galleryId].revealTimer) clearTimeout(timers[galleryId].revealTimer);
    timers[galleryId] = {};
  }
}

function showInactivityNotification(galleryId, s) {
  const revealTime = new Date(s.revealAt).getTime();
  const timeLeft = revealTime - Date.now();
  const timeStr = formatTimeLeft(timeLeft);

  self.registration.showNotification(`Later \u2014 ${s.galleryTitle}`, {
    body: `You have ${s.shotsLeft} shot${s.shotsLeft === 1 ? '' : 's'} left \u00b7 Event ends ${timeStr}`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `later-reminder-${galleryId}`,
    renotify: true,
    requireInteraction: false,
    silent: false,
    data: { url: s.captureUrl, type: 'inactivity' },
    actions: [{ action: 'open', title: 'Open Camera' }],
  });
}

function showRevealNotification(galleryId) {
  const s = state[galleryId];
  if (!s) return;

  self.registration.showNotification(`Later \u2014 ${s.galleryTitle}`, {
    body: 'The vault is open! Tap to see all the memories.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `later-reveal-${galleryId}`,
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: s.galleryUrl, type: 'reveal' },
    actions: [{ action: 'open', title: 'View Gallery' }],
  });
}

function showBeforeEndNotification(galleryId, s, minsBefore) {
  self.registration.showNotification(`Later \u2014 ${s.galleryTitle}`, {
    body: `The event ends in ${minsBefore} minutes! You still have ${s.shotsLeft} shot${s.shotsLeft === 1 ? '' : 's'} to take.`,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: `later-before-end-${galleryId}`,
    renotify: true,
    requireInteraction: true, // make sure they see this one
    silent: false,
    data: { url: s.captureUrl, type: 'before-end' },
    actions: [{ action: 'open', title: 'Open Camera' }],
  });
}

function formatTimeLeft(ms) {
  if (ms <= 0) return 'soon';
  const totalMinutes = Math.floor(ms / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

// Handle notification tap
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url) return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url.split('?')[0]) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));
