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
