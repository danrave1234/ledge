<script lang="ts">
  import Icon from "./Icon.svelte";
  import { BUILTIN_PLUGINS, pluginEnabled } from "../plugins";
  import { settings, togglePlugin } from "../stores";

  let s = $derived($settings);
</script>

<div class="scroll">
  <p class="hint">
    The core stays small — turn capabilities on or off. Each plugin adds tools or
    UI without bloating the app.
  </p>
  {#each BUILTIN_PLUGINS as p (p.id)}
    <div class="row">
      <div class="ico"><Icon name={p.icon} size={17} /></div>
      <div class="body">
        <span class="name">{p.name}</span>
        <span class="desc">{p.description}</span>
      </div>
      <button
        class="switch"
        class:on={pluginEnabled(s.plugins, p.id)}
        onclick={() => togglePlugin(p.id)}
        aria-label={"Toggle " + p.name}><i></i></button>
    </div>
  {/each}
</div>

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-3);
    margin: 0 0 12px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    margin-bottom: 9px;
  }
  .ico {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name {
    font-size: 13.5px;
    font-weight: 600;
  }
  .desc {
    font-size: 12px;
    color: var(--text-3);
    line-height: 1.5;
  }
  .switch {
    flex-shrink: 0;
    width: 40px;
    height: 24px;
    border-radius: 999px;
    border: none;
    background: var(--surface-3);
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
    margin-top: 3px;
  }
  .switch.on {
    background: var(--accent);
  }
  .switch i {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }
  .switch.on i {
    transform: translateX(16px);
  }
</style>
