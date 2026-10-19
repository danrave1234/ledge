<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { computerInsertText, type ComputerTarget } from "$lib/native";
  import type { CardResolution } from "$lib/types";

  interface CardData {
    target?: ComputerTarget;
    text?: string;
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
  // svelte-ignore state_referenced_locally
  let status = $state(resolved?.status ?? "pending");
  let error = $state("");

  function settle(next: "inserted" | "cancelled") {
    status = next;
    onresolve?.({ status: next, label: data.target?.title });
  }

  async function insert() {
    if (status !== "pending" || !data.target || !data.text) return;
    status = "inserting";
    error = "";
    try {
      await computerInsertText(data.target, data.text);
      settle("inserted");
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="approval">
  <div class="approval-eyebrow"><Icon name="edit" size={13} /> Insert text</div>
  {#if status === "inserted"}
    <div class="approval-receipt done" role="status">
      <Icon name="check" size={14} /> Inserted into {resolved?.label ??
        data.target?.title ??
        "the window"}. Nothing was submitted.
    </div>
  {:else if status === "cancelled"}
    <div class="approval-receipt" role="status">Cancelled — no text was inserted.</div>
  {:else}
    <strong>{data.target?.title || "Unknown window"}</strong>
    <pre class="approval-detail">{data.text || ""}</pre>
    {#if error}<div class="approval-error" role="alert">{error}</div>{/if}
    <div class="approval-actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={insert}
        disabled={status === "inserting" || !data.target || !data.text}
      >
        {#if status === "inserting"}<span class="spinner"></span> Inserting…{:else}Insert{/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => settle("cancelled")}
        disabled={status === "inserting"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  pre {
    max-height: 180px;
    overflow: auto;
    white-space: pre-wrap;
    font: inherit;
    font-size: var(--fs-sm);
  }
</style>
