<script lang="ts">
  import Icon from "./Icon.svelte";
  import {
    settings,
    updateSettings,
    fetchedModels,
    addCustomModel,
    removeCustomModel,
  } from "../stores";
  import { providers, getProvider, type ModelInfo } from "../providers";
  import { listOpenAiModels } from "../native";
  import { scale } from "svelte/transition";

  let open = $state(false);
  let s = $derived($settings);
  let grouped = $state<{ id: string; label: string; models: ModelInfo[] }[]>([]);
  let customInput = $state("");
  let refreshing = $state(false);
  let refreshMsg = $state("");

  $effect(() => {
    const fm = $fetchedModels; // track live-fetched models
    let cancelled = false;
    Promise.all(
      providers.map(async (p) => ({
        id: p.id,
        label: p.label,
        models: await p.listModels(),
      })),
    ).then((g) => {
      if (cancelled) return;
      if (fm.length) {
        const oa = g.find((x) => x.id === "openai");
        if (oa) oa.models = fm.map((id) => ({ id, label: id }));
      }
      grouped = g;
    });
    return () => {
      cancelled = true;
    };
  });

  let custom = $derived(s.customModels ?? []);

  let currentLabel = $derived.by(() => {
    const prov = getProvider(s.providerId);
    const models = grouped.find((x) => x.id === prov.id)?.models ?? [];
    return models.find((m) => m.id === s.model)?.label ?? s.model ?? prov.label;
  });

  function pick(providerId: string, model: string) {
    updateSettings({ providerId, model });
    open = false;
  }
  function addCustom() {
    const id = customInput.trim();
    if (!id) return;
    addCustomModel(id);
    updateSettings({ model: id });
    customInput = "";
    open = false;
  }
  async function refresh() {
    refreshing = true;
    refreshMsg = "";
    try {
      const ids = await listOpenAiModels();
      fetchedModels.set(ids);
      refreshMsg = ids.length ? `${ids.length} found` : "none";
    } catch {
      refreshMsg = "need API key";
    }
    refreshing = false;
  }
</script>

<div class="wrap">
  <button class="trigger" onclick={() => (open = !open)}>
    <Icon name="spark" size={14} />
    <span class="lbl">{currentLabel}</span>
    <Icon name="chevron" size={13} />
  </button>
  {#if open}
    <button class="scrim" onclick={() => (open = false)} aria-label="Close"></button>
    <div class="menu" transition:scale={{ duration: 130, start: 0.95, opacity: 0 }}>
      {#each grouped as g}
        <div class="ghead">
          <span>{g.label}</span>
          {#if g.id === "openai"}
            <button class="mini" onclick={refresh} disabled={refreshing}>
              {refreshing ? "…" : refreshMsg || "refresh"}
            </button>
          {/if}
        </div>
        {#each g.models as m}
          <button
            class="item"
            class:sel={s.providerId === g.id && s.model === m.id}
            onclick={() => pick(g.id, m.id)}>
            <span>{m.label}</span>
            {#if s.providerId === g.id && s.model === m.id}
              <Icon name="check" size={14} />
            {/if}
          </button>
        {/each}
      {/each}

      {#if custom.length}
        <div class="ghead"><span>Custom</span></div>
        {#each custom as id (id)}
          <div class="citem" class:sel={s.model === id}>
            <button class="citem-main" onclick={() => pick(s.providerId, id)}>{id}</button>
            <button class="x" onclick={() => removeCustomModel(id)} aria-label="Remove">×</button>
          </div>
        {/each}
      {/if}

      <div class="addrow">
        <input
          class="cin"
          bind:value={customInput}
          placeholder="Type a model ID…"
          onkeydown={(e) => e.key === "Enter" && addCustom()} />
        <button class="cadd" onclick={addCustom}>Add</button>
      </div>
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
    height: 30px;
    padding: 0 8px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    max-width: 240px;
  }
  .trigger:hover {
    background: var(--surface-2);
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
    z-index: 20;
  }
  .menu {
    position: absolute;
    top: 34px;
    left: 0;
    z-index: 21;
    min-width: 250px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: 12px;
    box-shadow: var(--shadow);
    padding: 5px;
    max-height: 360px;
    overflow-y: auto;
    transform-origin: top left;
  }
  .ghead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-3);
    padding: 8px 9px 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mini {
    border: none;
    background: transparent;
    color: var(--accent-text);
    font-size: 10.5px;
    cursor: pointer;
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
    font-size: 13px;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
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
    border-radius: 8px;
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
    font-size: 13px;
    font-family: var(--mono);
    padding: 8px 9px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    border: none;
    background: transparent;
    color: var(--text-3);
    font-size: 16px;
    line-height: 1;
    padding: 4px 9px;
    cursor: pointer;
  }
  .x:hover {
    color: var(--danger);
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
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    border: 1px solid var(--border-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: 12.5px;
    font-family: var(--mono);
    outline: none;
  }
  .cin:focus {
    border-color: var(--accent);
  }
  .cadd {
    flex-shrink: 0;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    border: none;
    background: var(--accent);
    color: var(--accent-on);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
</style>
