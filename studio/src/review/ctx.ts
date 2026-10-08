/** Contexte partagé des pages « Revues » (dépendances du Studio, stockage, navigation). */
import type { Dataset } from "../data/table";
import type { Snapshot, StoryState } from "../story/snapshots";
import type { Review, ReviewRoute } from "./model";
import type { ReviewStorage } from "./storage";

export interface ReviewDeps {
  storage: ReviewStorage;
  datasetFor(s: Snapshot): Dataset | null;
  toast(msg: string, kind?: "ok" | "info" | "error", ms?: number): void;
  /** PowerPoint (exporteur du Studio) : titre + snapshots (commentaires déjà composés). */
  pptx(title: string, snaps: Snapshot[]): Promise<Blob>;
  /** Film plein écran du Studio. */
  film(snaps: Snapshot[], start: number): void;
  /** Mode lecture plein écran (#/lire/<revue>/<snapshot>). */
  read?(reviewId: string, snapId: string | null): void;
  /** Histoire courante du Studio (« Nouvelle revue »). */
  currentStory(): StoryState;
  /** Adresse du Studio (base des liens et QR). */
  baseUrl(): string;
  /** Ouvre un snapshot dans le Studio (ferme l'espace Revues). */
  openInStudio(s: Snapshot): void;
  /** Horloge (tests). */
  now?(): Date;
}

export interface Ctx {
  deps: ReviewDeps;
  get(id: string): Review | null;
  save(r: Review): void;
  go(rt: ReviewRoute | null): void;
  now(): string;
  /** Participant courant sur cet appareil (page participant). */
  me(r: Review): string;
  setMe(r: Review, pid: string): void;
}
