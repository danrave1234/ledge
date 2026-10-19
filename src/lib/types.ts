type Role = "system" | "user" | "assistant";

/** Follow-up affordance rendered under an assistant message. */
type MsgAction = "auth";

/** A web result the reply was grounded in. Kept on the message so the citation
    list survives a reload and stays tied to the answer it supports. */
interface Source {
  title: string;
  snippet: string;
  url: string;
}

/** An interactive result attached to a message by a tool.
 *
 *  `type` selects the renderer (see lib/cards.ts); `data` is whatever that
 *  renderer expects. Persisted with the conversation, so the buttons still work
 *  after a reload.
 *
 *  `data` routinely holds remote text — track titles, playlist names — so a
 *  renderer must display it through normal Svelte templating, which escapes.
 *  Never `{@html}`. */
export interface MsgCard {
  type: string;
  data: unknown;
  /** How the user resolved an approval card ("opened", "cancelled", …), plus
      what it acted on. Persisted so a resolved card never flips back to its
      buttons after the panel closes and reopens — which would invite running
      an already-approved action twice. Absent = still pending. */
  resolved?: CardResolution;
}

export interface CardResolution {
  status: string;
  /** Short label of what was acted on, for the receipt ("Opened Spotify"). */
  label?: string;
}

export type Attachment =
  | {
      kind: "image";
      name?: string;
      mime: string;
      size: number;
      data?: string;
      assetRef?: string;
    }
  | {
      kind: "document";
      name: string;
      mime: string;
      size: number;
      text?: string;
      assetRef?: string;
    };

export interface Msg {
  id: string;
  role: Role;
  content: string;
  usedScreen?: boolean;
  usedWeb?: boolean;
  attachment?: Attachment;
  /** Legacy image fields, accepted during migration only. */
  image?: string;
  imageRef?: string;
  ts: number;
  error?: boolean;
  action?: MsgAction;
  /** Numbered web sources backing this reply; index + 1 is the citation number. */
  sources?: Source[];
  /** Interactive cards produced by tools this turn, in the order they ran. */
  cards?: MsgCard[];
}

export interface Conversation {
  id: string;
  title: string;
  titled?: boolean; // true once an AI-generated title is set
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
  /** Running notes standing in for turns too old to send verbatim. */
  summary?: string;
  /** Id of the last message folded into `summary`; everything up to and
      including it is represented by the notes rather than the transcript. */
  summarizedThrough?: string;
}

export type Placement = "top" | "left" | "right";
export type HandleStyle = "bar" | "spark" | "pulse";
export type ThemeMode = "system" | "light" | "dark";

/** Reasoning effort; "" means "let the provider decide". */
export type Effort = "" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORTS: Effort[] = ["", "none", "low", "medium", "high", "xhigh", "max"];
export const EFFORT_LABELS: Record<Effort, string> = {
  "": "Auto",
  none: "None",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "X-High",
  max: "Max",
};

/** Permissions granted for one send only. They are deliberately not part of
 * Settings, so a capability can never remain authorized after a turn or an
 * app restart. */
export interface TurnConsent {
  web: boolean;
  screen: boolean;
  music: boolean;
}

/** The exact user-reviewed capture a screen tool may return this turn. */
export interface ApprovedScreen {
  image: string;
  text?: string;
  /** Redaction invalidates OCR because it may contain text hidden in the image. */
  redacted?: boolean;
}

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

export interface Settings {
  schemaVersion?: number; // bumped for one-time settings migrations
  /** App version that last wrote this store — drives post-update tasks. */
  lastVersion?: string;
  /** Stable random, privacy-preserving identifier sent to API safety systems. */
  safetyId: string;
  placement: Placement;
  display?: number; // chosen monitor index (multi-monitor); undefined = auto
  handle: HandleStyle;
  providerId: string;
  model: string;
  effort: Effort;
  personaId: string;
  theme: ThemeMode;
  hoverOpen: boolean;
  /** Seconds the pointer must remain over the handle before hover-open. */
  hoverOpenDelay: number;
  autostart: boolean;
  hotkey: string;
  /** True once the user has agreed to let Ledge control playback. */
  musicConfirmed: boolean;
  gameMode: boolean;
  clearCacheOnLaunch: boolean;
  plugins: Record<string, boolean>;
  installedPlugins: string[];
  customModels: string[];
  /** Last model the user picked for each provider, so switching provider and
      coming back restores their choice instead of the provider default. */
  modelByProvider: Record<string, string>;
  /** Cached live model list from the provider's API, so the picker still offers
      the real IDs after a restart instead of falling back to the static list. */
  fetchedModels: string[];
  accent: string;
  onboarded: boolean;
  // ChatGPT-style personalization (shared by every provider)
  about: string;
  style: string;
  memories: Memory[];
}

export interface Memory {
  id: string;
  text: string;
  enabled: boolean;
}
