<script lang="ts">
  import { launchApp, type LaunchableApp } from "$lib/native";

  interface CardData {
    app?: LaunchableApp;
    alternatives?: LaunchableApp[];
    query?: string;
  }

  let { data = {} }: { data?: CardData } = $props();
  // The user may switch to an alternative before approving; the approved app
  // is whatever is selected when Open is pressed, never the model's guess alone.
  // Card data is immutable once attached, so seeding from the initial value is
  // intentional.
  // svelte-ignore state_referenced_locally
  let selected: LaunchableApp | undefined = $state(data.app);
  let status: "pending" | "opening" | "opened" | "cancelled" = $state("pending");
  let error = $state("");

  const choices = $derived(
    [data.app, ...(data.alternatives ?? [])].filter((a): a is LaunchableApp => !!a),
  );

  function sourceLabel(app: LaunchableApp): string {
    return app.kind === "system" ? "Built-in Windows app" : app.path;
  }

  async function open() {
    if (status !== "pending" || !selected) return;
    status = "opening";
    error = "";
    try {
      await launchApp(selected);
      status = "opened";
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="card">
  <div class="eyebrow">Open app approval</div>
  {#if choices.length > 1 && status === "pending"}
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
    <div class="source block">{sourceLabel(selected)}</div>
  {:else}
    <strong>Unknown app</strong>
  {/if}
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  {#if status === "opened"}
    <div class="receipt" role="status">Opened {selected?.name}.</div>
  {:else if status === "cancelled"}
    <div class="receipt" role="status">Cancelled. Nothing was opened.</div>
  {:else}
    <div class="actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={open}
        disabled={status === "opening" || !selected}
      >
        {status === "opening" ? "Opening…" : `Open ${selected?.name ?? ""}`}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => (status = "cancelled")}
        disabled={status === "opening"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  .card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .eyebrow {
    margin-bottom: 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
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
  .source.block {
    margin: 6px 0 10px;
    padding: 9px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .error {
    margin-bottom: 8px;
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .receipt {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
</style>
