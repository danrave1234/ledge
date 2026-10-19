<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { providers } from "$lib/providers";
  import { setProvider, completeOnboarding, refreshProviderAuth } from "$lib/stores";
  import {
    saveApiKey,
    hasApiKey,
    codexAvailable,
    codexLogin,
    codexLoggedIn,
    waitForCodexLogin,
  } from "$lib/native";
  import { fadeOverlay, flyIn, viewIn } from "$lib/motion";
  import { fade, fly } from "svelte/transition";

  type Step = "choose" | "apikey" | "codex" | "codexwait";

  let step = $state<Step>("choose");
  let key = $state("");
  let err = $state("");
  let saving = $state(false);
  let codexBusy = $state(false);
  let polling = $state(false);
  let pollMsg = $state("Complete sign-in in your browser…");

  /** Every exit from onboarding goes through here: pick the provider (with its
      own default model), refresh what's connected, then close. */
  async function finish(providerId?: string) {
    // Skipping in the browser preview lands on the offline demo model, the
    // only one that can answer there. (The packaged app has no mock provider.)
    const fallback = providers.some((p) => p.id === "mock") ? "mock" : undefined;
    const id = providerId ?? fallback;
    if (id) setProvider(id);
    await refreshProviderAuth();
    completeOnboarding();
  }

  function focusOnMount(node: HTMLElement) {
    queueMicrotask(() => node.focus());
  }

  async function saveKeyAndFinish() {
    if (!key.trim()) {
      err = "Enter your API key.";
      return;
    }
    if (!key.trim().startsWith("sk-")) {
      err = "That doesn't look like an OpenAI key — they start with “sk-”.";
      return;
    }
    saving = true;
    err = "";
    try {
      await saveApiKey(key.trim());
      if (!(await hasApiKey())) {
        err = "Couldn't save the key — check it and try again.";
        saving = false;
        return;
      }
      await finish("openai");
    } catch {
      err = "Couldn't save the key.";
      saving = false;
    }
  }

  async function chooseCodex() {
    codexBusy = true;
    if (!(await codexAvailable())) {
      codexBusy = false;
      step = "codex";
      return;
    }
    if (await codexLoggedIn()) {
      await finish("codex");
      return;
    }
    await codexLogin(); // opens ChatGPT sign-in in the browser
    codexBusy = false;
    step = "codexwait";
    pollCodex();
  }

  async function pollCodex() {
    polling = true;
    const ok = await waitForCodexLogin();
    polling = false;
    if (ok) await finish("codex");
    else pollMsg = "Not detected yet — finish the browser sign-in, then click below.";
  }

  async function recheckCodex() {
    if (await codexLoggedIn()) {
      await finish("codex");
      return;
    }
    pollMsg = "Still not signed in. Make sure the browser sign-in completed.";
  }
</script>

<div class="onb" transition:fade={fadeOverlay()}>
  <div
    class="inner"
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-title"
    in:fly={flyIn()}
  >
    <div class="brand">
      <span class="mark"><Icon name="ledge" size={19} /></span> Ledge
    </div>

    {#key step}
      <div class="step" in:fly={viewIn(step === "choose" ? -1 : 1)}>
        {#if step === "choose"}
          <h2 id="onboarding-title">Welcome</h2>
          <p class="sub">
            Choose how Ledge connects. You can change this anytime in Settings.
          </p>
          <button class="opt" onclick={() => (step = "apikey")}>
            <span class="oi"><Icon name="key" size={18} /></span>
            <span class="ot"
              ><b>OpenAI API key</b><span
                >Paste your key — billed to your OpenAI account.</span
              ></span
            >
            <Icon name="arrow-right" size={16} />
          </button>
          <button class="opt" onclick={chooseCodex} disabled={codexBusy}>
            <span class="oi"><Icon name="sparkles" size={18} /></span>
            <span class="ot"
              ><b>Codex · your ChatGPT plan</b><span
                >Uses the official Codex CLI — we'll open sign-in if it's installed.</span
              ></span
            >
            <Icon name="arrow-right" size={16} />
          </button>
          <button class="link-btn ghostlink" onclick={() => finish()}>
            Skip for now — set up later
          </button>
        {:else if step === "apikey"}
          <button class="link-btn back" onclick={() => (step = "choose")}>
            <Icon name="back" size={14} /> Back
          </button>
          <h2 id="onboarding-title">Add your OpenAI key</h2>
          <input
            class="field big"
            type="password"
            bind:value={key}
            placeholder="sk-…"
            autocomplete="off"
            aria-label="OpenAI API key"
            use:focusOnMount
            oninput={() => (err = "")}
            onkeydown={(e) => e.key === "Enter" && saveKeyAndFinish()}
          />
          {#if err}<p class="err" role="alert">{err}</p>{/if}
          <button
            class="btn btn-accent wide"
            onclick={saveKeyAndFinish}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save and continue"}
          </button>
          <p class="fine">Stored in Windows Credential Manager, never in plain text.</p>
        {:else if step === "codex"}
          <button class="link-btn back" onclick={() => (step = "choose")}>
            <Icon name="back" size={14} /> Back
          </button>
          <h2 id="onboarding-title">Install Codex CLI</h2>
          <p class="sub">
            Codex CLI isn't installed yet — that's why sign-in didn't open. Install it,
            then sign in with your ChatGPT plan.
          </p>
          <div class="cmd">npm i -g @openai/codex</div>
          <div class="cmd">codex login</div>
          <button class="btn btn-accent wide" onclick={chooseCodex} disabled={codexBusy}>
            {codexBusy ? "Checking…" : "I've installed it — sign in"}
          </button>
          <button class="link-btn ghostlink" onclick={() => finish("codex")}>
            Continue anyway — I'll set it up later
          </button>
        {:else}
          <button class="link-btn back" onclick={() => (step = "choose")}>
            <Icon name="back" size={14} /> Back
          </button>
          <h2 id="onboarding-title">Signing in to Codex…</h2>
          <p class="sub" role="status" aria-live="polite">{pollMsg}</p>
          <button class="btn btn-accent wide" onclick={recheckCodex}>
            {polling ? "Waiting for browser…" : "I've signed in"}
          </button>
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .onb {
    position: absolute;
    inset: 0;
    z-index: var(--z-modal);
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22px;
  }
  .inner {
    width: 100%;
    max-width: 380px;
  }
  .step {
    display: block;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: var(--fs-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 18px;
  }
  .mark {
    width: var(--ctl-sm);
    height: var(--ctl-sm);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-on);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h2 {
    font-size: var(--fs-2xl);
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }
  .sub {
    font-size: var(--fs-md);
    color: var(--text-2);
    margin: 0 0 18px;
    line-height: var(--lh);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 13px 14px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--text);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    margin-bottom: 9px;
    transition:
      border-color var(--dur) var(--ease),
      transform var(--press) var(--ease);
  }
  .opt:hover {
    border-color: var(--accent);
  }
  .opt:active {
    transform: scale(0.99);
  }
  .opt:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .oi {
    flex-shrink: 0;
    width: var(--ctl-lg);
    height: var(--ctl-lg);
    border-radius: var(--radius-md);
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ot {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ot b {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .ot span {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: var(--lh-tight);
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 14px;
  }
  .field.big {
    height: 42px;
    font-size: var(--fs-lg);
  }
  .btn.wide {
    width: 100%;
    height: 42px;
    margin-top: 12px;
    font-size: var(--fs-lg);
  }
  .err {
    color: var(--danger);
    font-size: var(--fs-sm);
    margin: 8px 0 0;
  }
  .fine {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 12px 0 0;
    text-align: center;
  }
  .cmd {
    font-family: var(--mono);
    font-size: var(--fs-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 9px 12px;
    margin-bottom: 8px;
    user-select: text;
    color: var(--text);
  }
  .ghostlink {
    display: block;
    width: 100%;
    text-align: center;
    color: var(--text-3);
    margin-top: 12px;
  }
</style>
