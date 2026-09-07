<script lang="ts">
  import { computerInsertText, type ComputerTarget } from "$lib/native";

  interface CardData {
    target?: ComputerTarget;
    text?: string;
  }

  let { data = {} }: { data?: CardData } = $props();
  let status: "pending" | "inserting" | "inserted" | "cancelled" = $state("pending");
  let error = $state("");

  async function insert() {
    if (status !== "pending" || !data.target || !data.text) return;
    status = "inserting";
    error = "";
    try {
      await computerInsertText(data.target, data.text);
      status = "inserted";
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="card">
  <div class="eyebrow">Text insertion approval</div>
  <strong>{data.target?.title || "Unknown window"}</strong>
  <pre>{data.text || ""}</pre>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  {#if status === "inserted"}
    <div class="receipt" role="status">Inserted. Nothing was submitted.</div>
  {:else if status === "cancelled"}
    <div class="receipt" role="status">Cancelled. No text was inserted.</div>
  {:else}
    <div class="actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={insert}
        disabled={status === "inserting" || !data.target || !data.text}
      >
        {status === "inserting" ? "Inserting…" : "Insert"}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => (status = "cancelled")}
        disabled={status === "inserting"}>Cancel</button
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
  pre {
    max-height: 180px;
    overflow: auto;
    margin: 10px 0;
    padding: 9px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    white-space: pre-wrap;
    font: inherit;
    font-size: var(--fs-sm);
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
