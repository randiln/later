/**
 * Browser notification helpers for Later.
 */

let swRegistration: ServiceWorkerRegistration | null = null;

export function isNotificationSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export function isPWA(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

/** Notifications can work here (Android always yes; iOS only if PWA) */
export function canNotify(): boolean {
  if (!isNotificationSupported()) return false;
  if (isIOS() && !isPWA()) return false;
  return true;
}

export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/** Register the SW and wait for it to be in control */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    swRegistration = reg;

    // If there's no active controller yet, wait for the SW to take over
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        // Fallback timeout — if controllerchange never fires (already controlled), resolve after 1s
        setTimeout(resolve, 1000);
      });
    }

    // Always update swRegistration to the ready registration
    const readyReg = await navigator.serviceWorker.ready;
    swRegistration = readyReg;

    return readyReg;
  } catch (err) {
    console.error('[Later] SW registration failed:', err);
    return null;
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/** Post a message to the active SW, waiting for it to be ready if needed */
async function postToSW(message: Record<string, unknown>): Promise<void> {
  // Try the cached registration first
  const sw = swRegistration?.active ?? navigator.serviceWorker.controller;
  if (sw) {
    sw.postMessage(message);
    return;
  }

  // SW not ready — wait up to 2 seconds
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ]) as ServiceWorkerRegistration;

    if (reg.active) {
      reg.active.postMessage(message);
      swRegistration = reg;
    }
  } catch {
    console.warn('[Later] SW not ready, notification scheduling skipped');
  }
}

/**
 * Schedule reminders in the SW.
 * Call on page load (if permission granted) AND whenever the page goes hidden.
 */
export function scheduleReminders(
  galleryId: string,
  galleryTitle: string,
  shotsLeft: number,
  revealAt: Date,
  captureUrl: string,
  galleryUrl: string,
  reminderCount = 0,
): void {
  postToSW({
    type: 'SCHEDULE_REMINDERS',
    data: {
      galleryId,
      galleryTitle,
      shotsLeft,
      revealAt: revealAt.toISOString(),
      captureUrl,
      galleryUrl,
      reminderCount,
    },
  });
}

/**
 * Tell the SW the page is visible — cancel inactivity timers, dismiss banner.
 */
export function notifyPageVisible(galleryId: string): void {
  postToSW({ type: 'PAGE_VISIBLE', data: { galleryId } });
}

/**
 * Tell the SW a photo was taken — resets inactivity timer, updates shot count.
 */
export function notifyPhotoTaken(galleryId: string, shotsLeft: number): void {
  postToSW({ type: 'PHOTO_TAKEN', data: { galleryId, shotsLeft } });
}

/** Cancel all reminders — call when shots exhausted or gallery revealed. */
export function cancelReminders(galleryId: string): void {
  postToSW({ type: 'CANCEL_REMINDERS', data: { galleryId } });
}
