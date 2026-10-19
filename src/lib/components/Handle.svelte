<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { settings } from "$lib/stores";
  import { openPinned } from "$lib/controller";

  let {
    onhover,
    onhoverend,
    arming = false,
    armMs = 0,
  }: {
    onhover?: () => void;
    onhoverend?: () => void;
    /** The hover-open delay is counting down: fill the mark so the wait reads
        as "opening…" rather than as an unresponsive handle. */
    arming?: boolean;
    armMs?: number;
  } = $props();

  let s = $derived($settings);
  let vertical = $derived(s.placement !== "top");
</script>

<!-- The collapsed WINDOW is a strip wider than the mark, because the OS only
     delivers pointer events inside the window rect. The interactive target is
     this button, sized to the mark itself — so hover-open fires when the
     pointer is on the handle, not merely near it. -->
<div class="dock {s.placement}">
  <!-- The handle STYLE goes on a data attribute, never into the class list: the
       style names match the inner mark's classes (.bar/.pulse/.knob), so putting
       `bar` on the button made the button itself paint a second, window-wide bar
       behind the real one. -->
  <button
    class="handle"
    class:vertical
    class:arming
    style="--arm-ms: {armMs}ms"
    data-mark={s.handle}
    onmouseenter={() => onhover?.()}
    onmouseleave={() => onhoverend?.()}
    onclick={() => openPinned()}
    aria-label="Open Ledge"
  >
    {#if s.handle === "spark"}
      <span class="knob"><Icon name="spark" size={15} /></span>
    {:else if s.handle === "pulse"}
      <span class="pulse"></span>
    {:else}
      <span class="bar"></span>
    {/if}
  </button>
</div>

<style>
  /* Fills the window and parks the handle against the docked edge. */
  .dock {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Hug the docked screen edge — no gap (knob/bar peek from the edge). */
  .dock.top {
    align-items: flex-start;
  }
  .dock.left {
    justify-content: flex-start;
  }
  .dock.right {
    justify-content: flex-end;
  }
  /* Sized by its mark, never the window: this rect is the hover/click target. */
  .handle {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 0;
    -webkit-app-region: no-drag;
  }
  /* The pulse is a round dot: hugging the edge clips it, so keep it centered. */
  .dock:has(.handle[data-mark="pulse"]) {
    align-items: center;
    justify-content: center;
  }
  /* Named .knob, not .chip: `.chip` is a global primitive in tokens.css and
     would bleed its pill styling into the handle. */
  .knob {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 18px;
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-top: none;
    color: var(--accent);
    box-shadow: var(--shadow-sm);
    transition: border-color var(--dur) var(--ease);
  }
  .vertical .knob {
    width: 18px;
    height: 30px;
  }
  .dock.left .knob {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    border-left: none;
  }
  .dock.right .knob {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    border-right: none;
  }
  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
    animation: breathe 2.4s var(--ease) infinite;
  }
  /* Ring peaks at 4px so the dot + ring fit inside the handle (no clipping). */
  @keyframes breathe {
    0%,
    100% {
      box-shadow: 0 0 0 2px var(--accent-weak);
    }
    50% {
      box-shadow: 0 0 0 4px var(--accent-weak);
    }
  }
  /* The bar runs ALONG the docked edge: horizontal on top, vertical on the
     sides. Keyed off placement directly so it can't disagree with the window. */
  .bar {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-pill);
    background: var(--border-2);
    transition:
      background var(--dur) var(--ease),
      transform var(--dur-slow) var(--ease-spring);
  }
  /* Countdown fill for the hover-open delay. */
  .bar::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--accent);
    transform: scaleX(0);
    transform-origin: left;
  }
  .dock.left .bar::after,
  .dock.right .bar::after {
    transform: scaleY(0);
    transform-origin: top;
  }
  .arming .bar::after {
    transform: none;
    transition: transform var(--arm-ms) linear;
  }
  .dock.top .handle:hover .bar {
    transform: scaleY(1.4);
  }
  .dock.left .handle:hover .bar,
  .dock.right .handle:hover .bar {
    transform: scaleX(1.4);
  }
  .dock.top .bar {
    width: 42px;
    height: 5px;
  }
  .dock.left .bar,
  .dock.right .bar {
    width: 5px;
    height: 42px;
  }
  .handle:hover .knob {
    border-color: var(--accent);
  }
  .knob,
  .pulse {
    transition:
      border-color var(--dur) var(--ease),
      transform var(--dur-slow) var(--ease-spring);
  }
  .handle:hover .knob,
  .handle:hover .pulse {
    transform: scale(1.12);
  }
  .arming .knob {
    background: var(--accent-weak);
    transition:
      background var(--arm-ms) linear,
      transform var(--dur-slow) var(--ease-spring);
  }
  .handle:hover .bar {
    background: var(--accent);
  }
</style>
