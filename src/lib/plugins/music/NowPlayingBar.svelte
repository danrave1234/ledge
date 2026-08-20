<script lang="ts">
  import MusicCard from "$lib/plugins/music/MusicCard.svelte";
  import { settings } from "$lib/stores";
  import { nowPlaying, primarySession, isLive, syncMusicWatch } from "$lib/stores/music";
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
  <div class="dock" transition:slide={slideIn}>
    <MusicCard compact data={{ app_id: session.app_id }} />
  </div>
{/if}

<style>
  .dock {
    padding: 0 14px 6px;
  }
</style>
