<script lang="ts">
  import Icon from "./Icon.svelte";
  import { settings } from "../stores";
  import { openPinned } from "../controller";

  let s = $derived($settings);
  let vertical = $derived(s.placement !== "top");
</script>

<button
  class="handle {s.placement} {s.handle}"
  class:vertical
  onclick={() => openPinned()}
  aria-label="Open Perch">
  {#if s.handle === "spark"}
    <span class="chip"><Icon name="spark" size={15} /></span>
  {:else if s.handle === "pulse"}
    <span class="pulse"></span>
  {:else}
    <span class="bar"></span>
  {/if}
</button>

<style>
  .handle {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    -webkit-app-region: no-drag;
  }
  /* Hug the docked screen edge — no gap (chip/bar peek from the edge). */
  .handle.top {
    align-items: flex-start;
  }
  .handle.left {
    justify-content: flex-start;
  }
  .handle.right {
    justify-content: flex-end;
  }
  /* The pulse is a round dot: hugging the edge clips it, so keep it centered. */
  .handle.pulse {
    align-items: center;
    justify-content: center;
  }
  .chip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 18px;
    border-radius: 0 0 9px 9px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-top: none;
    color: var(--accent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  }
  .vertical .chip {
    width: 18px;
    height: 30px;
  }
  .handle.left .chip {
    border-radius: 0 9px 9px 0;
    border-left: none;
  }
  .handle.right .chip {
    border-radius: 9px 0 0 9px;
    border-right: none;
  }
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
    animation: breathe 2.4s ease-in-out infinite;
  }
  /* Ring peaks at 4px so the dot + ring fit inside the 22px handle (no clipping). */
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 0 2px var(--accent-weak); }
    50% { box-shadow: 0 0 0 4px var(--accent-weak); }
  }
  /* The bar runs ALONG the docked edge: horizontal on top, vertical on the
     sides. Keyed off placement directly so it can't disagree with the window. */
  .bar {
    border-radius: 999px;
    background: var(--border-2);
    transition: background 0.15s ease;
  }
  .handle.top .bar {
    width: 42px;
    height: 5px;
  }
  .handle.left .bar,
  .handle.right .bar {
    width: 5px;
    height: 42px;
  }
  .handle:hover .chip {
    border-color: var(--accent);
  }
  .handle:hover .bar {
    background: var(--accent);
  }
</style>
