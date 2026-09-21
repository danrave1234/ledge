<script lang="ts">
  import { openFoundPath, type FoundPath } from "$lib/native";
  import Icon from "$lib/components/Icon.svelte";

  interface CardData {
    path?: FoundPath;
    alternatives?: FoundPath[];
    query?: string;
  }

  let { data = {} }: { data?: CardData } = $props();
  // The user may switch to an alternative before approving; the approved path
  // is whatever is selected when Open is pressed, never the model's guess alone.
  // svelte-ignore state_referenced_locally
  let selected: FoundPath | undefined = $state(data.path);
  let status: "pending" | "opening" | "opened" | "cancelled" = $state("pending");
  let error = $state("");
  let copied = $state(false);

  const choices = $derived(
    [data.path, ...(data.alternatives ?? [])].filter((p): p is FoundPath => !!p),
  );

  function kindIcon(p: FoundPath): string {
    return p.kind === "folder" ? "folder" : "file";
  }

  function kindLabel(p: FoundPath): string {
    return p.kind === "folder" ? "Folder" : "File";
  }

  /** Detect whether a path comes from a Steam library. */
  function isSteamPath(p: FoundPath): boolean {
    return p.path.toLowerCase().includes("steam");
  }

  /** Human-readable source label for the path. */
  function sourceLabel(p: FoundPath): string {
    return isSteamPath(p) ? "Steam" : "User";
  }

  /** Parent folder label (e.g. "in Steam Games" or "in Documents"). */
  function parentLabel(p: FoundPath): string {
    const parts = p.path.split("\\");
    if (parts.length >= 2) {
      const parent = parts[parts.length - 2];
      return `in ${parent}`;
    }
    return "";
  }

  /** Open button label: folders say "Open in File Explorer". */
  function openLabel(p: FoundPath): string {
    return p.kind === "folder" ? "Open in File Explorer" : "Open";
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard unavailable — soft fail
    }
  }

  async function open() {
    if (status !== "pending" || !selected) return;
    status = "opening";
    error = "";
    try {
      await openFoundPath(selected.path, selected.kind);
      status = "opened";
    } catch (e) {
      status = "pending";
      error = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="card">
  <div class="header">
    <Icon name="folder" size={16} />
    <span class="eyebrow">Open path approval</span>
  </div>

  {#if choices.length > 1 && status === "pending"}
    <div class="hint">"{data.query}" matched several items — pick the one to open.</div>
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
          <div class="choice-info">
            <span class="name">{path.name}</span>
            <span class="path-text">{path.path}</span>
            {#if parentLabel(path)}
              <span class="parent-label">{parentLabel(path)}</span>
            {/if}
          </div>
          <span class="source-badge" class:is-steam={isSteamPath(path)}>
            {sourceLabel(path)}
          </span>
          <span class="kind-badge" class:is-folder={path.kind === "folder"}>
            {kindLabel(path)}
          </span>
        </button>
      {/each}
    </div>
  {:else if selected}
    <div class="selected-view">
      <div class="selected-header">
        <div class="icon-circle" class:is-folder={selected.kind === "folder"}>
          <Icon name={kindIcon(selected)} size={22} />
        </div>
        <div class="selected-info">
          <strong class="name">{selected.name}</strong>
          <span class="source-badge" class:is-steam={isSteamPath(selected)}>
            {sourceLabel(selected)}
          </span>
          <span class="kind-badge" class:is-folder={selected.kind === "folder"}>
            {kindLabel(selected)}
          </span>
        </div>
      </div>
      {#if parentLabel(selected)}
        <div class="parent-hint">{parentLabel(selected)}</div>
      {/if}
      <div
        class="path-box"
        role="button"
        tabindex={0}
        onclick={() => copyPath(selected?.path ?? "")}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") copyPath(selected?.path ?? "");
        }}
      >
        <code>{selected?.path}</code>
        <button
          type="button"
          class="copy-btn"
          onclick={(e) => {
            e.stopPropagation();
            copyPath(selected?.path ?? "");
          }}
          aria-label="Copy path"
        >
          <Icon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  {:else}
    <strong>Unknown path</strong>
  {/if}

  {#if error}<div class="error" role="alert">{error}</div>{/if}

  {#if status === "opened"}
    <div class="receipt success" role="status">
      <Icon name="check" size={14} />
      Opened <strong>{selected?.name}</strong>.
      <div
        class="receipt-path"
        role="button"
        tabindex={0}
        onclick={() => copyPath(selected?.path ?? "")}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") copyPath(selected?.path ?? "");
        }}
      >
        <code>{selected?.path}</code>
        <button
          type="button"
          class="copy-btn"
          onclick={(e) => {
            e.stopPropagation();
            copyPath(selected?.path ?? "");
          }}
          aria-label="Copy path"
        >
          <Icon name={copied ? "check" : "copy"} size={12} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  {:else if status === "cancelled"}
    <div class="receipt cancelled" role="status">
      <Icon name="x" size={14} />
      Cancelled. Nothing was opened.
    </div>
  {:else}
    <div class="actions">
      <button
        class="btn btn-sm btn-accent"
        onclick={open}
        disabled={status === "opening" || !selected}
      >
        {#if status === "opening"}
          <span class="spinner"></span>
          Opening…
        {:else}
          <Icon name="folder" size={14} />
          {selected ? openLabel(selected) : "Open"}
        {/if}
      </button>
      <button
        class="btn btn-sm"
        onclick={() => (status = "cancelled")}
        disabled={status === "opening"}>Cancel</button
      >
    </div>
  {/if}
</div>

<style>
  .card {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .eyebrow {
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .hint {
    margin-bottom: 10px;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px;
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
    overflow: hidden;
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
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .kind-badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--surface-3, var(--surface));
    color: var(--text-3);
  }
  .kind-badge.is-folder {
    background: var(--accent-weak);
    color: var(--accent);
  }

  .source-badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: var(--surface-3, var(--surface));
    color: var(--text-3);
  }
  .source-badge.is-steam {
    background: color-mix(in srgb, #1a9fff 15%, transparent);
    color: #1a9fff;
  }

  .parent-label {
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-style: italic;
  }

  .parent-hint {
    margin-bottom: 6px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-style: italic;
  }

  /* Single selected view */
  .selected-view {
    margin-bottom: 12px;
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
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
    flex-shrink: 0;
  }
  .icon-circle.is-folder {
    background: var(--accent-weak);
    color: var(--accent);
  }
  .selected-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .path-box {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border-2);
    cursor: pointer;
    transition: border-color var(--dur) var(--ease);
  }
  .path-box:hover {
    border-color: var(--border-3);
  }
  .path-box code {
    flex: 1;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-sm);
    color: var(--text-2);
    line-height: 1.4;
  }
  .copy-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border: 1px solid var(--border-2);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text-3);
    font-size: 11px;
    font: inherit;
    cursor: pointer;
    transition:
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
  }
  .copy-btn:hover {
    color: var(--text);
    border-color: var(--border-3);
  }

  .actions {
    display: flex;
    gap: 8px;
  }
  .btn-accent {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .error {
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .receipt {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 10px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .receipt.success {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--text-2);
  }
  .receipt.cancelled {
    background: var(--surface-2);
    color: var(--text-3);
  }
  .receipt-path {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
  }
  .receipt-path code {
    flex: 1;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
