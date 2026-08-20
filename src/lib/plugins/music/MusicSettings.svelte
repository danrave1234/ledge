<script lang="ts">
  import { musicState } from "$lib/plugins/music/state";
  import { refreshSpotifyAuth } from "$lib/plugins/music/spotify-tools";
  import { refreshYoutubeKey } from "$lib/plugins/music/youtube-tools";
  import {
    spotifyConnect,
    spotifyDisconnect,
    setYoutubeKey,
    openExternal,
    isTauri,
  } from "$lib/native";

  /* Music plugin settings: connect a Spotify account, and optionally a YouTube
     Data API key. A distributor can build with PUBLIC_SPOTIFY_CLIENT_ID set;
     then every person only sees Spotify's normal account-login page. The ID is
     public by design for PKCE. OAuth refresh tokens and YouTube keys remain
     local to the Windows credential store and are never exposed to the UI. */

  const REDIRECT_URI = "http://127.0.0.1:7331/callback";
  const DASHBOARD = "https://developer.spotify.com/dashboard";
  const GOOGLE_CONSOLE =
    "https://console.cloud.google.com/apis/library/youtube.googleapis.com";
  const YOUTUBE_MUSIC = "https://music.youtube.com";
  const shippedClientId = (import.meta.env.PUBLIC_SPOTIFY_CLIENT_ID ?? "").trim();
  const hasShippedSpotifyApp = !!shippedClientId;

  // Bound to the input, written through on change. The store is the source of
  // truth; this is just the editing buffer.
  let clientIdInput = $state(musicState.snapshot().clientId || shippedClientId);
  let connected = $state(false);
  let busy = $state(false);
  let error = $state("");
  let showSetup = $state(false);

  // Write-only: the key is stored in the credential manager and never read back
  // into the page, so the field shows whether one exists, not what it is.
  let ytInput = $state("");
  let ytSaved = $state(false);
  let showYt = $state(false);

  $effect(() => {
    refreshSpotifyAuth().then((v) => (connected = v));
    refreshYoutubeKey().then((v) => (ytSaved = v));
  });

  async function saveYoutubeKey() {
    await setYoutubeKey(ytInput);
    ytInput = "";
    ytSaved = await refreshYoutubeKey();
  }

  async function removeYoutubeKey() {
    await setYoutubeKey("");
    ytSaved = await refreshYoutubeKey();
  }

  async function connect() {
    if (!clientIdInput.trim()) {
      await startSpotifySetup();
      return;
    }
    busy = true;
    error = "";
    try {
      // The Spotify API helper reads plugin state after login, so persist a
      // compile-time app ID as well as a manually supplied one before opening
      // the OAuth flow.
      musicState.update({ clientId: clientIdInput.trim() });
      await spotifyConnect(clientIdInput);
      connected = await refreshSpotifyAuth();
      if (!connected) error = "Signed in, but the connection did not stick.";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function disconnect() {
    await spotifyDisconnect();
    connected = await refreshSpotifyAuth();
  }

  async function copyRedirect() {
    await navigator.clipboard?.writeText(REDIRECT_URI);
  }

  async function startSpotifySetup() {
    showSetup = true;
    await openExternal(DASHBOARD);
  }
</script>

<div class="panel">
  <div class="row">
    <div class="label">
      <strong>Spotify</strong>
      <span class="hint">
        {#if connected}
          Connected. Perch can search your library and start playback.
        {:else if hasShippedSpotifyApp}
          Sign in with your own Spotify account. Your connection stays on this PC.
        {:else}
          Set up a free Spotify app once, then sign in with your own account.
        {/if}
      </span>
    </div>
    {#if connected}
      <button class="btn btn-sm" onclick={disconnect}>Disconnect</button>
    {:else}
      <button
        class="btn btn-sm btn-accent"
        onclick={connect}
        disabled={busy || !isTauri()}
      >
        {busy
          ? "Waiting for browser…"
          : clientIdInput.trim()
            ? "Connect Spotify"
            : "Set up Spotify"}
      </button>
    {/if}
  </div>

  {#if !connected && !hasShippedSpotifyApp}
    <label class="field-row">
      <span class="fl">Spotify app Client ID</span>
      <input
        class="field"
        type="text"
        spellcheck="false"
        placeholder="from your Spotify developer dashboard"
        bind:value={clientIdInput}
        oninput={() => musicState.update({ clientId: clientIdInput })}
      />
    </label>

    <button
      class="link-btn"
      onclick={() => (showSetup = !showSetup)}
      aria-expanded={showSetup}
    >
      {showSetup ? "Hide" : "How do I get one?"}
    </button>

    {#if showSetup}
      <ol class="steps">
        <li>
          Open the
          <button class="link-btn inline" onclick={() => openExternal(DASHBOARD)}>
            Spotify developer dashboard
          </button>
          and create an app. Any name and description will do.
        </li>
        <li>
          Set the redirect URI to exactly
          <code>{REDIRECT_URI}</code>
          <button class="link-btn inline" onclick={copyRedirect}>copy</button>
          — Spotify matches it character for character.
        </li>
        <li>Tick <em>Web API</em> as the API you're using, and save.</li>
        <li>Copy the app's Client ID into the box above, then press Connect.</li>
      </ol>
      <p class="note">
        Controlling playback through the Web API requires Spotify Premium. Seeing what's
        playing and using the transport buttons works without it, through Windows itself.
      </p>
    {/if}
  {/if}

  {#if error}<p class="err">{error}</p>{/if}

  <hr class="sep" />

  <div class="row">
    <div class="label">
      <strong>YouTube Music</strong>
      <span class="hint">
        {#if ytSaved}
          Key saved. Perch can find a specific track and open it.
        {:else}
          No sign-in here: Perch uses the account already open in your browser. A key only
          improves exact-track matching.
        {/if}
      </span>
    </div>
    <div class="row-actions">
      <button class="link-btn" onclick={() => openExternal(YOUTUBE_MUSIC)}>Open</button>
      {#if ytSaved}
        <button class="btn btn-sm" onclick={removeYoutubeKey}>Remove</button>
      {:else}
        <button class="link-btn" onclick={() => (showYt = !showYt)}>
          {showYt ? "Hide" : "Improve matching"}
        </button>
      {/if}
    </div>
  </div>

  {#if showYt && !ytSaved}
    <label class="field-row">
      <span class="fl">YouTube Data API key</span>
      <input
        class="field"
        type="password"
        spellcheck="false"
        placeholder="AIza…"
        bind:value={ytInput}
      />
    </label>
    <div class="actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={saveYoutubeKey}
        disabled={!ytInput.trim() || !isTauri()}
      >
        Save key
      </button>
    </div>
    <p class="note">
      Create one in the
      <button class="link-btn inline" onclick={() => openExternal(GOOGLE_CONSOLE)}>
        Google Cloud console
      </button>
      : enable the YouTube Data API v3, then make an API key. It is stored in Windows Credential
      Manager and never shown again.
    </p>
    <p class="note">
      YouTube has no official playback API, so tracks open in your browser and may need
      one click to start. Perch checks with Windows whether playback actually began and
      will say so if it didn't.
    </p>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fl {
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .steps {
    margin: 0;
    padding-left: 18px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: var(--lh);
  }
  .steps li {
    margin: 5px 0;
  }
  .steps code {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
    user-select: all;
  }
  .inline {
    font-size: inherit;
  }
  .note {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: var(--lh);
  }
  .err {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--danger);
  }
  .sep {
    height: 1px;
    border: none;
    background: var(--border);
    margin: 2px 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
