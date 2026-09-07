<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ScreenPreview from "$lib/components/ScreenPreview.svelte";
  import { settings, ui, updateSettings } from "$lib/stores";
  import { pluginActive } from "$lib/plugins";
  import { send, stop } from "$lib/controller";
  import { EFFORTS, EFFORT_LABELS } from "$lib/types";
  import type { ApprovedScreen, Attachment, TurnConsent } from "$lib/types";
  import { captureScreenshot } from "$lib/capture";
  import { extractDocument } from "$lib/native";
  import { canSend, isSupportedAttachment } from "$lib/attachments";
  import { screenContextState } from "$lib/plugins/screen-context/state";

  const MAX_TEXTAREA_H = 132;
  const screenContextPreferences = screenContextState.store;

  let text = $state("");
  let ta: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let attached = $state<Attachment | null>(null);
  let attachmentError = $state("");
  let web = $state(false);
  let screenEnabled = $state(false);
  let screen = $state<ApprovedScreen | null>(null);
  let music = $state(false);
  let capturingScreen = $state(false);
  let captureError = $state("");
  let s = $derived($settings);
  let generating = $derived($ui.generating);
  let reviewScreen = $derived($screenContextPreferences.reviewBeforeSend);
  let autoRedactScreen = $derived($screenContextPreferences.autoRedact);

  // The music toggle is the one control that lets the assistant act outside its
  // own window, so the first time it is switched on it asks. Afterwards the
  // chip behaves like any other toggle.
  let confirmingMusic = $state(false);

  function toggleMusic() {
    if (!music && !s.musicConfirmed) {
      confirmingMusic = true;
      return;
    }
    music = !music;
  }

  function allowMusic() {
    confirmingMusic = false;
    music = true;
    updateSettings({ musicConfirmed: true });
  }

  function cycleEffort() {
    const i = EFFORTS.indexOf(s.effort);
    updateSettings({ effort: EFFORTS[(i + 1) % EFFORTS.length] });
  }

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, MAX_TEXTAREA_H) + "px";
  }

  async function submit() {
    const t = text;
    if (!canSend(t, attached) && !screenEnabled) return;
    const approved = screenEnabled ? await captureCurrentScreen() : null;
    if (screenEnabled && !approved) return;
    text = "";
    const selected = attached;
    const consent: TurnConsent = { web, screen: !!approved, music };
    attached = null;
    queueMicrotask(autosize);
    await send(t, {
      attachment: selected ?? undefined,
      consent,
      approvedScreen: approved ?? undefined,
    });
  }

  async function toggleScreen() {
    screenEnabled = !screenEnabled;
    captureError = "";
    if (!screenEnabled) {
      screen = null;
    }
  }

  async function recaptureScreen() {
    await captureCurrentScreen(true);
  }

  async function captureCurrentScreen(
    clearAttachment = false,
  ): Promise<ApprovedScreen | null> {
    if (capturingScreen) return screen;
    capturingScreen = true;
    captureError = "";
    if (clearAttachment) attached = null;
    try {
      const cap = await captureScreenshot(undefined, "active-window", autoRedactScreen);
      screen = cap.image
        ? { image: cap.image, text: cap.text, redacted: cap.redacted }
        : null;
      captureError =
        cap.error ?? (cap.image ? "" : "Screen capture requires the desktop app.");
      return screen;
    } finally {
      capturingScreen = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }
  function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void attachFile(f);
    input.value = "";
  }

  async function attachFile(file: File) {
    attachmentError = "";
    const invalid = isSupportedAttachment(file);
    if (invalid) {
      attachmentError = invalid;
      return;
    }
    screen = null;
    try {
      if (file.type.startsWith("image/")) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read the image."));
          reader.readAsDataURL(file);
        });
        attached = {
          kind: "image",
          name: file.name,
          mime: file.type,
          size: file.size,
          data,
        };
      } else {
        attached = await extractDocument(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        );
      }
    } catch (error) {
      attachmentError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<div class="composer">
  {#if screen && reviewScreen}
    <ScreenPreview
      image={screen.image}
      onredact={(image) => (screen = { image, redacted: true })}
      onremove={() => (screen = null)}
      onrecapture={recaptureScreen}
    />
  {:else if capturingScreen}
    <div class="capture-status" aria-live="polite">Capturing screen…</div>
  {/if}
  {#if captureError}<div class="attachment-error" role="alert">{captureError}</div>{/if}
  {#if attached}
    <div class="att">
      {#if attached.kind === "image"}
        <img src={attached.data} alt={attached.name ?? "attachment"} />
      {:else}
        <div class="document">
          <Icon name="clip" size={16} />
          <span>
            <strong>{attached.name}</strong>
            <small>{attached.mime} · {Math.ceil(attached.size / 1024)} KB</small>
          </span>
        </div>
      {/if}
      <button class="rm" onclick={() => (attached = null)} aria-label="Remove attachment">
        <Icon name="x" size={12} />
      </button>
    </div>
  {/if}
  {#if attachmentError}
    <div class="attachment-error" role="alert">{attachmentError}</div>
  {/if}
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
        disabled={!canSend(text, attached) && !screenEnabled}
        aria-label="Send"
      >
        <Icon name="send" size={16} />
      </button>
    {/if}
  </div>
  {#if confirmingMusic}
    <div class="confirm">
      <p>
        Let Perch play, pause, and skip tracks in your music apps? It can only control
        what's already playing.
      </p>
      <div class="confirm-actions">
        <button class="btn btn-sm" onclick={() => (confirmingMusic = false)}>
          Not now
        </button>
        <button class="btn btn-sm btn-accent" onclick={allowMusic}>Allow</button>
      </div>
    </div>
  {/if}
  <div class="tools">
    {#if pluginActive(s, "web-search")}
      <button class="chip" class:on={web} aria-pressed={web} onclick={() => (web = !web)}>
        <Icon name="web" size={14} /> Web
      </button>
    {/if}
    {#if pluginActive(s, "screen-context")}
      <button
        class="chip"
        class:on={screenEnabled}
        aria-pressed={screenEnabled}
        disabled={capturingScreen}
        onclick={toggleScreen}
      >
        <Icon name="screen" size={14} /> Screen
      </button>
    {/if}
    {#if pluginActive(s, "music")}
      <button class="chip" class:on={music} aria-pressed={music} onclick={toggleMusic}>
        <Icon name="music" size={14} /> Music
      </button>
    {/if}
    <button class="chip" aria-pressed={!!attached} onclick={() => fileInput?.click()}>
      <Icon name="clip" size={14} /> Attach
    </button>
    <button
      class="chip effort"
      class:on={s.effort !== ""}
      onclick={cycleEffort}
      title="Reasoning effort"
    >
      <Icon name="spark" size={13} />
      {EFFORT_LABELS[s.effort]}
    </button>
  </div>
  <input
    bind:this={fileInput}
    type="file"
    accept="image/*,.txt,.md,.json,.csv,.pdf"
    onchange={onFile}
    hidden
  />
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
  .capture-status {
    margin-bottom: 8px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .att img {
    max-height: 56px;
    max-width: 120px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    display: block;
  }
  .document {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 180px;
    padding: 8px 10px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .document span {
    display: flex;
    flex-direction: column;
  }
  .document small {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .attachment-error {
    margin-bottom: 8px;
    color: var(--danger);
    font-size: var(--fs-sm);
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
    border-radius: var(--radius-lg);
    padding: 4px 8px 4px 12px;
    transition: border-color var(--dur) var(--ease);
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
    font-size: var(--fs-md);
    line-height: 20px;
    padding: 6px 0;
    /* Keep in sync with MAX_TEXTAREA_H above. */
    max-height: 132px;
    user-select: text;
  }
  textarea::placeholder {
    color: var(--text-3);
  }
  .send {
    flex-shrink: 0;
    width: var(--ctl-sm);
    height: var(--ctl-sm);
    border-radius: var(--radius-sm);
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      opacity var(--dur) var(--ease);
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
  .confirm {
    margin-top: 8px;
    padding: 9px 11px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .confirm p {
    margin: 0 0 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: var(--lh);
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .tools {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  /* Reasoning effort sits apart from the context toggles. */
  .effort {
    margin-left: auto;
  }
</style>
