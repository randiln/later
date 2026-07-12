/**
 * Browser notification helpers for Later.
 * Manages Service Worker registration, permission requests,
 * and communication with the SW for scheduling reminders.
 */

let swRegistration: ServiceWorkerRegistration | null = null;

/** Check if the Notification API is supported */
export function isNotificationSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

/** Check if running as an installed PWA */
export function isPWA(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;
}

/** Check if iOS */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}

/** Check if notifications can work on this platform */
export function canNotify(): boolean {
  // iOS requires PWA for notifications
  if (isIOS() && !isPWA()) return false;
  return isNotificationSupported();
}

/** Get current notification permission status */
export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/** Register the service worker */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    swRegistration = reg;
    // Wait for the SW to be ready
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.error('SW registration failed:', err);
    return null;
  }
}

/** Request notification permission with a clean flow */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNotificationSupported()) return false;

  const current = Notification.permission;
  if (current === 'granted') return true;
  if (current === 'denied') return false;

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

/** Send a message to the Service Worker */
function postToSW(message: Record<string, unknown>): void {
  if (swRegistration?.active) {
    swRegistration.active.postMessage(message);
  } else if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  }
}

/**
 * Schedule inactivity reminders and reveal alert for a gallery.
 * Call this after the user grants notification permission.
 */
export function scheduleReminders(
  galleryId: string,
  galleryTitle: string,
  shotsLeft: number,
  revealAt: Date,
  captureUrl: string,
  galleryUrl: string,
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
    },
  });
}

/**
 * Update the shot count after a photo is taken.
 * Resets the inactivity timer in the SW.
 */
export function updateShotsCount(galleryId: string, shotsLeft: number): void {
  postToSW({
    type: 'UPDATE_SHOTS',
    data: { galleryId, shotsLeft },
  });
}

/**
 * Notify the SW that a photo was just taken.
 * Resets the inactivity timer.
 */
export function notifyPhotoTaken(galleryId: string): void {
  postToSW({
    type: 'PHOTO_TAKEN',
    data: { galleryId },
  });
}

/**
 * Cancel all reminders for a gallery.
 * Call when all shots are used or gallery is revealed.
 */
export function cancelReminders(galleryId: string): void {
  postToSW({
    type: 'CANCEL_REMINDERS',
    data: { galleryId },
  });
}
