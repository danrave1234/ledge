<script lang="ts">
  import MusicCard from "$lib/plugins/music/MusicCard.svelte";
  import {
    settings,
    nowPlaying,
    primarySession,
    isLive,
    syncMusicWatch,
  } from "$lib/stores";
  import { pluginActive } from "$lib/plugins";
  import { refreshSpotifyAuth } from "$lib/plugins/music/spotify-tools";
  import { refreshYoutubeKey } from "$lib/plugins/music/youtube-tools";
  import { slideIn } from "$lib/motion";
  import { slide } from "svelte/transition";

  /* The persistent transport bar above the composer.

     It owns the watcher lifecycle: the backend only listens to Windows media
     events while the music plugin is active, so a user who never installs the
     plugin pays nothing for it. */

  let active = $derived(pluginActive($settings, "music"));
  let minimized = $state(false);

  $effect(() => {
    syncMusicWatch(active);
    // Whether Spotify is connected gates the search/play tools, and
    // `available()` cannot await. Refreshing here — the component that owns the
    // music lifecycle, remounted whenever the panel opens — keeps the flag
    // current without a timer. A stale value costs one call that returns a
    // readable "not connected", never a silent failure.
    if (active) {
      refreshSpotifyAuth();
      refreshYoutubeKey();
    }
  });

  let session = $derived(primarySession($nowPlaying));
  // Only surface the bar when there is genuinely something to control. An idle
  // machine should look exactly as it did before the plugin existed.
  let show = $derived(active && isLive(session));
</script>

{#if show && session}
  <div class:minimized class="dock" transition:slide={slideIn()}>
    <button
      class="minimize"
      type="button"
      onclick={() => (minimized = !minimized)}
      aria-label={minimized ? "Expand music bar" : "Minimize music bar"}
      title={minimized ? "Expand music bar" : "Minimize music bar"}
      >{minimized ? "⌃" : "⌄"}</button
    >
    {#if minimized}
      <div class="summary" title={`${session.title} — ${session.artist}`}>
        <strong>{session.title}</strong>
        {#if session.artist}<span>{session.artist}</span>{/if}
      </div>
    {:else}
      <MusicCard compact data={{ app_id: session.app_id }} />
    {/if}
  </div>
{/if}

<style>
  .dock {
    position: relative;
    padding: 0 14px 6px;
  }
  .dock.minimized {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
  }
  .minimize {
    position: absolute;
    z-index: 1;
    top: 7px;
    right: 21px;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 7px;
    color: var(--text-2);
    background: color-mix(in srgb, var(--surface-2) 85%, transparent);
    cursor: pointer;
  }
  .minimized .minimize {
    position: static;
    flex: 0 0 auto;
  }
  .summary {
    min-width: 0;
    display: flex;
    gap: 7px;
    align-items: baseline;
    overflow: hidden;
    font-size: 12px;
  }
  .summary strong,
  .summary span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .summary span {
    color: var(--text-2);
  }
</style>
