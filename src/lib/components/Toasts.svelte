<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { toasts, dismissToast, runToastAction } from "$lib/stores";
  import { toastIn, fadeIn, DUR } from "$lib/motion";
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
</script>

<!-- Polite live region: confirmations are announced without stealing focus. -->
<div class="toasts" role="status" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div
      class="toast {t.tone}"
      in:fly={toastIn()}
      out:fade={fadeIn()}
      animate:flip={{ duration: DUR }}
    >
      {#if t.tone === "ok"}<Icon name="check" size={14} />{/if}
      <span class="msg">{t.message}</span>
      {#if t.actionLabel}
        <button class="action" onclick={() => runToastAction(t.id)}
          >{t.actionLabel}</button
        >
      {/if}
      <button class="close" aria-label="Dismiss" onclick={() => dismissToast(t.id)}>
        <Icon name="x" size={12} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    left: 50%;
    bottom: 96px;
    transform: translateX(-50%);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    width: max-content;
    max-width: calc(100% - 32px);
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ctl);
    padding: 0 6px 0 13px;
    border-radius: var(--radius-pill);
    background: var(--text);
    color: var(--surface);
    box-shadow: var(--shadow);
    font-size: var(--fs-sm);
  }
  .toast.ok :global(svg) {
    color: var(--ok);
  }
  .toast.error {
    background: var(--danger);
    color: var(--knob);
  }
  .msg {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .action {
    border: none;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-weight: 700;
    padding: 4px 6px;
    border-radius: var(--radius-xs);
    cursor: pointer;
  }
  .action:hover {
    background: color-mix(in srgb, var(--surface) 14%, transparent);
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    transition: opacity var(--dur) var(--ease);
  }
  .close:hover {
    opacity: 1;
  }
</style>
