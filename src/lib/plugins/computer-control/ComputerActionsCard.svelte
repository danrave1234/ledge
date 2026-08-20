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
        class="run"
        onclick={run}
        disabled={status === "running" || !data.target || !data.actions?.length}
        >{status === "running" ? "Running…" : "Run actions"}</button
      >
      <button onclick={() => (status = "cancelled")} disabled={status === "running"}
        >Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  .card {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
  }
  .eyebrow {
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  p {
    margin: 8px 0;
    font-size: 12px;
  }
  ol {
    max-height: 180px;
    overflow: auto;
    margin: 8px 0 10px;
    padding: 9px 9px 9px 28px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 12px;
  }
  li {
    margin: 3px 0;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  button {
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .run {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-on);
  }
  .error {
    margin-bottom: 8px;
    color: var(--danger);
    font-size: 12px;
  }
  .receipt {
    color: var(--muted);
    font-size: 12px;
  }
</style>
