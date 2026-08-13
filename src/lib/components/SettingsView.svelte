<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { fade } from "svelte/transition";
  import {
    settings,
    updateSettings,
    conversations,
    clearHistory,
    addMemory,
    importMemories,
    toggleMemory,
    deleteMemory,
  } from "../stores";
  import { BUILTIN_PERSONAS } from "../personas";
  import { BUILTIN_PLUGINS, pluginEnabled, pluginInstalled, isCorePlugin } from "../plugins";
  import { togglePlugin, installPlugin, uninstallPlugin } from "../stores";
  import {
    saveApiKey,
    hasApiKey,
    clearApiKey,
    clearCache,
    checkForUpdates,
    installUpdate,
    codexLogin,
    codexLoggedIn,
    codexLogout,
    listMonitors,
    type MonitorInfo,
  } from "../native";
  import { stop } from "../controller";
  import type { Placement, HandleStyle, ThemeMode } from "../types";

  let s = $derived($settings);
  let convCount = $derived($conversations.length);

  const SECTIONS = [
    { id: "general", label: "General", icon: "settings" },
    { id: "appearance", label: "Appearance", icon: "sun" },
    { id: "personalization", label: "Personalization", icon: "user" },
    { id: "plugins", label: "Plugins", icon: "stack" },
    { id: "account", label: "Account", icon: "key" },
    { id: "storage", label: "Storage", icon: "database" },
  ] as const;
  let section = $state<string>("general");

  const placements: { v: Placement; l: string }[] = [
    { v: "top", l: "Top" },
    { v: "left", l: "Left" },
    { v: "right", l: "Right" },
  ];
  const handles: { v: HandleStyle; l: string }[] = [
    { v: "bar", l: "Bar" },
    { v: "spark", l: "Spark" },
    { v: "pulse", l: "Pulse" },
  ];
  const themes: { v: ThemeMode; l: string }[] = [
    { v: "system", l: "System" },
    { v: "light", l: "Light" },
    { v: "dark", l: "Dark" },
  ];
  const ACCENTS = ["", "#ff6a3d", "#7c5cff", "#2f9e6f", "#e0a13a", "#e0568a", "#3b82f6"];

  // account
  let keyInput = $state("");
  let connected = $state(false);
  let codexIn = $state(false);
  let monitors = $state<MonitorInfo[]>([]);
  onMount(async () => {
    connected = await hasApiKey();
    codexIn = await codexLoggedIn();
    monitors = await listMonitors();
  });
  async function saveKey() {
    await saveApiKey(keyInput);
    connected = await hasApiKey();
    keyInput = "";
  }
  async function clearKey() {
    await clearApiKey();
    connected = await hasApiKey();
  }

  // storage
  let cacheMsg = $state("");
  async function doClearCache() {
    try {
      await clearCache();
      cacheMsg = "Cache cleared — history and settings untouched.";
    } catch {
      cacheMsg = "Couldn't clear the cache.";
    }
    setTimeout(() => (cacheMsg = ""), 3500);
  }
  let confirmClear = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout>;
  function doClearHistory() {
    if (!confirmClear) {
      confirmClear = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmClear = false), 3000);
      return;
    }
    clearTimeout(confirmTimer);
    confirmClear = false;
    stop();
    clearHistory();
  }

  // updates
  let updateMsg = $state("");
  let updateAvail = $state(false);
  let updateVer = $state("");
  let checking = $state(false);
  let installing = $state(false);
  let installPct = $state(0);
  async function doCheckUpdate() {
    checking = true;
    updateMsg = "";
    try {
      const u = await checkForUpdates();
      if (u.available) {
        updateAvail = true;
        updateVer = u.version ?? "";
        updateMsg = `Update available: v${u.version}`;
      } else {
        updateAvail = false;
        updateMsg = "You're on the latest version.";
      }
    } catch {
      updateMsg = "Couldn't reach the update server.";
    } finally {
      checking = false;
    }
  }
  async function doInstallUpdate() {
    installing = true;
    try {
      await installUpdate((p) => (installPct = p));
    } catch {
      updateMsg = "Update failed to install.";
      installing = false;
    }
  }

  // codex sign-in
  let codexMsg = $state("");
  let codexBusy = $state(false);
  async function doCodexLogin() {
    codexBusy = true;
    codexMsg = "";
    if (await codexLoggedIn()) {
      codexIn = true;
      codexMsg = "";
      codexBusy = false;
      return;
    }
    const ok = await codexLogin();
    if (!ok) {
      codexMsg = "Codex CLI not found — install it: npm i -g @openai/codex";
      codexBusy = false;
      return;
    }
    codexMsg = "Opening sign-in in your browser…";
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (await codexLoggedIn()) {
        updateSettings({ providerId: "codex", model: "gpt-5.6-sol" });
        codexIn = true;
        codexMsg = "";
        codexBusy = false;
        return;
      }
    }
    codexBusy = false;
    codexMsg = "Not detected yet — finish sign-in, then click again.";
  }
  async function doCodexLogout() {
    codexBusy = true;
    await codexLogout();
    codexIn = await codexLoggedIn();
    codexBusy = false;
    codexMsg = codexIn ? "Couldn’t sign out — try again." : "";
    if (!codexIn && s.providerId === "codex") {
      updateSettings({ providerId: "openai", model: "gpt-5.6-sol" });
    }
  }

  // plugins (install-to-enable)
  let installingId = $state<string | null>(null);
  function doInstall(id: string) {
    installingId = id;
    setTimeout(() => {
      installPlugin(id);
      if (installingId === id) installingId = null;
    }, 700);
  }

  // personalization
  let memInput = $state("");
  let importText = $state("");
  let importMsg = $state("");
  function doAddMemory() {
    if (!memInput.trim()) return;
    addMemory(memInput);
    memInput = "";
  }
  function doImport() {
    const n = importMemories(importText);
    importText = "";
    importMsg = n ? `Imported ${n} ${n === 1 ? "memory" : "memories"}.` : "Nothing to import.";
    setTimeout(() => (importMsg = ""), 3500);
  }
</script>

<div class="settings">
  <nav>
    {#each SECTIONS as sec}
      <button class="nav" class:on={section === sec.id} onclick={() => (section = sec.id)}>
        <Icon name={sec.icon} size={16} />
        <span>{sec.label}</span>
      </button>
    {/each}
  </nav>

  <div class="content">
    {#key section}
      <div class="pane" in:fade={{ duration: 120 }}>
        {#if section === "general"}
          <h3>General</h3>
          <label class="lbl">Placement</label>
          <div class="seg">
            {#each placements as p}
              <button class:on={s.placement === p.v} onclick={() => updateSettings({ placement: p.v })}>{p.l}</button>
            {/each}
          </div>
          {#if monitors.length > 1}
            <label class="lbl">Display</label>
            <div class="seg">
              {#each monitors as m}
                <button
                  class:on={(s.display ?? -1) === m.index}
                  onclick={() => updateSettings({ display: m.index })}
                  title="{m.name} — {m.width}×{m.height}">
                  {m.primary ? "Main" : `Display ${m.index + 1}`}
                </button>
              {/each}
            </div>
            <p class="note" style="margin-top:6px">Which screen the widget docks to.</p>
          {/if}
          <label class="lbl">Handle style</label>
          <div class="seg">
            {#each handles as h}
              <button class:on={s.handle === h.v} onclick={() => updateSettings({ handle: h.v })}>{h.l}</button>
            {/each}
          </div>
          <div class="row">
            <div><span class="rl">Open on hover</span><span class="rh">Expand when you hover the handle</span></div>
            <button class="switch" class:on={s.hoverOpen} onclick={() => updateSettings({ hoverOpen: !s.hoverOpen })} aria-label="Toggle hover open"><i></i></button>
          </div>
          <div class="row">
            <div><span class="rl">Run on startup</span><span class="rh">Launch Perch when Windows starts</span></div>
            <button class="switch" class:on={s.autostart} onclick={() => updateSettings({ autostart: !s.autostart })} aria-label="Toggle autostart"><i></i></button>
          </div>
          <div class="row">
            <div><span class="rl">Game mode</span><span class="rh">Stay overlaid on top of games</span></div>
            <button class="switch" class:on={s.gameMode} onclick={() => updateSettings({ gameMode: !s.gameMode })} aria-label="Toggle game mode"><i></i></button>
          </div>
          {#if s.gameMode}
            <p class="note">Set fullscreen games to <b>Borderless / Windowed Fullscreen</b>. Exclusive-fullscreen and anti-cheat games (e.g. Valorant) can't be overlaid by any app.</p>
          {/if}
          <label class="lbl">Global hotkey</label>
          <input class="field" value={s.hotkey} oninput={(e) => updateSettings({ hotkey: (e.target as HTMLInputElement).value })} placeholder="Alt+Space" />
        {:else if section === "appearance"}
          <h3>Appearance</h3>
          <label class="lbl">Theme</label>
          <div class="seg">
            {#each themes as t}
              <button class:on={s.theme === t.v} onclick={() => updateSettings({ theme: t.v })}>{t.l}</button>
            {/each}
          </div>
          <label class="lbl">Accent</label>
          <div class="swatches">
            {#each ACCENTS as a}
              <button
                class="swatch"
                class:on={s.accent === a}
                style={a ? `background:${a}` : ""}
                class:def={a === ""}
                onclick={() => updateSettings({ accent: a })}
                aria-label={a || "Default"}>
                {#if a === ""}<Icon name="refresh" size={13} />{/if}
                {#if s.accent === a && a}<Icon name="check" size={13} />{/if}
              </button>
            {/each}
          </div>
          <label class="lbl">Custom CSS</label>
          <textarea class="field" rows="5" value={s.customCss} oninput={(e) => updateSettings({ customCss: (e.target as HTMLTextAreaElement).value })} placeholder="Override any token, e.g.  --radius: 20px;  --surface: #101014;"></textarea>
          <p class="note">Full control — every color, size, and radius is a CSS variable you can override here.</p>
        {:else if section === "personalization"}
          <h3>Personalization</h3>
          <p class="note" style="margin-top:0">Shared by every model — OpenAI, Codex, and the mock all use this, so they behave the same.</p>
          <label class="lbl">About you</label>
          <textarea class="field" rows="3" value={s.about} oninput={(e) => updateSettings({ about: (e.target as HTMLTextAreaElement).value })} placeholder="Your role, projects, what you're working toward… (paste your ChatGPT custom instructions)"></textarea>
          <label class="lbl">How Perch should respond</label>
          <textarea class="field" rows="3" value={s.style} oninput={(e) => updateSettings({ style: (e.target as HTMLTextAreaElement).value })} placeholder="Tone, format, length — how you like answers written"></textarea>

          <label class="lbl">Voice preset</label>
          <div class="chips">
            {#each BUILTIN_PERSONAS as p}
              <button class="chip" class:on={s.personaId === p.id} onclick={() => updateSettings({ personaId: p.id })}>{p.name}</button>
            {/each}
          </div>

          <div class="mhead">
            <label class="lbl" style="margin:0">Memory</label>
            <span class="count">{(s.memories ?? []).length}</span>
          </div>
          <div class="addrow">
            <input class="field" bind:value={memInput} placeholder="Remember something about you…" onkeydown={(e) => e.key === "Enter" && doAddMemory()} />
            <button class="btn" onclick={doAddMemory}>Add</button>
          </div>
          <div class="mems">
            {#each s.memories ?? [] as m (m.id)}
              <div class="mem" class:off={!m.enabled}>
                <button class="dot" class:on={m.enabled} onclick={() => toggleMemory(m.id)} aria-label="Toggle memory"></button>
                <span class="mtext">{m.text}</span>
                <button class="icon-btn" aria-label="Delete" onclick={() => deleteMemory(m.id)}><Icon name="trash" size={14} /></button>
              </div>
            {/each}
          </div>
          <label class="lbl">Import from ChatGPT</label>
          <textarea class="field" rows="3" bind:value={importText} placeholder="Paste your ChatGPT memories here — one per line — and import them all"></textarea>
          <div class="addrow">
            <button class="btn btn-accent" onclick={doImport}>Import memories</button>
            {#if importMsg}<span class="ok">{importMsg}</span>{/if}
          </div>
        {:else if section === "plugins"}
          <h3>Plugins</h3>
          <p class="note" style="margin-top:0">The core stays small. Install only what you need — each plugin adds tools or UI, and you can toggle or remove it anytime.</p>
          <div class="pgrid">
            {#each BUILTIN_PLUGINS as p (p.id)}
              {@const installed = pluginInstalled(s.installedPlugins, p.id)}
              <div class="pcard" class:on={installed && pluginEnabled(s.plugins, p.id)}>
                <div class="pico"><Icon name={p.icon} size={16} /></div>
                <div class="pname">{p.name}</div>
                <div class="pdesc">{p.description}</div>
                {#if installingId === p.id}
                  <span class="pinstalling">Downloading…</span>
                {:else if isCorePlugin(p.id)}
                  <div class="prow">
                    <button class="switch sm" class:on={pluginEnabled(s.plugins, p.id)} onclick={() => togglePlugin(p.id)} aria-label={"Toggle " + p.name}><i></i></button>
                    <span class="pcore">Built-in</span>
                  </div>
                {:else if installed}
                  <div class="prow">
                    <button class="switch sm" class:on={pluginEnabled(s.plugins, p.id)} onclick={() => togglePlugin(p.id)} aria-label={"Toggle " + p.name}><i></i></button>
                    <button class="premove" onclick={() => uninstallPlugin(p.id)}>Remove</button>
                  </div>
                {:else}
                  <button class="pinstall" onclick={() => doInstall(p.id)}><Icon name="download" size={13} /> Install</button>
                {/if}
              </div>
            {/each}
          </div>
          <p class="note">More plugins — including third-party ones you can add — are coming to this list.</p>
        {:else if section === "account"}
          <h3>Account</h3>
          {#if connected}
            <div class="connected"><Icon name="check" size={15} /> OpenAI API key saved <button class="mini" onclick={clearKey}>Remove</button></div>
          {:else}
            <label class="lbl">OpenAI API key</label>
            <input class="field" type="password" bind:value={keyInput} placeholder="sk-…" />
            <button class="btn btn-accent" style="margin-top:8px" onclick={saveKey}>Save key</button>
          {/if}
          <p class="note">Stored in Windows Credential Manager, never in plain text. Pick the “OpenAI (API key)” model to use it.</p>
          <label class="lbl">Codex subscription</label>
          {#if codexIn}
            <div class="connected"><Icon name="check" size={15} /> Signed in to Codex <button class="mini" onclick={doCodexLogout} disabled={codexBusy}>{codexBusy ? "…" : "Sign out"}</button></div>
            <p class="note">Using your ChatGPT plan via the Codex CLI. Pick a Codex model to chat with it.</p>
          {:else}
            <p class="note" style="margin-top:0">Install the official Codex CLI (<code>npm i -g @openai/codex</code>), then sign in with your ChatGPT plan and pick a Codex model.</p>
            <button class="btn" style="margin-top:8px" onclick={doCodexLogin} disabled={codexBusy}><Icon name="sparkles" size={15} /> {codexBusy ? "Checking…" : "Sign in with Codex"}</button>
          {/if}
          {#if codexMsg}<p class="note" style="margin-top:8px">{codexMsg}</p>{/if}
        {:else if section === "storage"}
          <h3>Storage</h3>
          <p class="note" style="margin-top:0">Chats, personalization, and settings live in the app-data folder — clearing the cache never loses them.</p>
          <button class="btn" onclick={doClearCache}><Icon name="refresh" size={15} /> Clear cache</button>
          {#if cacheMsg}<p class="ok">{cacheMsg}</p>{/if}
          <div class="row">
            <div><span class="rl">Clear cache on launch</span><span class="rh">Keeps Perch light over time</span></div>
            <button class="switch" class:on={s.clearCacheOnLaunch} onclick={() => updateSettings({ clearCacheOnLaunch: !s.clearCacheOnLaunch })} aria-label="Toggle clear cache on launch"><i></i></button>
          </div>
          <button class="btn danger" style="margin-top:6px" onclick={doClearHistory}>
            <Icon name="trash" size={15} /> {confirmClear ? "Click again to confirm" : `Clear conversation history (${convCount})`}
          </button>
          <label class="lbl">Updates</label>
          <button class="btn" onclick={doCheckUpdate} disabled={checking}><Icon name="download" size={15} /> {checking ? "Checking…" : "Check for updates"}</button>
          {#if updateMsg}<p class="note" style="margin-top:8px">{updateMsg}</p>{/if}
          {#if updateAvail}
            <button class="btn btn-accent" style="margin-top:8px" onclick={doInstallUpdate} disabled={installing}>{installing ? `Installing… ${installPct}%` : `Download and install v${updateVer}`}</button>
          {/if}
          <p class="ver">Perch 0.1.0</p>
        {/if}
      </div>
    {/key}
  </div>
</div>

<style>
  .settings {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  nav {
    width: 148px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    padding: 10px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 34px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.13s, color 0.13s;
  }
  .nav:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .nav.on {
    background: var(--accent-weak);
    color: var(--accent-text);
  }
  .content {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }
  .pane {
    padding: 16px 18px 22px;
  }
  h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 14px;
    letter-spacing: -0.01em;
  }
  .lbl {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 16px 0 7px;
  }
  .note {
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.55;
    margin: 8px 0 0;
  }
  .note b {
    color: var(--text-2);
    font-weight: 600;
  }
  code {
    font-family: var(--mono);
    font-size: 11px;
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: 5px;
  }
  .seg {
    display: flex;
    gap: 3px;
    background: var(--surface-2);
    padding: 3px;
    border-radius: var(--radius-sm);
  }
  .seg button {
    flex: 1;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 12.5px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.13s;
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  }
  .rl {
    font-size: 13.5px;
    display: block;
  }
  .rh {
    font-size: 11.5px;
    color: var(--text-3);
    margin-top: 2px;
    display: block;
  }
  .switch {
    flex-shrink: 0;
    width: 40px;
    height: 24px;
    border-radius: 999px;
    border: none;
    background: var(--surface-3);
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
  }
  .switch.on {
    background: var(--accent);
  }
  .switch i {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .switch.on i {
    transform: translateX(16px);
  }
  .switch.sm {
    width: 34px;
    height: 20px;
  }
  .switch.sm i {
    width: 14px;
    height: 14px;
  }
  .switch.sm.on i {
    transform: translateX(14px);
  }
  .swatches {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    transition: transform 0.1s;
  }
  .swatch.def {
    background: var(--surface-2);
    border-color: var(--border-2);
    color: var(--text-3);
  }
  .swatch.on {
    border-color: var(--text);
  }
  .swatch:active {
    transform: scale(0.9);
  }
  .chips,
  .swatches {
    margin-bottom: 2px;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid var(--border-2);
    background: transparent;
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.13s;
  }
  .chip.on {
    background: var(--accent-weak);
    border-color: transparent;
    color: var(--accent-text);
  }
  .mhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-top: 16px;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
  }
  .addrow {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
  }
  .addrow .field {
    flex: 1;
  }
  .mems {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .mem {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 11px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .mem.off {
    opacity: 0.5;
  }
  .dot {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: none;
    background: var(--text-3);
    cursor: pointer;
  }
  .dot.on {
    background: var(--accent);
  }
  .mtext {
    flex: 1;
    font-size: 12.5px;
    line-height: 1.45;
    user-select: text;
  }
  .pgrid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .pcard {
    position: relative;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 13px;
    background: var(--surface-2);
    transition: border-color 0.15s;
  }
  .pcard.on {
    border-color: var(--border-strong);
  }
  .pico {
    width: 32px;
    height: 32px;
    border-radius: 9px;
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 9px;
  }
  .pname {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .pdesc {
    font-size: 11.5px;
    color: var(--text-3);
    line-height: 1.5;
    margin-bottom: 8px;
  }
  .pcard .switch {
    margin-top: 2px;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .premove {
    border: none;
    background: transparent;
    color: var(--text-3);
    font-size: 11.5px;
    cursor: pointer;
    padding: 0;
  }
  .premove:hover {
    color: var(--danger);
  }
  .pcore {
    font-size: 11px;
    color: var(--text-3);
  }
  .pinstall {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 11px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    background: var(--surface);
    color: var(--text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .pinstall:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .pinstalling {
    font-size: 12px;
    color: var(--accent-text);
  }
  .connected {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ok);
    font-size: 13px;
  }
  .mini {
    border: none;
    background: transparent;
    color: var(--danger);
    font-size: 12px;
    cursor: pointer;
    margin-left: auto;
  }
  .btn.danger:hover {
    border-color: var(--danger);
    color: var(--danger);
  }
  .ok {
    font-size: 12px;
    color: var(--ok);
    margin: 8px 0 0;
  }
  .ver {
    color: var(--text-3);
    font-size: 11px;
    margin-top: 20px;
  }
</style>
