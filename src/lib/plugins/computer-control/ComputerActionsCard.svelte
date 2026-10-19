<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import type { CardResolution } from "$lib/types";
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

  function settle(next: "completed" | "cancelled") {
    status = next;
    onresolve?.({ status: next, label: data.target?.title });
  }
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
      settle("completed");
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="approval">
  <div class="approval-eyebrow"><Icon name="stack" size={13} /> Run steps</div>
  {#if status === "completed"}
    <div class="approval-receipt done" role="status">
      <Icon name="check" size={14} /> Approved steps completed.
    </div>
  {:else if status === "cancelled"}
    <div class="approval-receipt" role="status">Cancelled — no steps were run.</div>
  {:else}
    <strong>{data.target?.title || "Unknown window"}</strong>
    {#if data.summary}<p>{data.summary}</p>{/if}
    <ol class="approval-detail">
      {#each data.actions || [] as action, i (i)}
        <li>{label(action)}</li>
      {/each}
    </ol>
    {#if error}<div class="approval-error" role="alert">{error}</div>{/if}
    <div class="approval-actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={run}
        disabled={status === "running" || !data.target || !data.actions?.length}
      >
        {#if status === "running"}<span class="spinner"></span> Running…{:else}Run {data
            .actions?.length ?? 0}
          {data.actions?.length === 1 ? "step" : "steps"}{/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => settle("cancelled")}
        disabled={status === "running"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  p {
    margin: 6px 0 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  ol {
    max-height: 180px;
    overflow: auto;
    padding-left: 28px;
  }
  li {
    margin: 3px 0;
  }
</style>
