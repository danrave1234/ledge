<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { conversations, openConversation, deleteConversation } from "$lib/stores";
  import { setView } from "$lib/controller";
  import { relativeTime } from "$lib/format";

  let list = $derived($conversations);

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
          <span class="meta">
            {c.messages.length} messages · {relativeTime(c.updatedAt)}
          </span>
        </button>
        <button
          class="icon-btn"
          aria-label="Delete"
          onclick={() => deleteConversation(c.id)}
        >
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
    font-size: var(--fs-md);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-md);
    padding: 2px;
    transition: background var(--dur) var(--ease);
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
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .title {
    font-size: var(--fs-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
