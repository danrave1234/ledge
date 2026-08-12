<script lang="ts">
  import Icon from "./Icon.svelte";
  import { settings, ui, updateSettings } from "../stores";
  import { pluginActive } from "../plugins";
  import { send, stop } from "../controller";

  let text = $state("");
  let ta: HTMLTextAreaElement | undefined = $state();
  let s = $derived($settings);
  let generating = $derived($ui.generating);

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 132) + "px";
  }

  async function submit() {
    const t = text;
    if (!t.trim()) return;
    text = "";
    queueMicrotask(autosize);
    await send(t);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="composer">
  <div class="inputrow">
    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={autosize}
      onkeydown={onKey}
      rows="1"
      placeholder="Message your assistant…"></textarea>
    {#if generating}
      <button class="send stop" onclick={stop} aria-label="Stop">
        <Icon name="stop" size={15} />
      </button>
    {:else}
      <button
        class="send"
        onclick={submit}
        disabled={!text.trim()}
        aria-label="Send">
        <Icon name="send" size={16} />
      </button>
    {/if}
  </div>
  <div class="tools">
    {#if pluginActive(s, "web-search")}
      <button
        class="tog"
        class:on={s.webSearch}
        onclick={() => updateSettings({ webSearch: !s.webSearch })}>
        <Icon name="web" size={14} /> Web
      </button>
    {/if}
    {#if pluginActive(s, "screen-context")}
      <button
        class="tog"
        class:on={s.screenContext}
        onclick={() => updateSettings({ screenContext: !s.screenContext })}>
        <Icon name="screen" size={14} /> Screen
      </button>
    {/if}
    <button class="tog" disabled aria-label="Attach (coming soon)">
      <Icon name="clip" size={14} /> Attach
    </button>
  </div>
</div>

<style>
  .composer {
    border-top: 1px solid var(--border);
    padding: 10px 12px 11px;
  }
  .inputrow {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 13px;
    padding: 7px 8px 7px 11px;
  }
  .inputrow:focus-within {
    border-color: var(--accent);
  }
  textarea {
    flex: 1;
    border: none;
    background: transparent;
    resize: none;
    outline: none;
    color: var(--text);
    font-family: inherit;
    font-size: 13.5px;
    line-height: 1.5;
    max-height: 132px;
    user-select: text;
  }
  textarea::placeholder {
    color: var(--text-3);
  }
  .send {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    border: none;
    background: var(--accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .send:hover { background: var(--accent-strong); }
  .send:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .send.stop {
    background: var(--surface-3);
    color: var(--text);
  }
  .tools {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .tog {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-3);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tog:hover:not(:disabled) {
    color: var(--text-2);
    border-color: var(--border-2);
  }
  .tog.on {
    color: var(--accent-text);
    background: var(--accent-weak);
    border-color: transparent;
  }
  .tog:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
