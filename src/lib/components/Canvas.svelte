<script lang="ts">
  import Icon from "./Icon.svelte";
  import { canvas, closeCanvas } from "../stores";
  import { fade, fly } from "svelte/transition";

  let c = $derived($canvas);
  let copied = $state(false);
  function copy() {
    navigator.clipboard?.writeText(c.code);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
</script>

{#if c.open}
  <div class="canvas" transition:fly={{ y: 12, duration: 160 }}>
    <div class="chead">
      <Icon name="stack" size={15} />
      <span class="clang">{c.lang}</span>
      <span class="cspace"></span>
      <button class="cbtn" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
      <button class="icon-btn" aria-label="Close canvas" onclick={closeCanvas}>
        <Icon name="x" size={16} />
      </button>
    </div>
    <pre class="cbody"><code>{c.code}</code></pre>
  </div>
{/if}

<style>
  .canvas {
    position: absolute;
    inset: 0;
    z-index: 30;
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
    font-size: 12px;
    color: var(--text-2);
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .cspace {
    flex: 1;
  }
  .cbtn {
    border: 1px solid var(--border-2);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    padding: 5px 11px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .cbtn:hover {
    background: var(--surface-2);
  }
  .cbody {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 14px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text);
    user-select: text;
    white-space: pre;
  }
</style>
