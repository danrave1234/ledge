<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { BUILTIN_PERSONAS } from "$lib/personas";
  import {
    customPersonas,
    settings,
    updateSettings,
    upsertPersona,
    deletePersona,
    uid,
  } from "$lib/stores";
  import type { Persona } from "$lib/types";

  let s = $derived($settings);
  let custom = $derived($customPersonas);
  let all = $derived([...BUILTIN_PERSONAS, ...custom]);

  let editing = $state<Persona | null>(null);

  function startNew() {
    editing = { id: uid(), name: "", prompt: "" };
  }
  function edit(p: Persona) {
    editing = { ...p };
  }
  function save() {
    if (!editing) return;
    if (!editing.name.trim()) editing.name = "Untitled persona";
    upsertPersona({ ...editing, builtin: false });
    updateSettings({ personaId: editing.id });
    editing = null;
  }
</script>

<div class="scroll">
  {#if editing}
    <div class="editor">
      <label for="p-name">Name</label>
      <input
        id="p-name"
        class="field"
        bind:value={editing.name}
        placeholder="e.g. Career mentor"
      />
      <label for="p-prompt">Personality / instructions</label>
      <textarea
        id="p-prompt"
        class="field"
        rows="7"
        bind:value={editing.prompt}
        placeholder="Describe how the assistant should talk and behave. Paste your ChatGPT custom instructions here to match your usual voice."
      ></textarea>
      <div class="actions">
        <button class="btn" onclick={() => (editing = null)}>Cancel</button>
        <button class="btn btn-accent" onclick={save}>Save persona</button>
      </div>
    </div>
  {:else}
    <button class="add" onclick={startNew}>
      <Icon name="plus" size={15} /> New persona
    </button>
    {#each all as p (p.id)}
      <div class="row" class:sel={s.personaId === p.id}>
        <button class="main" onclick={() => updateSettings({ personaId: p.id })}>
          <span class="name">
            {p.name}
            {#if s.personaId === p.id}<em>· active</em>{/if}
          </span>
          <span class="prompt">{p.prompt}</span>
        </button>
        {#if !p.builtin}
          <button class="icon-btn" aria-label="Edit" onclick={() => edit(p)}>
            <Icon name="edit" size={15} />
          </button>
          <button
            class="icon-btn"
            aria-label="Delete"
            onclick={() => deletePersona(p.id)}
          >
            <Icon name="trash" size={15} />
          </button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    height: var(--ctl-lg);
    border: 1px dashed var(--border-2);
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-2);
    font-family: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
    margin-bottom: 12px;
    transition:
      border-color var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 4px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    padding: 3px;
    margin-bottom: 8px;
    transition:
      border-color var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .row.sel {
    border-color: var(--accent);
    background: var(--accent-weak);
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 10px;
    border: none;
    background: transparent;
    color: var(--text);
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .name {
    font-size: var(--fs-md);
    font-weight: 600;
  }
  .name em {
    color: var(--accent-text);
    font-style: normal;
    font-weight: 400;
    font-size: var(--fs-xs);
  }
  .prompt {
    font-size: var(--fs-sm);
    color: var(--text-3);
    line-height: var(--lh-tight);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .editor label {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin-top: 6px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
