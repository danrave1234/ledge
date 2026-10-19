<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { canvas, closeCanvas } from "$lib/stores";
  import { flyIn } from "$lib/motion";
  import { fly } from "svelte/transition";

  const COPIED_MS = 1400;

  let c = $derived($canvas);
  let copied = $state(false);
  let closeButton: HTMLButtonElement | undefined = $state();
  $effect(() => {
    if (c.open) queueMicrotask(() => closeButton?.focus());
  });
  function copy() {
    navigator.clipboard?.writeText(c.code);
    copied = true;
    setTimeout(() => (copied = false), COPIED_MS);
  }
</script>

{#if c.open}
  <div
    class="canvas"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={c.image ? "Screen capture" : "Code canvas"}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCanvas();
      }
    }}
    transition:fly={flyIn()}
  >
    <div class="chead">
      <Icon name={c.image ? "screen" : "stack"} size={15} />
      <span class="clang">{c.lang}</span>
      <span class="cspace"></span>
      {#if !c.image}
        <button class="btn btn-sm" onclick={copy}>
          <Icon name={copied ? "check" : "copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      {/if}
      <button
        bind:this={closeButton}
        class="icon-btn"
        aria-label="Close canvas"
        title="Close (Esc)"
        onclick={closeCanvas}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
    {#if c.image}
      <div class="cimg"><img src={c.image} alt="screen capture" /></div>
    {:else}
      <pre class="cbody"><code>{c.code}</code></pre>
    {/if}
  </div>
{/if}

<style>
  .canvas {
    position: absolute;
    inset: 0;
    z-index: var(--z-overlay);
    background: var(--surface);
    display: flex;
    flex-direction: column;
  }
  .chead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .clang {
    font-size: var(--fs-sm);
    color: var(--text-2);
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .cspace {
    flex: 1;
  }
  .cbody {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 14px;
    font-family: var(--mono);
    font-size: var(--fs-sm);
    line-height: 1.6;
    color: var(--text);
    user-select: text;
    white-space: pre;
  }
  .cimg {
    flex: 1;
    overflow: auto;
    padding: 12px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  .cimg img {
    max-width: 100%;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }
</style>
