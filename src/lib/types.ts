export type Role = "system" | "user" | "assistant";

export interface Msg {
  id: string;
  role: Role;
  content: string;
  usedScreen?: boolean;
  usedWeb?: boolean;
  image?: string;
  ts: number;
  error?: boolean;
  action?: string;
}

export interface Conversation {
  id: string;
  title: string;
  titled?: boolean; // true once an AI-generated title is set
  messages: Msg[];
  createdAt: number;
  updatedAt: number;
}

export type Placement = "top" | "left" | "right";
export type HandleStyle = "pill" | "spark" | "pulse" | "bar";
export type ThemeMode = "system" | "light" | "dark";

export interface Persona {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

export interface Settings {
  placement: Placement;
  handle: HandleStyle;
  providerId: string;
  model: string;
  effort: string;
  personaId: string;
  theme: ThemeMode;
  hoverOpen: boolean;
  autostart: boolean;
  hotkey: string;
  webSearch: boolean;
  screenContext: boolean;
  gameMode: boolean;
  clearCacheOnLaunch: boolean;
  plugins: Record<string, boolean>;
  installedPlugins: string[];
  customModels: string[];
  customCss: string;
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
