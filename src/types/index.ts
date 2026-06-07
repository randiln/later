import { Timestamp } from "firebase/firestore";

export type GalleryStatus = 'upcoming' | 'active' | 'revealed';

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
  storagePath: string;
  createdAt: Timestamp;
}
