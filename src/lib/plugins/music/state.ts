import { definePluginState } from "../../stores/plugin-state";

export interface MusicState {
  schemaVersion?: number;
  /** Spotify client ID selected for this Windows user. A distributor may ship
   *  a public PKCE client ID through PUBLIC_SPOTIFY_CLIENT_ID; it is persisted
   *  here before login so subsequent API calls use the same app identity. It
   *  is not a secret. The refresh token never leaves Rust. */
  clientId: string;
}

/** Music's own persisted config, in `perch.plugin.music` — not in Settings. */
export const musicState = definePluginState<MusicState>({
  id: "music",
  schema: 1,
  defaults: { schemaVersion: 1, clientId: "" },
});

export function clientId(): string {
  return musicState.snapshot().clientId.trim();
}
