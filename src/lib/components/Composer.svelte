<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ScreenPreview from "$lib/components/ScreenPreview.svelte";
  import {
    settings,
    ui,
    updateSettings,
    setDraft,
    composerRequest,
    toast,
  } from "$lib/stores";
  import { pluginActive } from "$lib/plugins";
  import { send, stop } from "$lib/controller";
  import { EFFORTS, EFFORT_LABELS } from "$lib/types";
  import type { ApprovedScreen, Attachment, Effort, TurnConsent } from "$lib/types";
  import { captureScreenshot } from "$lib/capture";
  import { extractDocument } from "$lib/native";
  import { canSend, isSupportedAttachment } from "$lib/attachments";
  import { screenContextState } from "$lib/plugins/screen-context/state";
  import { popIn, slideIn } from "$lib/motion";
  import { scale, slide } from "svelte/transition";
  import { get } from "svelte/store";
  import { onMount, tick } from "svelte";

  const MAX_TEXTAREA_H = 132;
  const screenContextPreferences = screenContextState.store;

  /** Longer names for the effort menu than the chip has room for. */
  const EFFORT_HINTS: Record<Effort, string> = {
    "": "Let the model decide",
    none: "Fastest, no extra thinking",
    low: "Quick answers",
    medium: "Balanced",
    high: "Think it through",
    xhigh: "Very thorough",
    max: "Slowest, most careful",
  };

  // Seeded from the store so a half-written message survives the panel closing.
  let text = $state(get(ui).draft);
  let ta: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let attached = $state<Attachment | null>(null);
  let attachmentError = $state("");
  let web = $state(false);
  let screenEnabled = $state(false);
  let screen = $state<ApprovedScreen | null>(null);
  /** The capture as taken, so redactions can be undone (including its OCR text,
      which a redaction deliberately drops). */
  let capturedScreen = $state<ApprovedScreen | null>(null);
  let music = $state(false);
  let capturingScreen = $state(false);
  let captureError = $state("");
  let dragging = $state(false);
  let effortOpen = $state(false);
  let s = $derived($settings);
  let generating = $derived($ui.generating);
  let reviewScreen = $derived($screenContextPreferences.reviewBeforeSend);
  let autoRedactScreen = $derived($screenContextPreferences.autoRedact);
  let sendable = $derived(canSend(text, attached) || screenEnabled);

  $effect(() => setDraft(text));

  onMount(autosize);

  let onboarded = $derived($settings.onboarded);
  $effect(() => {
    // Opening the panel (or finishing onboarding) means you're about to type.
    // One frame later, because SvelteKit resets focus to <body> right after the
    // app starts — focusing during mount had that reset read as "focus left
    // the panel", collapsing it. Never under the onboarding, which owns the
    // screen.
    if (!onboarded) return;
    const frame = requestAnimationFrame(() => ta?.focus());
    return () => cancelAnimationFrame(frame);
  });

  // One-shot requests from elsewhere (empty-state suggestions).
  $effect(() => {
    const req = $composerRequest;
    if (!req) return;
    composerRequest.set(null);
    text = req.text;
    if (req.web && pluginActive(s, "web-search")) web = true;
    if (req.screen && pluginActive(s, "screen-context")) screenEnabled = true;
    tick().then(() => {
      autosize();
      if (req.send) void submit();
      else {
        ta?.focus();
        ta?.setSelectionRange(text.length, text.length);
      }
    });
  });

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

  function pickEffort(effort: Effort) {
    updateSettings({ effort });
    effortOpen = false;
  }

  function autosize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, MAX_TEXTAREA_H) + "px";
  }

  async function submit() {
    if (generating) return;
    const t = text;
    if (!canSend(t, attached) && !screenEnabled) return;
    let approved: ApprovedScreen | null = null;
    if (screenEnabled) {
      // "Review before send": the first press captures and shows the image,
      // the second press sends exactly what was reviewed (and any redaction).
      // It used to capture and send in one go, so the review step showed the
      // screenshot only after it had already left.
      if (reviewScreen && !screen) {
        await captureCurrentScreen();
        return;
      }
      approved = reviewScreen ? screen : await captureCurrentScreen();
      if (!approved) return;
    }
    text = "";
    const selected = attached;
    const consent: TurnConsent = { web, screen: !!approved, music };
    attached = null;
    screen = null;
    queueMicrotask(autosize);
    await send(t, {
      attachment: selected ?? undefined,
      consent,
      approvedScreen: approved ?? undefined,
    });
  }

  function toggleScreen() {
    screenEnabled = !screenEnabled;
    captureError = "";
    if (!screenEnabled) screen = null;
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
      capturedScreen = screen;
      captureError =
        cap.error ?? (cap.image ? "" : "Screen capture requires the desktop app.");
      return screen;
    } finally {
      capturingScreen = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
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

  /** Paste an image (a screenshot from Snipping Tool, a copied picture). */
  function onPaste(e: ClipboardEvent) {
    const file = [...(e.clipboardData?.files ?? [])][0];
    if (!file) return;
    e.preventDefault();
    void attachFile(file);
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragging = true;
  }

  function onDrop(e: DragEvent) {
    dragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    e.preventDefault();
    void attachFile(file);
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
          name: file.name || "Pasted image",
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
      toast(`Attached ${attached?.name ?? "file"}`, { tone: "ok" });
      ta?.focus();
    } catch (error) {
      attachmentError = error instanceof Error ? error.message : String(error);
    }
  }
</script>

<!-- Capture phase, so Esc closes the effort menu before the panel collapses. -->
<svelte:window
  onkeydowncapture={(e) => {
    if (effortOpen && e.key === "Escape") {
      e.preventDefault();
      effortOpen = false;
    }
  }}
/>

<div
  class="composer"
  class:dragging
  role="region"
  aria-label="Message composer"
  ondragover={onDragOver}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  {#if dragging}
    <div class="dropzone" transition:scale={popIn()}>
      <Icon name="clip" size={16} /> Drop to attach
    </div>
  {/if}
  {#if screen && reviewScreen}
    <div transition:slide={slideIn()}>
      <ScreenPreview
        image={screen.image}
        redacted={screen.image !== capturedScreen?.image}
        onredact={(image) => (screen = { image, redacted: true })}
        onreset={() => (screen = capturedScreen)}
        onremove={() => (screen = null)}
        onrecapture={recaptureScreen}
      />
    </div>
  {:else if capturingScreen}
    <div class="capture-status" aria-live="polite" transition:slide={slideIn()}>
      <span class="spinner"></span> Capturing screen…
    </div>
  {/if}
  {#if captureError}
    <div class="attachment-error" role="alert" transition:slide={slideIn()}>
      {captureError}
    </div>
  {/if}
  {#if attached}
    <div class="att" transition:scale={popIn()}>
      {#if attached.kind === "image"}
        <img src={attached.data} alt={attached.name ?? "attachment"} />
      {:else}
        <div class="document">
          <Icon name="file" size={16} />
          <span>
            <strong>{attached.name}</strong>
            <small>{attached.mime} · {Math.ceil(attached.size / 1024)} KB</small>
          </span>
        </div>
      {/if}
      <button
        class="rm"
        onclick={() => (attached = null)}
        aria-label="Remove attachment"
        title="Remove attachment"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  {/if}
  {#if attachmentError}
    <div class="attachment-error" role="alert" transition:slide={slideIn()}>
      {attachmentError}
    </div>
  {/if}
  <div class="inputrow">
    <label for="composer-input" class="sr-only">Message</label>
    <textarea
      id="composer-input"
      bind:this={ta}
      bind:value={text}
      oninput={autosize}
      onkeydown={onKey}
      onpaste={onPaste}
      rows="1"
      placeholder={screenEnabled && reviewScreen && !screen
        ? "Ask about your screen — Send captures it for review first"
        : "Ask Ledge anything…"}></textarea>
    {#if generating}
      <button class="send stop" onclick={stop} aria-label="Stop" title="Stop (Esc)">
        <Icon name="stop" size={15} />
      </button>
    {:else}
      <button
        class="send"
        class:ready={sendable}
        onclick={submit}
        disabled={!sendable}
        aria-label={screenEnabled && reviewScreen && !screen
          ? "Capture screen for review"
          : "Send"}
        title={screenEnabled && reviewScreen && !screen
          ? "Capture screen for review"
          : "Send (Enter) · new line (Shift+Enter)"}
      >
        <Icon
          name={screenEnabled && reviewScreen && !screen ? "screen" : "send"}
          size={16}
        />
      </button>
    {/if}
  </div>
  {#if confirmingMusic}
    <div class="confirm" transition:slide={slideIn()}>
      <p>
        Let Ledge play, pause, and skip tracks in your music apps? It can only control
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
      <button
        class="chip"
        class:on={web}
        aria-pressed={web}
        title="Search the web for this message"
        onclick={() => (web = !web)}
      >
        <Icon name="web" size={14} /> Web
      </button>
    {/if}
    {#if pluginActive(s, "screen-context")}
      <button
        class="chip"
        class:on={screenEnabled}
        aria-pressed={screenEnabled}
        disabled={capturingScreen}
        title="Let Ledge see the window you were using, for this message only"
        onclick={toggleScreen}
      >
        <Icon name="screen" size={14} /> Screen
      </button>
    {/if}
    {#if pluginActive(s, "music")}
      <button
        class="chip"
        class:on={music}
        aria-pressed={music}
        title="Let Ledge control your music for this message"
        onclick={toggleMusic}
      >
        <Icon name="music" size={14} /> Music
      </button>
    {/if}
    <button
      class="chip"
      class:on={!!attached}
      title="Attach an image or document — or paste / drop one"
      onclick={() => fileInput?.click()}
    >
      <Icon name="clip" size={14} /> Attach
    </button>
    <div class="effort-wrap">
      <button
        class="chip"
        class:on={s.effort !== ""}
        aria-haspopup="menu"
        aria-expanded={effortOpen}
        title="Reasoning effort — how hard the model thinks"
        onclick={() => (effortOpen = !effortOpen)}
      >
        <Icon name="gauge" size={14} />
        Effort: {EFFORT_LABELS[s.effort]}
      </button>
      {#if effortOpen}
        <button
          class="scrim"
          aria-label="Close effort menu"
          onclick={() => (effortOpen = false)}
        ></button>
        <div
          class="effort-menu"
          role="menu"
          aria-label="Reasoning effort"
          transition:scale={popIn()}
        >
          {#each EFFORTS as effort (effort)}
            <button
              class="effort-item"
              class:sel={s.effort === effort}
              role="menuitemradio"
              aria-checked={s.effort === effort}
              onclick={() => pickEffort(effort)}
            >
              <span class="ename">{EFFORT_LABELS[effort]}</span>
              <span class="ehint">{EFFORT_HINTS[effort]}</span>
              {#if s.effort === effort}<Icon name="check" size={13} />{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
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
    position: relative;
    border-top: 1px solid var(--border);
    padding: 10px 12px 11px;
    transition: background var(--dur) var(--ease);
  }
  .composer.dragging {
    background: var(--accent-weak);
  }
  .dropzone {
    position: absolute;
    inset: 6px;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    color: var(--accent-text);
    font-size: var(--fs-md);
    font-weight: 600;
    pointer-events: none;
  }
  .att {
    position: relative;
    display: inline-block;
    margin-bottom: 8px;
  }
  .capture-status {
    display: flex;
    align-items: center;
    gap: 8px;
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
    transition: background var(--dur) var(--ease);
  }
  .rm:hover {
    background: var(--danger);
    color: var(--knob);
  }
  .inputrow {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 4px 5px 4px 12px;
    transition:
      border-color var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  .inputrow:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-weak);
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
    background: var(--surface-3);
    color: var(--text-3);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease),
      transform var(--dur) var(--ease-spring);
  }
  /* The send button lights up only once there is something to send. */
  .send.ready {
    background: var(--accent);
    color: var(--accent-on);
  }
  .send.ready:hover {
    background: var(--accent-strong);
  }
  .send:active {
    transform: scale(0.9);
  }
  .send:disabled {
    cursor: default;
  }
  .send.stop {
    background: var(--text);
    color: var(--surface);
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
  .tools .chip {
    transition:
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      color var(--dur) var(--ease),
      transform var(--press) var(--ease);
  }
  .tools .chip:active {
    transform: scale(0.95);
  }
  /* Reasoning effort sits apart from the context toggles. */
  .effort-wrap {
    position: relative;
    margin-left: auto;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    z-index: var(--z-menu);
  }
  .effort-menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: calc(var(--z-menu) + 1);
    width: 230px;
    padding: 5px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow);
    transform-origin: bottom right;
  }
  .effort-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    width: 100%;
    padding: 6px 9px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease);
  }
  .effort-item:hover {
    background: var(--surface-2);
  }
  .effort-item.sel {
    color: var(--accent-text);
  }
  .ename {
    font-size: var(--fs-md);
  }
  .ehint {
    grid-column: 1;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .effort-item :global(svg) {
    grid-column: 2;
    grid-row: 1 / span 2;
  }
</style>
