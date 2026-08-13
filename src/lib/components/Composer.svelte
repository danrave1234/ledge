<script lang="ts">
  import Icon from "./Icon.svelte";
  import { settings, ui, updateSettings } from "../stores";
  import { pluginActive } from "../plugins";
  import { send, stop } from "../controller";

  let text = $state("");
  let ta: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let attached = $state<string | null>(null);
  let s = $derived($settings);
  let generating = $derived($ui.generating);

  const EFFORTS = ["", "low", "medium", "high"];
  const EFFORT_LABELS: Record<string, string> = {
    "": "Auto",
    low: "Low",
    medium: "Med",
    high: "High",
  };
  function cycleEffort() {
    const i = EFFORTS.indexOf(s.effort ?? "");
    updateSettings({ effort: EFFORTS[(i + 1) % EFFORTS.length] });
  }

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 132) + "px";
  }

  async function submit() {
    const t = text;
    if (!t.trim() && !attached) return;
    text = "";
    const img = attached;
    attached = null;
    queueMicrotask(autosize);
    await send(t, img ?? undefined);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
  function pin() {
    ui.update((u) => ({ ...u, pinned: true }));
  }
  function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) {
      const reader = new FileReader();
      reader.onload = () => (attached = reader.result as string);
      reader.readAsDataURL(f);
    }
    input.value = "";
  }
</script>

<div class="composer">
  {#if attached}
    <div class="att">
      <img src={attached} alt="attachment" />
      <button class="rm" onclick={() => (attached = null)} aria-label="Remove attachment">
        <Icon name="x" size={12} />
      </button>
    </div>
  {/if}
  <div class="inputrow">
    <textarea
      bind:this={ta}
      bind:value={text}
      oninput={autosize}
      onkeydown={onKey}
      onfocus={pin}
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
        disabled={!text.trim() && !attached}
        aria-label="Send">
        <Icon name="send" size={16} />
      </button>
    {/if}
  </div>
  <div class="tools">
    {#if pluginActive(s, "web-search")}
      <button class="tog" class:on={s.webSearch} onclick={() => updateSettings({ webSearch: !s.webSearch })}>
        <Icon name="web" size={14} /> Web
      </button>
    {/if}
    {#if pluginActive(s, "screen-context")}
      <button class="tog" class:on={s.screenContext} onclick={() => updateSettings({ screenContext: !s.screenContext })}>
        <Icon name="screen" size={14} /> Screen
      </button>
    {/if}
    <button class="tog" onclick={() => fileInput?.click()}>
      <Icon name="clip" size={14} /> Attach
    </button>
    <button class="tog effort" class:on={s.effort} onclick={cycleEffort} title="Reasoning effort">
      <Icon name="spark" size={13} /> {EFFORT_LABELS[s.effort ?? ""]}
    </button>
  </div>
  <input bind:this={fileInput} type="file" accept="image/*" onchange={onFile} style="display:none" />
</div>

<style>
  .composer {
    border-top: 1px solid var(--border);
    padding: 10px 12px 11px;
  }
  .att {
    position: relative;
    display: inline-block;
    margin-bottom: 8px;
  }
  .att img {
    max-height: 56px;
    max-width: 120px;
    border-radius: 8px;
    border: 1px solid var(--border-2);
    display: block;
  }
  .rm {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: var(--surface-3);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .inputrow {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 13px;
    padding: 4px 8px 4px 12px;
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
    line-height: 20px;
    padding: 6px 0;
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
    color: var(--accent-on);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .send:hover {
    background: var(--accent-strong);
  }
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
    flex-wrap: wrap;
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
  .tog:hover {
    color: var(--text-2);
    border-color: var(--border-2);
  }
  .tog.on {
    color: var(--accent-text);
    background: var(--accent-weak);
    border-color: transparent;
  }
  .effort {
    margin-left: auto;
  }
</style>
