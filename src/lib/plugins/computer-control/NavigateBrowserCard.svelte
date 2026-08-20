<script lang="ts">
  import { computerNavigateBrowser, type ComputerTarget } from "$lib/native";

  interface CardData {
    target?: ComputerTarget;
    url?: string;
  }

  let { data = {} }: { data?: CardData } = $props();
  let status: "pending" | "opening" | "opened" | "cancelled" = $state("pending");
  let error = $state("");

  async function open() {
    if (status !== "pending" || !data.target || !data.url) return;
    status = "opening";
    error = "";
    try {
      await computerNavigateBrowser(data.target, data.url);
      status = "opened";
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="card">
  <div class="eyebrow">Browser navigation approval</div>
  <strong>{data.target?.title || "Unknown browser"}</strong>
  <div class="url">{data.url || ""}</div>
  {#if error}<div class="error" role="alert">{error}</div>{/if}
  {#if status === "opened"}
    <div class="receipt" role="status">Opened in the approved browser.</div>
  {:else if status === "cancelled"}
    <div class="receipt" role="status">Cancelled. The browser was not changed.</div>
  {:else}
    <div class="actions">
      <button
        class="open"
        onclick={open}
        disabled={status === "opening" || !data.target || !data.url}
      >
        {status === "opening" ? "Opening…" : "Open"}
      </button>
      <button onclick={() => (status = "cancelled")} disabled={status === "opening"}
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
  .url {
    overflow-wrap: anywhere;
    margin: 10px 0;
    padding: 9px;
    border-radius: 8px;
    background: var(--surface-2);
    font-size: 12px;
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
  .open {
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
