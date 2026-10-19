<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { computerNavigateBrowser, type ComputerTarget } from "$lib/native";
  import type { CardResolution } from "$lib/types";

  interface CardData {
    target?: ComputerTarget;
    url?: string;
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

  function settle(next: "opened" | "cancelled") {
    status = next;
    onresolve?.({ status: next, label: data.url });
  }

  async function open() {
    if (status !== "pending" || !data.target || !data.url) return;
    status = "opening";
    error = "";
    try {
      await computerNavigateBrowser(data.target, data.url);
      settle("opened");
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="approval">
  <div class="approval-eyebrow"><Icon name="web" size={13} /> Open in browser</div>
  {#if status === "opened"}
    <div class="approval-receipt done" role="status">
      <Icon name="check" size={14} /> Opened in {data.target?.title || "your browser"}.
    </div>
  {:else if status === "cancelled"}
    <div class="approval-receipt" role="status">
      Cancelled — the browser was not changed.
    </div>
  {:else}
    <strong>{data.target?.title || "Unknown browser"}</strong>
    <div class="approval-detail">{data.url || ""}</div>
    {#if error}<div class="approval-error" role="alert">{error}</div>{/if}
    <div class="approval-actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={open}
        disabled={status === "opening" || !data.target || !data.url}
      >
        {#if status === "opening"}<span class="spinner"></span> Opening…{:else}Open{/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => settle("cancelled")}
        disabled={status === "opening"}>Cancel</button
      >
    </div>
  {/if}
</div>
