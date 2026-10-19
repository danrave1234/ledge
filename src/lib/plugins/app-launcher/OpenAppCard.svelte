<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { launchApp, type LaunchableApp } from "$lib/native";
  import type { CardResolution } from "$lib/types";

  interface CardData {
    app?: LaunchableApp;
    alternatives?: LaunchableApp[];
    query?: string;
  }

  let {
    data = {},
    resolved,
    onresolve,
  }: {
    data?: CardData;
    resolved?: CardResolution;
    onresolve?: (r: CardResolution) => void;
  } = $props();
  // The user may switch to an alternative before approving; the approved app
  // is whatever is selected when Open is pressed, never the model's guess alone.
  // Card data is immutable once attached, so seeding from the initial value is
  // intentional.
  // svelte-ignore state_referenced_locally
  let selected: LaunchableApp | undefined = $state(data.app);
  // svelte-ignore state_referenced_locally
  let status = $state(resolved?.status ?? "pending");
  let error = $state("");

  const choices = $derived(
    [data.app, ...(data.alternatives ?? [])].filter((a): a is LaunchableApp => !!a),
  );

  function sourceLabel(app: LaunchableApp): string {
    return app.kind === "system" ? "Built-in Windows app" : app.path;
  }

  function settle(next: "opened" | "cancelled") {
    status = next;
    onresolve?.({ status: next, label: selected?.name });
  }

  async function open() {
    if (status !== "pending" || !selected) return;
    status = "opening";
    error = "";
    try {
      await launchApp(selected);
      settle("opened");
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="approval">
  <div class="approval-eyebrow"><Icon name="arrow-right" size={13} /> Open app</div>
  {#if status === "opened"}
    <div class="approval-receipt done" role="status">
      <Icon name="check" size={14} /> Opened {resolved?.label ?? selected?.name}.
    </div>
  {:else if status === "cancelled"}
    <div class="approval-receipt" role="status">Cancelled — nothing was opened.</div>
  {:else}
    {#if choices.length > 1}
      <div class="hint">“{data.query}” matched several apps — pick the one to open.</div>
      <div class="choices" role="radiogroup" aria-label="Which app to open">
        {#each choices as app (app.path)}
          <button
            type="button"
            class="choice"
            class:selected={selected?.path === app.path}
            role="radio"
            aria-checked={selected?.path === app.path}
            onclick={() => (selected = app)}
          >
            <span class="name">{app.name}</span>
            <span class="source">{sourceLabel(app)}</span>
          </button>
        {/each}
      </div>
    {:else if selected}
      <strong>{selected.name}</strong>
      <div class="approval-detail">{sourceLabel(selected)}</div>
    {:else}
      <strong>Unknown app</strong>
    {/if}
    {#if error}<div class="approval-error" role="alert">{error}</div>{/if}
    <div class="approval-actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={open}
        disabled={status === "opening" || !selected}
      >
        {#if status === "opening"}<span class="spinner"></span> Opening…{:else}Open {selected?.name ??
            ""}{/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => settle("cancelled")}
        disabled={status === "opening"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  .hint {
    margin-bottom: 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .choice:hover {
    border-color: var(--border-3);
  }
  .choice.selected {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .name {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .source {
    overflow-wrap: anywhere;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
