<script lang="ts">
  import Icon from "./Icon.svelte";
  import { updateSettings, completeOnboarding } from "../stores";
  import { saveApiKey, hasApiKey, codexAvailable, codexLogin } from "../native";
  import { fade, fly } from "svelte/transition";

  let step = $state<"choose" | "apikey" | "codex">("choose");
  let key = $state("");
  let err = $state("");
  let saving = $state(false);
  let codexBusy = $state(false);

  async function saveKeyAndFinish() {
    if (!key.trim()) {
      err = "Enter your API key.";
      return;
    }
    saving = true;
    err = "";
    try {
      await saveApiKey(key.trim());
      const ok = await hasApiKey();
      if (!ok) {
        err = "Couldn't save the key — check it and try again.";
        saving = false;
        return;
      }
      updateSettings({ providerId: "openai", model: "gpt-5" });
      completeOnboarding();
    } catch {
      err = "Couldn't save the key.";
      saving = false;
    }
  }
  async function chooseCodex() {
    codexBusy = true;
    const avail = await codexAvailable();
    if (avail) {
      await codexLogin(); // opens ChatGPT sign-in in the browser
      updateSettings({ providerId: "codex", model: "codex-default" });
      completeOnboarding();
    } else {
      codexBusy = false;
      step = "codex";
    }
  }
  function continueWithCodex() {
    updateSettings({ providerId: "codex", model: "codex-default" });
    completeOnboarding();
  }
  function useMock() {
    updateSettings({ providerId: "mock", model: "mock-smart" });
    completeOnboarding();
  }
</script>

<div class="onb" transition:fade={{ duration: 160 }}>
  <div class="inner" in:fly={{ y: 14, duration: 220 }}>
    <div class="brand">
      <span class="mark"><Icon name="sparkles" size={19} /></span> Perch
    </div>

    {#if step === "choose"}
      <h2>Welcome</h2>
      <p class="sub">Choose how Perch connects. You can change this anytime in Settings.</p>
      <button class="opt" onclick={() => (step = "apikey")}>
        <span class="oi"><Icon name="key" size={18} /></span>
        <span class="ot"><b>OpenAI API key</b><span>Paste your key — billed to your OpenAI account.</span></span>
        <Icon name="arrow-right" size={16} />
      </button>
      <button class="opt" onclick={chooseCodex} disabled={codexBusy}>
        <span class="oi"><Icon name="sparkles" size={18} /></span>
        <span class="ot"><b>Codex · your ChatGPT plan</b><span>Uses the official Codex CLI — we'll open sign-in if it's installed.</span></span>
        <Icon name="arrow-right" size={16} />
      </button>
      <button class="opt ghost" onclick={useMock}>
        <span class="ot"><b>Try the offline demo</b><span>No account — a mock assistant to explore the UI.</span></span>
      </button>
    {:else if step === "apikey"}
      <button class="back" onclick={() => (step = "choose")}><Icon name="back" size={14} /> Back</button>
      <h2>Add your OpenAI key</h2>
      <input class="field big" type="password" bind:value={key} placeholder="sk-…" onkeydown={(e) => e.key === "Enter" && saveKeyAndFinish()} />
      {#if err}<p class="err">{err}</p>{/if}
      <button class="btn btn-accent wide" onclick={saveKeyAndFinish} disabled={saving}>{saving ? "Saving…" : "Save and continue"}</button>
      <p class="fine">Stored in Windows Credential Manager, never in plain text.</p>
    {:else}
      <button class="back" onclick={() => (step = "choose")}><Icon name="back" size={14} /> Back</button>
      <h2>Install Codex CLI</h2>
      <p class="sub">Codex CLI isn't installed yet — that's why sign-in didn't open. Install it, then sign in with your ChatGPT plan.</p>
      <div class="cmd">npm i -g @openai/codex</div>
      <div class="cmd">codex login</div>
      <button class="btn btn-accent wide" onclick={chooseCodex} disabled={codexBusy}>{codexBusy ? "Checking…" : "I've installed it — sign in"}</button>
      <button class="ghostlink" onclick={continueWithCodex}>Continue anyway — I'll set it up later</button>
    {/if}
  </div>
</div>

<style>
  .onb {
    position: absolute;
    inset: 0;
    z-index: 40;
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
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 18px;
  }
  .mark {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    background: var(--accent);
    color: var(--accent-on);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  h2 {
    font-size: 22px;
    font-weight: 600;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }
  .sub {
    font-size: 13px;
    color: var(--text-2);
    margin: 0 0 18px;
    line-height: 1.5;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 13px 14px;
    border: 1px solid var(--border-2);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    margin-bottom: 9px;
    transition: border-color 0.15s, transform 0.06s;
  }
  .opt:hover {
    border-color: var(--accent);
  }
  .opt:active {
    transform: scale(0.99);
  }
  .opt.ghost {
    background: transparent;
    border-style: dashed;
  }
  .oi {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
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
    font-size: 13.5px;
    font-weight: 600;
  }
  .ot span {
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.45;
  }
  code {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--surface-3);
    padding: 0 4px;
    border-radius: 4px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 12.5px;
    cursor: pointer;
    padding: 0;
    margin-bottom: 14px;
  }
  .field.big {
    height: 42px;
    font-size: 14px;
  }
  .btn.wide {
    width: 100%;
    height: 42px;
    margin-top: 12px;
    font-size: 14px;
  }
  .err {
    color: var(--danger);
    font-size: 12.5px;
    margin: 8px 0 0;
  }
  .fine {
    font-size: 11.5px;
    color: var(--text-3);
    margin: 12px 0 0;
    text-align: center;
  }
  .cmd {
    font-family: var(--mono);
    font-size: 12.5px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    margin-bottom: 8px;
    user-select: text;
    color: var(--text);
  }
  .ghostlink {
    display: block;
    width: 100%;
    text-align: center;
    border: none;
    background: transparent;
    color: var(--text-3);
    font-size: 12.5px;
    cursor: pointer;
    margin-top: 12px;
  }
  .ghostlink:hover {
    color: var(--text-2);
  }
</style>
