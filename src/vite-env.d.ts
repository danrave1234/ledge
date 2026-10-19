/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Spotify PKCE client ID optionally supplied when Ledge is built. */
  readonly PUBLIC_SPOTIFY_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
