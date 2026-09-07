<script lang="ts">
  import {
    computerRunActions,
    type ComputerAction,
    type ComputerTarget,
  } from "$lib/native";

  interface CardData {
    target?: ComputerTarget;
    summary?: string;
    actions?: ComputerAction[];
  }

  let { data = {} }: { data?: CardData } = $props();
  let status: "pending" | "running" | "completed" | "cancelled" = $state("pending");
  let error = $state("");

  function label(action: ComputerAction): string {
    if (action.kind === "type")
      return `Type “${action.text.length > 80 ? `${action.text.slice(0, 77)}…` : action.text}”`;
    if (action.kind === "key") return `Press ${action.key.replace("_", " ")}`;
    if (action.kind === "scroll") return `Scroll ${action.amount > 0 ? "up" : "down"}`;
    return `${action.kind.replace("_", " ")} at ${action.x / 10}%, ${action.y / 10}%`;
  }

  async function run() {
    if (status !== "pending" || !data.target || !data.actions?.length) return;
    status = "running";
    error = "";
    try {
      await computerRunActions(data.target, data.actions);
      status = "completed";
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="card">
  <div class="eyebrow">Computer action approval</div>
  <strong>{data.target?.title || "Unknown window"}</strong>
  <p>{data.summary || ""}</p>
  <ol>
    {#each data.actions || [] as action, i (i)}
      <li>{label(action)}</li>
    {/each}
  </ol>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  {#if status === "completed"}
    <div class="receipt" role="status">Approved actions completed.</div>
  {:else if status === "cancelled"}
    <div class="receipt" role="status">Cancelled. No actions were run.</div>
  {:else}
    <div class="actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={run}
        disabled={status === "running" || !data.target || !data.actions?.length}
        >{status === "running" ? "Running…" : "Run actions"}</button
      >
      <button
        class="btn btn-sm"
        onclick={() => (status = "cancelled")}
        disabled={status === "running"}>Cancel</button
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
  p {
    margin: 8px 0;
    font-size: var(--fs-sm);
  }
  ol {
    max-height: 180px;
    overflow: auto;
    margin: 8px 0 10px;
    padding: 9px 9px 9px 28px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: var(--fs-sm);
  }
  li {
    margin: 3px 0;
    overflow-wrap: anywhere;
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
