<script lang="ts">
  import { hotkeyFromEvent, hotkeyLabel } from "$lib/hotkey";

  let {
    id,
    value,
    onchange,
  }: { id?: string; value: string; onchange: (accelerator: string) => void } = $props();

  let recording = $state(false);
  let hint = $state("");
  let el: HTMLButtonElement | undefined = $state();

  function start() {
    recording = true;
    hint = "Press the new shortcut…";
  }

  function stopRecording() {
    recording = false;
    hint = "";
  }

  function onKey(e: KeyboardEvent) {
    if (!recording) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        start();
      }
      return;
    }
    // While recording, every key belongs to the recorder — including Esc,
    // which cancels instead of collapsing the panel.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return stopRecording();
    const r = hotkeyFromEvent(e);
    if (r.kind === "pending") return;
    if (r.kind === "invalid") {
      hint = r.reason;
      return;
    }
    onchange(r.accelerator);
    stopRecording();
    el?.blur();
  }
</script>

<button
  {id}
  bind:this={el}
  type="button"
  class="hotkey"
  class:recording
  aria-label={recording
    ? "Recording shortcut. Press keys, or Escape to cancel"
    : `Global hotkey: ${hotkeyLabel(value).join(" + ") || "none"}. Activate to change`}
  onclick={() => (recording ? stopRecording() : start())}
  onkeydowncapture={onKey}
  onblur={stopRecording}
>
  {#if recording}
    <span class="rec"></span>
    <span class="hint">{hint}</span>
  {:else if value}
    {#each hotkeyLabel(value) as part, i (i)}
      {#if i > 0}<span class="plus">+</span>{/if}
      <span class="kbd">{part}</span>
    {/each}
    <span class="change">Change</span>
  {:else}
    <span class="hint">Click to set a shortcut</span>
  {/if}
</button>

<style>
  .hotkey {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: var(--ctl-lg);
    padding: 0 12px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
    text-align: left;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .hotkey:hover {
    border-color: var(--border-3);
  }
  .hotkey.recording {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .plus {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .change {
    margin-left: auto;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .hint {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .rec {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    animation: rec 1s var(--ease) infinite;
  }
  @keyframes rec {
    50% {
      opacity: 0.3;
    }
  }
</style>
