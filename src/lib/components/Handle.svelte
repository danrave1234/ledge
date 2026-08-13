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
  {#if s.handle === "pill"}
    <span class="pill"></span>
  {:else if s.handle === "spark"}
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
  /* Hug the docked screen edge — no gap. */
  .handle.top {
    align-items: flex-start;
  }
  .handle.left {
    justify-content: flex-start;
  }
  .handle.right {
    justify-content: flex-end;
  }
  /* OPPO-style idle pill: a thin frosted sliver flush with the screen edge that
     brightens and grows the moment the pointer nears. Adaptive translucent fill. */
  .pill {
    --pill-fill: rgba(255, 255, 255, 0.65); /* clean white sliver, like OPPO */
    background: var(--pill-fill);
    backdrop-filter: blur(8px) saturate(1.2);
    -webkit-backdrop-filter: blur(8px) saturate(1.2);
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.18);
    opacity: 0.72;
    transition: opacity 0.18s ease, width 0.18s ease, height 0.18s ease;
  }
  /* On light backgrounds a pure-white sliver would vanish — dim it slightly. */
  :global([data-theme="light"]) .pill {
    --pill-fill: rgba(60, 60, 68, 0.5);
  }
  @media (prefers-color-scheme: light) {
    :global(:root:not([data-theme="dark"])) .pill {
      --pill-fill: rgba(60, 60, 68, 0.5);
    }
  }
  .handle.top .pill {
    width: 52px;
    height: 5px;
    border-radius: 0 0 7px 7px;
  }
  .handle.left .pill {
    width: 5px;
    height: 52px;
    border-radius: 0 7px 7px 0;
  }
  .handle.right .pill {
    width: 5px;
    height: 52px;
    border-radius: 7px 0 0 7px;
  }
  .handle:hover .pill {
    opacity: 1;
  }
  .handle.top:hover .pill {
    width: 62px;
    height: 6px;
  }
  .handle.left:hover .pill,
  .handle.right:hover .pill {
    width: 6px;
    height: 62px;
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
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px var(--accent-weak);
    animation: breathe 2.4s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 0 3px var(--accent-weak); }
    50% { box-shadow: 0 0 0 6px var(--accent-weak); }
  }
  .bar {
    width: 42px;
    height: 5px;
    border-radius: 999px;
    background: var(--border-2);
  }
  .vertical .bar {
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
