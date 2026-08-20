<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    settings,
    updateSettings,
    setProvider,
    conversations,
    clearHistory,
    addMemory,
    importMemories,
    toggleMemory,
    deleteMemory,
    togglePlugin,
    installPlugin,
    uninstallPlugin,
    refreshProviderAuth,
    justUpdatedFrom,
    customPersonas,
    getPersona,
    flushWrites,
    ui,
    setSettingsSection,
  } from "$lib/stores";
  import { BUILTIN_PERSONAS } from "$lib/personas";
  import { buildSystemPrompt } from "$lib/prompt";
  import { toolCapabilities } from "$lib/tools";
  import { deletePluginData } from "$lib/plugin-data";
  import { pluginContexts, pluginSettingsPanels } from "$lib/plugins/registry";
  import {
    BUILTIN_PLUGINS,
    pluginEnabled,
    pluginInstalled,
    isCorePlugin,
  } from "$lib/plugins";
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
    waitForCodexLogin,
    listMonitors,
    appVersion,
    quitApp,
    type MonitorInfo,
  } from "$lib/native";
  import { setView, stop } from "$lib/controller";
  import { fadeIn } from "$lib/motion";
  import { fade } from "svelte/transition";
  import type { Placement, HandleStyle, ThemeMode } from "$lib/types";

  /** How long transient confirmations stay on screen. */
  const NOTICE_MS = 3500;
  /** Window for the second click of a destructive confirm. */
  const CONFIRM_MS = 3000;

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
  // Kept in the ui store, not local state: the panel unmounts while collapsed.
  let section = $derived($ui.settingsSection);

  const PLACEMENTS: { v: Placement; l: string }[] = [
    { v: "top", l: "Top" },
    { v: "left", l: "Left" },
    { v: "right", l: "Right" },
  ];
  const HANDLES: { v: HandleStyle; l: string }[] = [
    { v: "bar", l: "Bar" },
    { v: "spark", l: "Spark" },
    { v: "pulse", l: "Pulse" },
  ];
  const THEMES: { v: ThemeMode; l: string }[] = [
    { v: "system", l: "System" },
    { v: "light", l: "Light" },
    { v: "dark", l: "Dark" },
  ];
  const ACCENTS = ["", "#ff6a3d", "#7c5cff", "#2f9e6f", "#e0a13a", "#e0568a", "#3b82f6"];

  /* ---------- account ---------- */
  let keyInput = $state("");
  let connected = $state(false);
  let codexIn = $state(false);
  let monitors = $state<MonitorInfo[]>([]);
  let version = $state("");

  onMount(async () => {
    connected = await hasApiKey();
    codexIn = await codexLoggedIn();
    monitors = await listMonitors();
    version = await appVersion();
  });

  /** Re-read credentials and publish them, so the model picker and this screen
      never disagree about what is connected. */
  async function syncAuth() {
    connected = await hasApiKey();
    codexIn = await codexLoggedIn();
    await refreshProviderAuth();
  }

  async function saveKey() {
    await saveApiKey(keyInput);
    keyInput = "";
    await syncAuth();
    if (connected) setProvider("openai");
  }
  async function clearKey() {
    await clearApiKey();
    await syncAuth();
  }

  /* ---------- quit ---------- */
  let confirmQuit = $state(false);
  let quitTimer: ReturnType<typeof setTimeout>;
  /** Two-click confirm: an accidental quit on an always-on widget is annoying,
      and the first click is easy to make while reaching for a toggle. */
  async function doQuit() {
    if (!confirmQuit) {
      confirmQuit = true;
      clearTimeout(quitTimer);
      quitTimer = setTimeout(() => (confirmQuit = false), CONFIRM_MS);
      return;
    }
    clearTimeout(quitTimer);
    stop();
    // Persist anything still queued before the process goes away.
    try {
      await flushWrites();
    } finally {
      await quitApp();
    }
  }

  /* ---------- storage ---------- */
  let cacheMsg = $state("");
  async function doClearCache() {
    try {
      await clearCache();
      cacheMsg = "Cache cleared — history and settings untouched.";
    } catch {
      cacheMsg = "Couldn't clear the cache.";
    }
    setTimeout(() => (cacheMsg = ""), NOTICE_MS);
  }

  let confirmClear = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout>;
  function doClearHistory() {
    if (!confirmClear) {
      confirmClear = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmClear = false), CONFIRM_MS);
      return;
    }
    clearTimeout(confirmTimer);
    confirmClear = false;
    stop();
    clearHistory();
  }

  /* ---------- updates ---------- */
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
      // Installs, then relaunches. The next launch migrates settings and clears
      // the stale WebView cache (see stores/version.ts).
      await installUpdate((p) => (installPct = p));
    } catch {
      updateMsg = "Update failed to install.";
      installing = false;
    }
  }

  /* ---------- codex sign-in ---------- */
  let codexMsg = $state("");
  let codexBusy = $state(false);

  async function doCodexLogin() {
    codexBusy = true;
    codexMsg = "";
    try {
      if (await codexLoggedIn()) {
        await syncAuth();
        return;
      }
      if (!(await codexLogin())) {
        codexMsg = "Codex CLI not found — install it: npm i -g @openai/codex";
        return;
      }
      codexMsg = "Opening sign-in in your browser…";
      if (await waitForCodexLogin()) {
        await syncAuth();
        setProvider("codex");
        codexMsg = "";
      } else {
        codexMsg = "Not detected yet — finish sign-in, then click again.";
      }
    } finally {
      codexBusy = false;
    }
  }

  async function doCodexLogout() {
    codexBusy = true;
    await codexLogout();
    await syncAuth();
    codexBusy = false;
    codexMsg = codexIn ? "Couldn't sign out — try again." : "";
    if (!codexIn && s.providerId === "codex") setProvider("openai");
  }

  /* ---------- plugins (install-to-enable) ---------- */
  function doInstall(id: string) {
    installPlugin(id);
  }

  async function doRemovePlugin(id: string, name: string) {
    if (
      !window.confirm(`Remove ${name} and delete its saved settings and credentials?`)
    ) {
      return;
    }
    await deletePluginData(id);
    uninstallPlugin(id);
  }

  // Settings panels contributed by installed plugins, rendered under the grid.
  let panels = $derived(
    pluginSettingsPanels((id) => pluginInstalled(s.installedPlugins, id)),
  );

  /* ---------- personalization ---------- */
  let personaChoices = $derived([...BUILTIN_PERSONAS, ...$customPersonas]);
  let activePersona = $derived(getPersona(s.personaId));
  let showPrompt = $state(false);
  const previewConsent = { web: false, screen: false, music: false } as const;
  /** Base instructions. Relevant memories and turn-specific capability blocks
      are selected when the user sends a message. */
  let previewPrompt = $derived(
    buildSystemPrompt({
      persona: activePersona.prompt,
      about: s.about,
      style: s.style,
      memories: [],
      capabilities: toolCapabilities(s, previewConsent),
      pluginContext: pluginContexts(s, previewConsent),
    }),
  );

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
    importMsg = n
      ? `Imported ${n} ${n === 1 ? "memory" : "memories"}.`
      : "Nothing to import.";
    setTimeout(() => (importMsg = ""), NOTICE_MS);
  }
</script>

<div class="settings">
  <nav>
    {#each SECTIONS as sec (sec.id)}
      <button
        class="nav"
        class:on={section === sec.id}
        onclick={() => setSettingsSection(sec.id)}
      >
        <Icon name={sec.icon} size={16} />
        <span>{sec.label}</span>
      </button>
    {/each}
  </nav>

  <div class="content">
    {#key section}
      <div class="pane" in:fade={fadeIn}>
        {#if section === "general"}
          <h3>General</h3>
          <span class="lbl">Placement</span>
          <div class="seg">
            {#each PLACEMENTS as p (p.v)}
              <button
                class:on={s.placement === p.v}
                onclick={() => updateSettings({ placement: p.v })}
              >
                {p.l}
              </button>
            {/each}
          </div>
          {#if monitors.length > 1}
            <span class="lbl">Display</span>
            <div class="seg">
              {#each monitors as m (m.index)}
                <button
                  class:on={(s.display ?? -1) === m.index}
                  onclick={() => updateSettings({ display: m.index })}
                  title="{m.name} — {m.width}×{m.height}"
                >
                  {m.primary ? "Main" : `Display ${m.index + 1}`}
                </button>
              {/each}
            </div>
            <p class="note">
              Which screen the widget docks to — and captures for screen context.
            </p>
          {/if}
          <span class="lbl">Handle style</span>
          <div class="seg">
            {#each HANDLES as h (h.v)}
              <button
                class:on={s.handle === h.v}
                onclick={() => updateSettings({ handle: h.v })}
              >
                {h.l}
              </button>
            {/each}
          </div>
          <div class="row">
            <div>
              <span class="rl">Open on hover</span>
              <span class="rh">Expand when you hover the handle</span>
            </div>
            <button
              class="switch"
              class:on={s.hoverOpen}
              aria-pressed={s.hoverOpen}
              onclick={() => updateSettings({ hoverOpen: !s.hoverOpen })}
              aria-label="Toggle hover open"><i></i></button
            >
          </div>
          <div class="row">
            <div>
              <span class="rl">Run on startup</span>
              <span class="rh">Launch Perch when Windows starts</span>
            </div>
            <button
              class="switch"
              class:on={s.autostart}
              aria-pressed={s.autostart}
              onclick={() => updateSettings({ autostart: !s.autostart })}
              aria-label="Toggle autostart"><i></i></button
            >
          </div>
          <div class="row">
            <div>
              <span class="rl">Game mode</span>
              <span class="rh">Hide while any fullscreen app has focus</span>
            </div>
            <button
              class="switch"
              class:on={s.gameMode}
              aria-pressed={s.gameMode}
              onclick={() => updateSettings({ gameMode: !s.gameMode })}
              aria-label="Toggle game mode"><i></i></button
            >
          </div>
          {#if s.gameMode}
            <p class="note">
              A focused fullscreen app — borderless or exclusive — on any monitor hides
              Perch everywhere, even when it is docked on another display. It returns when
              you alt-tab away.
            </p>
          {/if}
          <label class="lbl" for="hotkey">Global hotkey</label>
          <input
            id="hotkey"
            class="field"
            value={s.hotkey}
            oninput={(e) =>
              updateSettings({ hotkey: (e.target as HTMLInputElement).value })}
            placeholder="CommandOrControl+Shift+Space"
          />

          <span class="lbl">Quit</span>
          <p class="note first">
            Collapsing hides Perch to the handle and it keeps running. Quitting closes it
            completely — reopen it from the Start menu{s.autostart
              ? ", or it will start again at your next sign-in since Run on startup is on"
              : ""}. It's also in the tray icon's menu.
          </p>
          <button class="btn btn-danger gap" onclick={doQuit}>
            <Icon name="power" size={15} />
            {confirmQuit ? "Click again to quit" : "Quit Perch"}
          </button>
        {:else if section === "appearance"}
          <h3>Appearance</h3>
          <span class="lbl">Theme</span>
          <div class="seg">
            {#each THEMES as t (t.v)}
              <button
                class:on={s.theme === t.v}
                onclick={() => updateSettings({ theme: t.v })}
              >
                {t.l}
              </button>
            {/each}
          </div>
          <span class="lbl">Accent</span>
          <div class="swatches">
            {#each ACCENTS as a (a)}
              <button
                class="swatch"
                class:on={s.accent === a}
                class:def={a === ""}
                style={a ? `background:${a}` : ""}
                onclick={() => updateSettings({ accent: a })}
                aria-label={a || "Default"}
              >
                {#if a === ""}<Icon name="refresh" size={13} />{/if}
                {#if s.accent === a && a}<Icon name="check" size={13} />{/if}
              </button>
            {/each}
          </div>
          <p class="note">
            The accent tints buttons, highlights, and the handle. Light accents
            automatically switch to dark text so labels stay readable.
          </p>
        {:else if section === "personalization"}
          <h3>Personalization</h3>
          <p class="note first">
            Shared by every model — OpenAI, Codex, and the mock all use this, so they
            behave the same.
          </p>
          <label class="lbl" for="about">About you</label>
          <textarea
            id="about"
            class="field"
            rows="3"
            value={s.about}
            oninput={(e) =>
              updateSettings({ about: (e.target as HTMLTextAreaElement).value })}
            placeholder="Your role, projects, what you're working toward… (paste your ChatGPT custom instructions)"
          ></textarea>
          <label class="lbl" for="style">How Perch should respond</label>
          <textarea
            id="style"
            class="field"
            rows="3"
            value={s.style}
            oninput={(e) =>
              updateSettings({ style: (e.target as HTMLTextAreaElement).value })}
            placeholder="Tone, format, length — how you like answers written"></textarea>

          <div class="mhead">
            <span class="lbl flush">Personality</span>
            <button class="link-btn link-btn-accent" onclick={() => setView("personas")}>
              Manage personas →
            </button>
          </div>
          <div class="chips">
            {#each personaChoices as p (p.id)}
              <button
                class="chip"
                class:on={s.personaId === p.id}
                onclick={() => updateSettings({ personaId: p.id })}>{p.name}</button
              >
            {/each}
          </div>
          <p class="note">{activePersona.prompt}</p>

          <div class="mhead">
            <span class="lbl flush">Memory</span>
            <span class="count">{s.memories.length}</span>
          </div>
          <div class="addrow">
            <input
              class="field"
              bind:value={memInput}
              placeholder="Remember something about you…"
              onkeydown={(e) => e.key === "Enter" && doAddMemory()}
            />
            <button class="btn" onclick={doAddMemory}>Add</button>
          </div>
          <div class="mems">
            {#each s.memories as m (m.id)}
              <div class="mem" class:off={!m.enabled}>
                <button
                  class="dot"
                  class:on={m.enabled}
                  onclick={() => toggleMemory(m.id)}
                  aria-label="Toggle memory"
                ></button>
                <span class="mtext">{m.text}</span>
                <button
                  class="icon-btn"
                  aria-label="Delete"
                  onclick={() => deleteMemory(m.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            {/each}
          </div>
          <label class="lbl" for="import">Import from ChatGPT</label>
          <textarea
            id="import"
            class="field"
            rows="3"
            bind:value={importText}
            placeholder="Paste your ChatGPT memories here — one per line — and import them all"
          ></textarea>
          <div class="addrow">
            <button class="btn btn-accent" onclick={doImport}>Import memories</button>
            {#if importMsg}<span class="ok">{importMsg}</span>{/if}
          </div>

          <div class="mhead">
            <span class="lbl flush">What the model receives</span>
            <button class="link-btn" onclick={() => (showPrompt = !showPrompt)}>
              {showPrompt ? "Hide" : "Show"}
            </button>
          </div>
          <p class="note first">
            Base instructions shared by every provider. Relevant memories, enabled tools,
            web results, and reviewed screen context are selected per message.
          </p>
          {#if showPrompt}
            <pre class="prompt">{previewPrompt}</pre>
          {/if}
        {:else if section === "plugins"}
          <h3>Plugins</h3>
          <p class="note first">
            The core stays small. Install only what you need — each plugin adds tools or
            UI, and you can toggle or remove it anytime.
          </p>
          <div class="pgrid">
            {#each BUILTIN_PLUGINS as p (p.id)}
              {@const installed = pluginInstalled(s.installedPlugins, p.id)}
              <div class="pcard" class:on={installed && pluginEnabled(s.plugins, p.id)}>
                <div class="pico"><Icon name={p.icon} size={16} /></div>
                <div class="pname">{p.name}</div>
                <div class="pdesc">{p.description}</div>
                {#if isCorePlugin(p.id)}
                  <div class="prow">
                    <button
                      class="switch sm"
                      class:on={pluginEnabled(s.plugins, p.id)}
                      aria-pressed={pluginEnabled(s.plugins, p.id)}
                      onclick={() => togglePlugin(p.id)}
                      aria-label={"Toggle " + p.name}><i></i></button
                    >
                    <span class="pcore">Built-in</span>
                  </div>
                {:else if installed}
                  <div class="prow">
                    <button
                      class="switch sm"
                      class:on={pluginEnabled(s.plugins, p.id)}
                      aria-pressed={pluginEnabled(s.plugins, p.id)}
                      onclick={() => togglePlugin(p.id)}
                      aria-label={"Toggle " + p.name}><i></i></button
                    >
                    <button
                      class="link-btn premove"
                      onclick={() => doRemovePlugin(p.id, p.name)}
                    >
                      Remove
                    </button>
                  </div>
                {:else}
                  <button class="btn btn-sm" onclick={() => doInstall(p.id)}>
                    <Icon name="download" size={13} /> Install
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          <!-- Per-plugin configuration, contributed by the plugin itself. The
               host renders the frame; what goes inside is the plugin's own. -->
          {#each panels as entry (entry.id)}
            {@const meta = BUILTIN_PLUGINS.find((p) => p.id === entry.id)}
            {@const Panel = entry.panel}
            <div class="ppanel">
              <div class="ppanel-head">
                <Icon name={meta?.icon ?? "stack"} size={14} />
                {meta?.name ?? entry.id} settings
              </div>
              <Panel />
            </div>
          {/each}

          <p class="note">
            More first-party integrations can be added through the registry.
          </p>
        {:else if section === "account"}
          <h3>Account</h3>
          {#if connected}
            <div class="connected">
              <Icon name="check" size={15} /> OpenAI API key saved
              <button class="link-btn link-btn-danger push" onclick={clearKey}
                >Remove</button
              >
            </div>
          {:else}
            <label class="lbl" for="apikey">OpenAI API key</label>
            <input
              id="apikey"
              class="field"
              type="password"
              bind:value={keyInput}
              placeholder="sk-…"
            />
            <button class="btn btn-accent gap" onclick={saveKey}>Save key</button>
          {/if}
          <p class="note">
            Stored in Windows Credential Manager, never in plain text. OpenAI models only
            appear in the model picker once a key is saved.
          </p>
          <span class="lbl">Codex subscription</span>
          {#if codexIn}
            <div class="connected">
              <Icon name="check" size={15} /> Signed in to Codex
              <button
                class="link-btn link-btn-danger push"
                onclick={doCodexLogout}
                disabled={codexBusy}
              >
                {codexBusy ? "…" : "Sign out"}
              </button>
            </div>
            <p class="note">Using your ChatGPT plan via the Codex CLI.</p>
          {:else}
            <p class="note first">
              Install the official Codex CLI (<code>npm i -g @openai/codex</code>), then
              sign in with your ChatGPT plan. The CLI keeps its own session — being signed
              into ChatGPT in your browser or IDE doesn't sign in the CLI, so this step is
              still needed.
            </p>
            <button class="btn gap" onclick={doCodexLogin} disabled={codexBusy}>
              <Icon name="sparkles" size={15} />
              {codexBusy ? "Checking…" : "Sign in with Codex"}
            </button>
          {/if}
          {#if codexMsg}<p class="note">{codexMsg}</p>{/if}
        {:else if section === "storage"}
          <h3>Storage</h3>
          <p class="note first">
            Chats, personalization, and settings live in the app-data folder — clearing
            the cache never loses them, and updates migrate them forward.
          </p>
          <button class="btn" onclick={doClearCache}>
            <Icon name="refresh" size={15} /> Clear cache
          </button>
          {#if cacheMsg}<p class="ok">{cacheMsg}</p>{/if}
          <div class="row">
            <div>
              <span class="rl">Clear cache on launch</span>
              <span class="rh">Keeps Perch light over time</span>
            </div>
            <button
              class="switch"
              class:on={s.clearCacheOnLaunch}
              aria-pressed={s.clearCacheOnLaunch}
              onclick={() =>
                updateSettings({ clearCacheOnLaunch: !s.clearCacheOnLaunch })}
              aria-label="Toggle clear cache on launch"><i></i></button
            >
          </div>
          <button class="btn btn-danger gap" onclick={doClearHistory}>
            <Icon name="trash" size={15} />
            {confirmClear
              ? "Click again to confirm"
              : `Clear conversation history (${convCount})`}
          </button>
          <span class="lbl">Updates</span>
          <button class="btn" onclick={doCheckUpdate} disabled={checking}>
            <Icon name="download" size={15} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {#if updateMsg}<p class="note">{updateMsg}</p>{/if}
          {#if updateAvail}
            <button
              class="btn btn-accent gap"
              onclick={doInstallUpdate}
              disabled={installing}
            >
              {installing
                ? `Installing… ${installPct}%`
                : `Download and install v${updateVer}`}
            </button>
          {/if}
          {#if $justUpdatedFrom}
            <p class="ok">Updated from v{$justUpdatedFrom} — your data was migrated.</p>
          {/if}
          <p class="ver">Perch {version || "—"}</p>
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
    height: var(--ctl);
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font-family: inherit;
    font-size: var(--fs-md);
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition:
      background var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
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
    font-size: var(--fs-xl);
    font-weight: 600;
    margin: 0 0 14px;
    letter-spacing: -0.01em;
  }
  .lbl {
    display: block;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 16px 0 7px;
  }
  .lbl.flush {
    margin: 0;
  }
  .note {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: var(--lh);
    margin: 8px 0 0;
  }
  /* First paragraph of a pane sits directly under the heading. */
  .note.first {
    margin-top: 0;
  }
  code {
    font-family: var(--mono);
    font-size: var(--fs-xs);
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
  }
  /* Buttons that follow a control need breathing room. */
  .gap {
    margin-top: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  }
  .rl {
    font-size: var(--fs-md);
    display: block;
  }
  .rh {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin-top: 2px;
    display: block;
  }
  .swatches {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 2px;
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
    transition: transform var(--press) var(--ease);
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
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin: 7px 0 2px;
  }
  .mhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 16px;
  }
  .count {
    font-size: var(--fs-sm);
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
    transition: background var(--dur) var(--ease);
  }
  .dot.on {
    background: var(--accent);
  }
  .mtext {
    flex: 1;
    font-size: var(--fs-sm);
    line-height: var(--lh-tight);
    user-select: text;
  }
  .ppanel {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .ppanel-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pgrid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .pcard {
    position: relative;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 13px;
    background: var(--surface-2);
    transition: border-color var(--dur) var(--ease);
  }
  .pcard.on {
    border-color: var(--border-2);
  }
  .pico {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 9px;
  }
  .pname {
    font-size: var(--fs-md);
    font-weight: 600;
    margin-bottom: 4px;
  }
  .pdesc {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: var(--lh-tight);
    margin-bottom: 8px;
  }
  .prow {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .premove:hover {
    color: var(--danger);
  }
  .pcore {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .connected {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ok);
    font-size: var(--fs-md);
  }
  .push {
    margin-left: auto;
  }
  .ok {
    font-size: var(--fs-sm);
    color: var(--ok);
    margin: 8px 0 0;
  }
  .prompt {
    margin: 8px 0 0;
    padding: 11px 12px;
    max-height: 220px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-2);
    font-family: var(--mono);
    font-size: var(--fs-xs);
    line-height: var(--lh);
    white-space: pre-wrap;
    user-select: text;
  }
  .ver {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin-top: 20px;
  }
</style>
