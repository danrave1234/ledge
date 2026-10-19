<script lang="ts">
  import { openFoundPath, type FoundPath } from "$lib/native";
  import Icon from "$lib/components/Icon.svelte";
  import type { CardResolution } from "$lib/types";

  interface CardData {
    path?: FoundPath;
    alternatives?: FoundPath[];
    query?: string;
  }

  /** How long "Copied" stays on the copy button. */
  const COPIED_MS = 1400;

  let {
    data = {},
    resolved,
    onresolve,
  }: {
    data?: CardData;
    resolved?: CardResolution;
    onresolve?: (r: CardResolution) => void;
  } = $props();
  // The user may switch to an alternative before approving; the approved path
  // is whatever is selected when Open is pressed, never the model's guess alone.
  // svelte-ignore state_referenced_locally
  let selected: FoundPath | undefined = $state(data.path);
  // svelte-ignore state_referenced_locally
  let status = $state(resolved?.status ?? "pending");
  let error = $state("");
  let copied = $state(false);

  const choices = $derived(
    [data.path, ...(data.alternatives ?? [])].filter((p): p is FoundPath => !!p),
  );

  function kindIcon(p: FoundPath): string {
    return p.kind === "folder" ? "folder" : "file";
  }

  /** Detect whether a path comes from a Steam library. */
  function isSteamPath(p: FoundPath): boolean {
    return p.path.toLowerCase().includes("steam");
  }

  /** Parent folder label (e.g. "in Steam Games" or "in Documents"). */
  function parentLabel(p: FoundPath): string {
    const parts = p.path.split("\\");
    return parts.length >= 2 ? `in ${parts[parts.length - 2]}` : "";
  }

  /** Open button label: folders say "Open in File Explorer". */
  function openLabel(p: FoundPath): string {
    return p.kind === "folder" ? "Open in File Explorer" : "Open";
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
      setTimeout(() => (copied = false), COPIED_MS);
    } catch {
      // Clipboard unavailable — soft fail
    }
  }

  function settle(next: "opened" | "cancelled") {
    status = next;
    onresolve?.({ status: next, label: selected?.path });
  }

  async function open() {
    if (status !== "pending" || !selected) return;
    status = "opening";
    error = "";
    try {
      await openFoundPath(selected.path, selected.kind);
      settle("opened");
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="approval">
  <div class="approval-eyebrow"><Icon name="folder" size={13} /> Open path</div>

  {#if status === "opened"}
    {@const path = resolved?.label ?? selected?.path ?? ""}
    <div class="approval-receipt done" role="status">
      <Icon name="check" size={14} /> Opened.
    </div>
    <div class="path-box">
      <code>{path}</code>
      <button type="button" class="btn btn-sm" onclick={() => copyPath(path)}>
        <Icon name={copied ? "check" : "copy"} size={13} />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  {:else if status === "cancelled"}
    <div class="approval-receipt" role="status">Cancelled — nothing was opened.</div>
  {:else}
    {#if choices.length > 1}
      <div class="hint">“{data.query}” matched several items — pick the one to open.</div>
      <div class="choices" role="radiogroup" aria-label="Which path to open">
        {#each choices as path (path.path)}
          <button
            type="button"
            class="choice"
            class:selected={selected?.path === path.path}
            role="radio"
            aria-checked={selected?.path === path.path}
            onclick={() => (selected = path)}
          >
            <Icon name={kindIcon(path)} size={18} />
            <span class="choice-info">
              <span class="name">{path.name}</span>
              <span class="path-text">{path.path}</span>
            </span>
            {#if isSteamPath(path)}<span class="badge steam">Steam</span>{/if}
            <span class="badge" class:folder={path.kind === "folder"}>
              {path.kind === "folder" ? "Folder" : "File"}
            </span>
          </button>
        {/each}
      </div>
    {:else if selected}
      <div class="selected-header">
        <div class="icon-circle" class:folder={selected.kind === "folder"}>
          <Icon name={kindIcon(selected)} size={20} />
        </div>
        <div class="selected-info">
          <strong class="name">{selected.name}</strong>
          <span class="parent">{parentLabel(selected)}</span>
        </div>
        {#if isSteamPath(selected)}<span class="badge steam">Steam</span>{/if}
        <span class="badge" class:folder={selected.kind === "folder"}>
          {selected.kind === "folder" ? "Folder" : "File"}
        </span>
      </div>
      <div class="path-box">
        <code>{selected.path}</code>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => copyPath(selected?.path ?? "")}
          aria-label="Copy path"
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    {:else}
      <strong>Unknown path</strong>
    {/if}

    {#if error}<div class="approval-error" role="alert">{error}</div>{/if}

    <div class="approval-actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={open}
        disabled={status === "opening" || !selected}
      >
        {#if status === "opening"}
          <span class="spinner"></span> Opening…
        {:else}
          <Icon name="folder" size={14} />
          {selected ? openLabel(selected) : "Open"}
        {/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => settle("cancelled")}
        disabled={status === "opening"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  .hint {
    margin-bottom: 8px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .choice:hover {
    border-color: var(--border-3);
  }
  .choice.selected {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .choice-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: var(--fs-md);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .path-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    font-size: var(--fs-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--surface-3);
    color: var(--text-3);
  }
  .badge.folder {
    background: var(--accent-weak);
    color: var(--accent-text);
  }
  .badge.steam {
    background: var(--info-weak);
    color: var(--info);
  }
  .selected-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .icon-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
    flex-shrink: 0;
  }
  .icon-circle.folder {
    background: var(--accent-weak);
    color: var(--accent);
  }
  .selected-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .parent {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .path-box {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 10px;
    padding: 6px 6px 6px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .path-box code {
    flex: 1;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: var(--lh-tight);
    user-select: text;
  }
</style>
