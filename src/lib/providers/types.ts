export interface ModelInfo {
  id: string;
  label: string;
}

export interface WireMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamOpts {
  model: string;
  system: string;
  messages: WireMsg[];
  onDelta: (t: string) => void;
  signal?: AbortSignal;
  screen?: boolean;
  web?: boolean;
  image?: string;
  effort?: string;
}

export interface Provider {
  id: string;
  label: string;
  requiresAuth: boolean;
  listModels(): Promise<ModelInfo[]>;
  isAuthed(): Promise<boolean>;
  stream(opts: StreamOpts): Promise<void>;
}
