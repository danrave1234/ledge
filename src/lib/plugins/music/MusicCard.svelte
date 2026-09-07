<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { nowPlaying, control, primarySession, isLive } from "$lib/stores";
  import type { MediaSession } from "$lib/native";

  /* A now-playing card: cover art, track, and transport buttons.

     Used in two places — attached to a message by the music tools, and docked
     above the composer as the persistent bar. `compact` picks between them.

     Two behaviours worth knowing:

     1. The card is rendered from LIVE state wherever possible. A card persisted
        with a conversation carries a snapshot of the track as it was; showing
        that snapshot's "playing" status three days later would be a lie, so the
        snapshot is matched against the live session list and only upgraded to
        live (and interactive) when the same player still has something loaded.
     2. Position is interpolated locally between events. SMTC pushes on change,
        not on every tick, and this component only exists while the panel is
        open — so the timer dies with the panel rather than running all day. */

  interface CardData {
    app_id?: string;
    app_name?: string;
    title?: string;
    artist?: string;
    album?: string;
    status?: string;
    position_ms?: number;
    duration_ms?: number;
  }

  let { data = {}, compact = false }: { data?: CardData; compact?: boolean } = $props();

  // The live session this card refers to. A card with no app_id (the dock bar)
  // follows whatever is current; a card from a tool sticks to the player it
  // reported on, so two cards about two apps don't both retarget.
  let live = $derived.by((): MediaSession | undefined => {
    const list = $nowPlaying;
    if (!data.app_id) return primarySession(list);
    return list.find((s) => s.app_id === data.app_id);
  });

  let session = $derived.by(() => (isLive(live) ? live : undefined));
  let title = $derived(session?.title || data.title || "");
  let artist = $derived(session?.artist || data.artist || "");
  let appName = $derived(session?.app_name || data.app_name || "");
  let status = $derived(session?.status ?? data.status ?? "unknown");
  let playing = $derived(status === "playing");
  let duration = $derived(session?.duration_ms ?? data.duration_ms ?? 0);

  let error = $state("");
  let busy = $state(false);
  let dragging = $state(false);

  // Locally advanced playback position. Reset whenever the backend reports one,
  // then ticked forward while playing so the bar moves between events.
  let base = $state(0);
  let since = $state(0);
  let elapsed = $state(0);

  $effect(() => {
    if (dragging) return;
    base = session?.position_ms ?? data.position_ms ?? 0;
    since = Date.now();
    elapsed = base;
  });

  $effect(() => {
    if (!playing || !duration) return;
    let frame = 0;
    const tick = () => {
      elapsed = Math.min(base + (Date.now() - since), duration);
      if (elapsed < duration) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  let progress = $derived(duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0);

  function fmt(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function act(action: "toggle" | "next" | "previous") {
    if (busy) return;
    busy = true;
    error = "";
    try {
      await control(action, session?.app_id);
    } catch (e) {
      // Players refuse commands routinely — an ad is playing, nothing is
      // loaded, the control is disabled. Say so instead of failing silently.
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function previewSeek(event: Event) {
    dragging = true;
    elapsed = Number((event.currentTarget as HTMLInputElement).value);
  }

  function cancelSeek() {
    dragging = false;
  }

  async function seek(event: Event) {
    if (busy || !session?.can_seek) return;
    const position = Number((event.currentTarget as HTMLInputElement).value);
    dragging = false;
    busy = true;
    error = "";
    base = position;
    since = Date.now();
    elapsed = position;
    try {
      await control("seek", session.app_id, position);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="card" class:compact class:idle={!session}>
  <div class="art" class:empty={!session?.art}>
    {#if session?.art}
      <!-- The data URL comes from the player's own thumbnail, decoded in Rust
           and sniffed for a real image magic number before it is emitted. -->
      <img src={session.art} alt="" />
    {:else}
      <Icon name="music" size={compact ? 15 : 19} />
    {/if}
  </div>

  <div class="meta">
    <div class="title" {title}>{title || "Nothing playing"}</div>
    <div class="sub" title={artist}>
      {#if artist}<span class="artist">{artist}</span>{/if}
      {#if appName}
        {#if artist}<span class="dot">·</span>{/if}<span class="app">{appName}</span>
      {/if}
      {#if !session && (title || artist)}
        <span class="dot">·</span><span class="app">no longer playing</span>
      {/if}
    </div>
    {#if duration > 0}
      <div class="bar" class:disabled={!session?.can_seek} style:--progress="{progress}%">
        <input
          type="range"
          min="0"
          max={duration}
          step="1000"
          value={elapsed}
          disabled={busy || !session?.can_seek}
          aria-label={`Seek ${title || "media"}`}
          aria-valuetext={`${fmt(elapsed)} of ${fmt(duration)}`}
          title={session?.can_seek
            ? "Click or drag to seek"
            : "Seeking is unavailable for this player"}
          oninput={previewSeek}
          onpointerup={seek}
          onpointercancel={cancelSeek}
          onchange={seek}
        />
      </div>
      {#if !compact}
        <div class="times"><span>{fmt(elapsed)}</span><span>{fmt(duration)}</span></div>
      {/if}
    {/if}
    {#if error}<div class="err">{error}</div>{/if}
  </div>

  {#if session}
    <div class="controls">
      <button
        class="tbtn"
        type="button"
        onclick={() => act("previous")}
        disabled={busy || !session.can_previous}
        title="Previous"
        aria-label="Previous track"
      >
        <Icon name="previous" size={compact ? 14 : 16} />
      </button>
      <button
        class="tbtn main"
        type="button"
        onclick={() => act("toggle")}
        disabled={busy || (!session.can_play && !session.can_pause)}
        title={playing ? "Pause" : "Play"}
        aria-label={playing ? "Pause" : "Play"}
      >
        <Icon name={playing ? "pause" : "play"} size={compact ? 14 : 16} />
      </button>
      <button
        class="tbtn"
        type="button"
        onclick={() => act("next")}
        disabled={busy || !session.can_next}
        title="Next"
        aria-label="Next track"
      >
        <Icon name="next" size={compact ? 14 : 16} />
      </button>
    </div>
  {/if}
</div>

<style>
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 10px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .card.compact {
    padding: 6px 8px;
    gap: 8px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .card.idle {
    opacity: 0.72;
  }
  .art {
    flex-shrink: 0;
    width: 42px;
    height: 42px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
  }
  .compact .art {
    width: 30px;
    height: 30px;
    border-radius: var(--radius-xs);
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    white-space: nowrap;
  }
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .app {
    flex-shrink: 0;
  }
  .dot {
    flex-shrink: 0;
  }
  .bar {
    height: 12px;
    margin-top: 6px;
    display: flex;
    align-items: center;
  }
  .bar input {
    width: 100%;
    height: 12px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
    background: linear-gradient(
      to right,
      var(--accent) var(--progress),
      var(--surface-3) var(--progress)
    );
  }
  .bar.disabled input {
    cursor: default;
  }
  .times {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .err {
    margin-top: 5px;
    font-size: var(--fs-xs);
    color: var(--danger);
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .tbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--ctl-sm);
    height: var(--ctl-sm);
    border: none;
    background: transparent;
    color: var(--text-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .tbtn:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text);
  }
  .tbtn.main {
    color: var(--accent-text);
    background: var(--accent-weak);
  }
  .tbtn.main:hover:not(:disabled) {
    background: var(--accent);
    color: var(--accent-on);
  }
  .tbtn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
