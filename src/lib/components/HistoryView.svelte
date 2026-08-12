<script lang="ts">
  import Icon from "./Icon.svelte";
  import {
    conversations,
    openConversation,
    deleteConversation,
  } from "../stores";
  import { setView } from "../controller";

  let list = $derived($conversations);

  function rel(ts: number): string {
    const d = Date.now() - ts;
    const m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function open(id: string) {
    openConversation(id);
    setView("chat");
  }
</script>

<div class="scroll">
  {#if list.length === 0}
    <p class="empty">No conversations yet.</p>
  {:else}
    {#each list as c (c.id)}
      <div class="row">
        <button class="main" onclick={() => open(c.id)}>
          <span class="title">{c.title}</span>
          <span class="meta">{c.messages.length} messages · {rel(c.updatedAt)}</span>
        </button>
        <button
          class="icon-btn"
          aria-label="Delete"
          onclick={() => deleteConversation(c.id)}>
          <Icon name="trash" size={15} />
        </button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }
  .empty {
    color: var(--text-3);
    text-align: center;
    margin-top: 40px;
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 10px;
    padding: 2px;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 9px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    color: var(--text-3);
  }
</style>
