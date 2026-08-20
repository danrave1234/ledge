<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { refreshNowPlaying } from "$lib/stores/music";
  import { play } from "$lib/plugins/music/spotify";
  import { openAndConfirm } from "$lib/plugins/music/youtube";

  /* The picker card: "which of these did you mean?" as buttons.

     Clicking one calls Spotify DIRECTLY — no model round-trip. That makes the
     choice instant and free, and it removes the failure where a model asked to
     "play the second one" picks the wrong URI. The model's job was to find the
     candidates; choosing between them is the user's.

     Every string here comes from Spotify, i.e. from whoever named the playlist.
     It is rendered through ordinary Svelte templating, which escapes — never
     {@html}. */

  interface Item {
    uri: string;
    title: string;
    subtitle: string;
    art?: string;
    kind: "track" | "album" | "playlist" | "artist";
    source?: "spotify" | "youtube";
  }

  let { data = {} }: { data?: { items?: Item[]; prompt?: string } } = $props();

  let items = $derived((data.items ?? []).filter((i) => i && typeof i.uri === "string"));
  let busy = $state("");
  let done = $state("");
  let error = $state("");

  async function choose(item: Item) {
    if (busy) return;
    busy = item.uri;
    error = "";
    try {
      // `source` is absent on cards stored before YouTube support, and those
      // were all Spotify — so the default has to stay Spotify, not "guess".
      if (item.source === "youtube") {
        await openAndConfirm(item.uri);
      } else {
        await play(item.uri);
      }
      done = item.uri;
      await refreshNowPlaying();
    } catch (e) {
      // No device, no Premium, expired session — all real and all actionable.
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = "";
    }
  }
</script>

{#if items.length}
  <div class="picker">
    {#if data.prompt}<div class="head">{data.prompt}</div>{/if}
    <div class="rows">
      {#each items as item (item.uri)}
        <button
          class="row"
          type="button"
          class:playing={done === item.uri}
          disabled={!!busy}
          onclick={() => choose(item)}
        >
          <span class="art" class:empty={!item.art}>
            {#if item.art}
              <img src={item.art} alt="" />
            {:else}
              <Icon name="music" size={14} />
            {/if}
          </span>
          <span class="meta">
            <span class="title">{item.title}</span>
            <span class="sub">{item.subtitle}</span>
          </span>
          <span class="go">
            {#if busy === item.uri}
              <span class="spin"></span>
            {:else if done === item.uri}
              <Icon name="check" size={14} />
            {:else}
              <Icon name="play" size={13} />
            {/if}
          </span>
        </button>
      {/each}
    </div>
    {#if error}<div class="err">{error}</div>{/if}
  </div>
{/if}

<style>
  .picker {
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }
  .head {
    padding: 7px 10px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 9px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--dur) var(--ease);
  }
  .row:last-child {
    border-bottom: none;
  }
  .row:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .row:disabled {
    cursor: default;
  }
  .row.playing {
    background: var(--accent-weak);
  }
  .art {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    background: var(--surface-3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
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
    display: flex;
    flex-direction: column;
  }
  .title {
    font-size: var(--fs-sm);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .go {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ctl-xs);
    height: var(--ctl-xs);
    border-radius: var(--radius-sm);
    color: var(--accent-text);
    background: var(--accent-weak);
  }
  .spin {
    width: 11px;
    height: 11px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation-duration: 2s;
    }
  }
  .err {
    padding: 7px 10px;
    font-size: var(--fs-xs);
    color: var(--danger);
    border-top: 1px solid var(--border);
  }
</style>
