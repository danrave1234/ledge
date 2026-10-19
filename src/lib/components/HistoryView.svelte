<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import {
    conversations,
    activeId,
    openConversation,
    removeConversation,
    restoreConversation,
    purgeConversationAssets,
    toastUndo,
    toast,
  } from "$lib/stores";
  import { setView } from "$lib/controller";
  import { relativeTime } from "$lib/format";
  import {
    conversationToMarkdown,
    dateGroup,
    exportFilename,
    highlightParts,
    historyToJson,
    searchConversations,
  } from "$lib/history";
  import { exportText } from "$lib/native";
  import { stagger } from "$lib/motion";
  import { fly } from "svelte/transition";
  import type { Conversation } from "$lib/types";

  let query = $state("");
  let list = $derived(searchConversations($conversations, query));
  /** Results bucketed into Today / Yesterday / … while keeping their order. */
  let groups = $derived.by(() => {
    const now = Date.now();
    const out: { label: string; items: typeof list }[] = [];
    for (const r of list) {
      const label = dateGroup(r.conversation.updatedAt, now);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(r);
      else out.push({ label, items: [r] });
    }
    return out;
  });

  function open(id: string) {
    openConversation(id);
    setView("chat");
  }

  /** Delete immediately, with Undo — the stored images go only once the
      toast is gone without Undo being pressed. */
  function remove(c: Conversation) {
    const removed = removeConversation(c.id);
    if (!removed) return;
    toastUndo(
      `Deleted “${c.title}”`,
      () => restoreConversation(removed),
      () => purgeConversationAssets(removed),
    );
  }

  async function exportConversation(conversation: Conversation) {
    try {
      await exportText(
        exportFilename(conversation.title, "md"),
        conversationToMarkdown(conversation),
        "md",
      );
    } catch (error) {
      console.error("Conversation export failed", error);
      toast("Couldn't export this conversation.", { tone: "error" });
    }
  }

  async function exportHistory() {
    try {
      await exportText("ledge-history.json", historyToJson($conversations), "json");
    } catch (error) {
      console.error("History export failed", error);
      toast("Couldn't export conversation history.", { tone: "error" });
    }
  }

  function onSearchKey(e: KeyboardEvent) {
    // Esc first clears the search; only an empty search lets Esc go back.
    if (e.key === "Escape" && query) {
      e.preventDefault();
      query = "";
    } else if (e.key === "Enter" && list.length) {
      open(list[0].conversation.id);
    }
  }
</script>

<div class="tools">
  <label for="history-search" class="sr-only">Search conversations</label>
  <div class="search">
    <Icon name="search" size={15} />
    <input
      id="history-search"
      class="field"
      type="search"
      placeholder="Search titles and messages"
      bind:value={query}
      onkeydown={onSearchKey}
    />
  </div>
  <button
    class="btn btn-sm"
    onclick={exportHistory}
    disabled={$conversations.length === 0}
    title="Export every conversation as a JSON file"
  >
    <Icon name="download" size={14} /> Export all
  </button>
</div>

<div class="scroll">
  {#if $conversations.length === 0}
    <div class="empty">
      <Icon name="history" size={22} />
      <p>No conversations yet.</p>
      <button class="btn btn-sm" onclick={() => setView("chat")}>Start chatting</button>
    </div>
  {:else if list.length === 0}
    <div class="empty">
      <Icon name="search" size={22} />
      <p>No conversations match “{query.trim()}”.</p>
    </div>
  {:else}
    {#each groups as g (g.label)}
      <div class="glabel">{g.label}</div>
      {#each g.items as result, i (result.conversation.id)}
        {@const c = result.conversation}
        <div class="row" class:active={$activeId === c.id} in:fly={stagger(i, 25)}>
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
              {c.messages.length}
              {c.messages.length === 1 ? "message" : "messages"} · {relativeTime(
                c.updatedAt,
              )}
            </span>
          </button>
          <div class="acts">
            <button
              class="icon-btn"
              aria-label={`Export ${c.title} as Markdown`}
              title="Export as Markdown"
              onclick={() => exportConversation(c)}
            >
              <Icon name="download" size={15} />
            </button>
            <button
              class="icon-btn danger"
              aria-label={`Delete ${c.title}`}
              title="Delete"
              onclick={() => remove(c)}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>
      {/each}
    {/each}
  {/if}
</div>

<style>
  .tools {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 12px 4px;
  }
  .search {
    position: relative;
    flex: 1;
    color: var(--text-3);
  }
  .search :global(svg) {
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .search .field {
    height: var(--ctl);
    padding-left: 34px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 10px 12px;
  }
  .glabel {
    padding: 12px 8px 5px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 48px;
    color: var(--text-3);
    font-size: var(--fs-md);
  }
  .empty p {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: var(--radius-md);
    padding: 2px 4px 2px 2px;
    transition: background var(--dur) var(--ease);
  }
  .row:hover,
  .row:focus-within {
    background: var(--surface-2);
  }
  .row.active {
    background: var(--accent-weak);
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
  /* Row actions appear on hover/focus so the list reads as a clean list. */
  .acts {
    display: flex;
    opacity: 0;
    transition: opacity var(--dur) var(--ease);
  }
  .row:hover .acts,
  .row:focus-within .acts {
    opacity: 1;
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
    border-radius: 2px;
  }
  .meta {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
