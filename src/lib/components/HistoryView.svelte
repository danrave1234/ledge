<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { conversations, openConversation, deleteConversation } from "$lib/stores";
  import { setView } from "$lib/controller";
  import { relativeTime } from "$lib/format";
  import {
    conversationToMarkdown,
    exportFilename,
    highlightParts,
    historyToJson,
    searchConversations,
  } from "$lib/history";
  import { exportText } from "$lib/native";
  import type { Conversation } from "$lib/types";

  let query = $state("");
  let exportStatus = $state("");
  let list = $derived(searchConversations($conversations, query));

  function open(id: string) {
    openConversation(id);
    setView("chat");
  }

  async function exportConversation(conversation: Conversation) {
    exportStatus = "";
    try {
      await exportText(
        exportFilename(conversation.title, "md"),
        conversationToMarkdown(conversation),
        "md",
      );
    } catch (error) {
      console.error("Conversation export failed", error);
      exportStatus = "Couldn't export this conversation.";
    }
  }

  async function exportHistory() {
    exportStatus = "";
    try {
      await exportText("perch-history.json", historyToJson($conversations), "json");
    } catch (error) {
      console.error("History export failed", error);
      exportStatus = "Couldn't export conversation history.";
    }
  }
</script>

<div class="tools">
  <label for="history-search">Search conversations</label>
  <input
    id="history-search"
    type="search"
    placeholder="Search titles and messages"
    bind:value={query}
  />
  <button
    class="export-all"
    onclick={exportHistory}
    disabled={$conversations.length === 0}
  >
    Export all as JSON
  </button>
  {#if exportStatus}<p class="status" role="alert">{exportStatus}</p>{/if}
</div>

<div class="scroll">
  {#if $conversations.length === 0}
    <p class="empty">No conversations yet.</p>
  {:else if list.length === 0}
    <p class="empty">No conversations match “{query.trim()}”.</p>
  {:else}
    {#each list as result (result.conversation.id)}
      {@const c = result.conversation}
      <div class="row">
        <button class="main" onclick={() => open(c.id)}>
          <span class="title">
            {#each highlightParts(c.title, query) as part, index (index)}
              {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
            {/each}
          </span>
          {#if result.snippet}
            <span class="snippet">
              {#each highlightParts(result.snippet, query) as part, index (index)}
                {#if part.match}<mark>{part.text}</mark>{:else}{part.text}{/if}
              {/each}
            </span>
          {/if}
          <span class="meta">
            {c.messages.length} messages · {relativeTime(c.updatedAt)}
          </span>
        </button>
        <button
          class="action"
          aria-label={`Export ${c.title} as Markdown`}
          onclick={() => exportConversation(c)}
        >
          Export
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
  .tools {
    display: grid;
    gap: 6px;
    padding: 10px 10px 0;
  }
  .tools label {
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .tools input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-1);
    color: var(--text);
    padding: 8px 9px;
    font: inherit;
  }
  .export-all,
  .action {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-2);
    font: inherit;
    cursor: pointer;
  }
  .export-all {
    justify-self: start;
    padding: 5px 8px;
  }
  .export-all:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .status {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-xs);
  }
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
  .action {
    padding: 4px 6px;
    font-size: var(--fs-xs);
  }
  .title {
    font-size: var(--fs-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .snippet {
    color: var(--text-2);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  mark {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    color: inherit;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
