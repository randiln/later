import { Timestamp } from "firebase/firestore";

export type GalleryStatus = 'upcoming' | 'active' | 'revealed';

export interface GalleryNotificationSettings {
  enabled: boolean;
  inactivityInterval: number;
  recurrentInactivity: boolean;
  beforeEndReminder: number;
  notifyOnReveal: boolean;
}

export interface Gallery {
  id: string;
  creatorId: string;
  title: string;
  description?: string;
  startsAt: Timestamp;
  revealAt: Timestamp;
  maxShots: number;
  maxContributors: number;
  status: GalleryStatus;
  themeColor?: string;
  welcomeMessage?: string;
  coverImageUrl?: string;
  createdAt: Timestamp;
  notificationSettings?: GalleryNotificationSettings;
  /** 'host' = only the creator sees photos at reveal until they share. Absent = 'auto'. */
  releaseMode?: 'auto' | 'host';
  /** Set when a host-first gallery is shared with guests. */
  sharedAt?: Timestamp;
}

export interface Contributor {
  id: string;
  galleryId: string;
  nickname: string;
  sessionId: string;
  shotsTaken: number;
  createdAt: Timestamp;
}

export interface Photo {
  id: string;
  galleryId: string;
  contributorId: string;
  /** Original (≤12 MP). Relative path inside the photos bucket. */
  storagePath: string;
  /** 1600px long-edge copy for the lightbox. Absent on photos taken before sizes existed. */
  displayPath?: string;
  /** 480px long-edge copy for the grid. Absent on photos taken before sizes existed. */
  thumbPath?: string;
  width?: number;
  height?: number;
  createdAt: Timestamp;
}
