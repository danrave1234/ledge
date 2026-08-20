<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    settings,
    selectModel,
    setFetchedModels,
    addCustomModel,
    removeCustomModel,
    providerAuth,
    refreshProviderAuth,
    reopenLogin,
    FALLBACK_PROVIDER_ID,
  } from "$lib/stores";
  import { providers, getProvider, type ModelInfo } from "$lib/providers";
  import { curateModels } from "$lib/models";
  import { listOpenAiModels } from "$lib/native";
  import { scaleIn } from "$lib/motion";
  import { scale } from "svelte/transition";

  interface Group {
    id: string;
    label: string;
    models: ModelInfo[];
    /** Selectable but collapsed: dated snapshots and legacy families. */
    extra?: ModelInfo[];
  }

  let open = $state(false);
  let s = $derived($settings);
  let allGroups = $state<Group[]>([]);
  let customInput = $state("");
  let refreshing = $state(false);
  let refreshMsg = $state("");
  /** Per-group "Show all" state: snapshots stay collapsed until asked for. */
  let showAll = $state<Record<string, boolean>>({});

  // Build the full catalog (fallback lists + any live-fetched OpenAI IDs).
  $effect(() => {
    const fetched = s.fetchedModels ?? []; // persisted live-fetched models
    let cancelled = false;
    Promise.all(
      providers.map(async (p): Promise<Group> => ({
        id: p.id,
        label: p.label,
        models: await p.listModels(),
      })),
    ).then((groups) => {
      if (cancelled) return;
      if (fetched.length) {
        const openai = groups.find((g) => g.id === "openai");
        // Curated: base models only, newest family first. Snapshots and legacy
        // families move to `extra`, behind "Show all".
        if (openai) {
          const { primary, more } = curateModels(fetched);
          openai.models = primary;
          openai.extra = more;
        }
      }
      allGroups = groups;
    });
    return () => {
      cancelled = true;
    };
  });

  // Credentials decide what is listed. Re-checked whenever the menu opens, so a
  // key added in Settings shows up here without a restart.
  $effect(() => {
    if (open) void refreshProviderAuth();
  });

  /** False until the first auth check lands — until then the full catalog is
      shown rather than briefly claiming nothing is connected. */
  let authChecked = $derived(Object.keys($providerAuth).length > 0);
  let connected = $derived(
    authChecked ? allGroups.filter((g) => $providerAuth[g.id]) : allGroups,
  );
  /** Nothing is connected: offer only the Codex default, which needs no key
      from us, plus a way into the connect flow. */
  let noAccounts = $derived(authChecked && connected.length === 0);
  let visible = $derived(
    noAccounts
      ? allGroups
          .filter((g) => g.id === FALLBACK_PROVIDER_ID)
          .map((g) => ({
            ...g,
            models: g.models.slice(0, 1), // the provider's default entry only
          }))
      : connected,
  );

  /** The user's current model always appears in its group, even when it isn't in
      the provider's list (a typed ID, or one that only exists in a live list we
      haven't fetched this session). Otherwise a saved choice looks discarded. */
  let groups = $derived(
    visible.map((g) =>
      g.id === s.providerId && s.model && !g.models.some((m) => m.id === s.model)
        ? { ...g, models: [{ id: s.model, label: s.model }, ...g.models] }
        : g,
    ),
  );

  let custom = $derived(s.customModels ?? []);

  let currentLabel = $derived.by(() => {
    const provider = getProvider(s.providerId);
    const models = allGroups.find((g) => g.id === provider.id)?.models ?? [];
    return models.find((m) => m.id === s.model)?.label ?? s.model ?? provider.label;
  });

  /** The chosen model can't answer — flagged on the trigger so a failed send is
      never the first time the user finds out. */
  let currentUnavailable = $derived(authChecked && !$providerAuth[s.providerId]);

  function pick(providerId: string, model: string) {
    selectModel(providerId, model);
    open = false;
  }
  function addCustom() {
    const id = customInput.trim();
    if (!id) return;
    addCustomModel(id);
    selectModel(s.providerId, id);
    customInput = "";
    open = false;
  }
  function connect() {
    open = false;
    reopenLogin();
  }
  async function refresh() {
    refreshing = true;
    refreshMsg = "";
    try {
      const ids = await listOpenAiModels();
      setFetchedModels(ids);
      refreshMsg = ids.length ? `${ids.length} found` : "none";
    } catch {
      refreshMsg = "need API key";
    }
    refreshing = false;
  }
</script>

<div class="wrap">
  <button
    class="trigger"
    class:warn={currentUnavailable}
    onclick={() => (open = !open)}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls="model-menu"
  >
    <Icon name="spark" size={14} />
    <span class="lbl">{currentLabel}</span>
    <Icon name="chevron" size={13} />
  </button>
  {#if open}
    <button class="scrim" onclick={() => (open = false)} aria-label="Close"></button>
    <div
      class="menu"
      id="model-menu"
      role="listbox"
      aria-label="Models"
      transition:scale={scaleIn}
    >
      {#if noAccounts}
        <p class="notice">
          No account connected. Connect one to pick a model — or use the Codex default
          below once the Codex CLI is signed in.
        </p>
      {:else if currentUnavailable}
        <p class="notice">The selected model isn't connected anymore. Pick one below.</p>
      {/if}

      {#each groups as g (g.id)}
        <div class="ghead">
          <span>{g.label}</span>
          {#if g.id === "openai"}
            <button
              class="link-btn link-btn-accent tiny"
              onclick={refresh}
              disabled={refreshing}
            >
              {refreshing ? "…" : refreshMsg || "refresh"}
            </button>
          {/if}
        </div>
        {#each showAll[g.id] ? [...g.models, ...(g.extra ?? [])] : g.models as m (m.id)}
          <button
            class="item"
            class:sel={s.providerId === g.id && s.model === m.id}
            role="option"
            aria-selected={s.providerId === g.id && s.model === m.id}
            onclick={() => pick(g.id, m.id)}
          >
            <span>{m.label}</span>
            {#if s.providerId === g.id && s.model === m.id}
              <Icon name="check" size={14} />
            {/if}
          </button>
        {/each}
        {#if g.extra?.length}
          <button
            class="link-btn showall"
            aria-expanded={!!showAll[g.id]}
            onclick={() => (showAll[g.id] = !showAll[g.id])}
          >
            {showAll[g.id]
              ? "Show fewer"
              : `Show all ${g.models.length + g.extra.length} models`}
          </button>
        {/if}
      {/each}

      {#if custom.length}
        <div class="ghead"><span>Custom</span></div>
        {#each custom as id (id)}
          <div class="citem" class:sel={s.model === id}>
            <button class="citem-main" onclick={() => pick(s.providerId, id)}>{id}</button
            >
            <button
              class="link-btn x"
              onclick={() => removeCustomModel(id)}
              aria-label="Remove {id}">×</button
            >
          </div>
        {/each}
      {/if}

      {#if noAccounts}
        <button class="connect" onclick={connect}>
          <Icon name="key" size={14} /> Connect an account
        </button>
      {:else}
        <div class="addrow">
          <input
            class="cin"
            bind:value={customInput}
            placeholder="Type a model ID…"
            onkeydown={(e) => e.key === "Enter" && addCustom()}
          />
          <button class="cadd" onclick={addCustom}>Add</button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--ctl-sm);
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
    max-width: 240px;
    transition: background var(--dur) var(--ease);
  }
  .trigger:hover {
    background: var(--surface-2);
  }
  .trigger.warn {
    color: var(--text-3);
  }
  .lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    z-index: var(--z-menu);
  }
  .menu {
    position: absolute;
    top: 34px;
    left: 0;
    z-index: calc(var(--z-menu) + 1);
    min-width: 250px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    padding: 5px;
    max-height: 360px;
    overflow-y: auto;
    transform-origin: top left;
  }
  .notice {
    margin: 4px 5px 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: var(--lh);
  }
  .ghead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: var(--fs-xs);
    color: var(--text-3);
    padding: 8px 9px 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tiny {
    font-size: var(--fs-xs);
    text-transform: none;
    letter-spacing: 0;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 8px 9px;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    font-size: var(--fs-md);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background var(--dur) var(--ease);
  }
  .item:hover {
    background: var(--surface-2);
  }
  .item.sel {
    color: var(--accent-text);
  }
  .citem {
    display: flex;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .citem:hover {
    background: var(--surface-2);
  }
  .citem.sel .citem-main {
    color: var(--accent-text);
  }
  .citem-main {
    flex: 1;
    text-align: left;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: var(--fs-md);
    font-family: var(--mono);
    padding: 8px 9px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    font-size: var(--fs-xl);
    line-height: 1;
    padding: 4px 9px;
  }
  .x:hover {
    color: var(--danger);
  }
  .connect {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: var(--ctl-sm);
    margin-top: 4px;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    background: transparent;
    color: var(--accent-text);
    font-family: inherit;
    font-size: var(--fs-sm);
    font-weight: 500;
    cursor: pointer;
    transition: background var(--dur) var(--ease);
  }
  .connect:hover {
    background: var(--accent-weak);
  }
  .showall {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 9px 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .addrow {
    display: flex;
    gap: 5px;
    padding: 6px 5px 3px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .cin {
    flex: 1;
    min-width: 0;
    height: var(--ctl-sm);
    padding: 0 9px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--border-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--fs-sm);
    font-family: var(--mono);
    outline: none;
    transition: border-color var(--dur) var(--ease);
  }
  .cin:focus {
    border-color: var(--accent);
  }
  .cadd {
    flex-shrink: 0;
    height: var(--ctl-sm);
    padding: 0 12px;
    border-radius: var(--radius-xs);
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font-family: inherit;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
  }
</style>
