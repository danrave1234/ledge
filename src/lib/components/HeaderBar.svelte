<script lang="ts">
  import Icon from "./Icon.svelte";
  import ModelMenu from "./ModelMenu.svelte";
  import { ui, newChat, updateAvailable } from "../stores";
  import { setView, collapse, stop } from "../controller";

  let view = $derived($ui.view);
  let pinned = $derived($ui.pinned);
  function togglePin() {
    ui.update((u) => ({ ...u, pinned: !u.pinned }));
  }
  const titles: Record<string, string> = {
    settings: "Settings",
    history: "History",
    personas: "Personas",
    plugins: "Plugins",
  };
</script>

<header>
  {#if view === "chat"}
    <ModelMenu />
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="New chat" onclick={() => { stop(); newChat(); setView("chat"); }}>
      <Icon name="plus" />
    </button>
    <button class="icon-btn" aria-label="History" onclick={() => setView("history")}>
      <Icon name="history" />
    </button>
    <button class="icon-btn dotwrap" aria-label="Settings" onclick={() => setView("settings")}>
      <Icon name="settings" />
      {#if $updateAvailable}<span class="dot"></span>{/if}
    </button>
  {:else}
    <button class="icon-btn" aria-label="Back" onclick={() => setView("chat")}>
      <Icon name="back" />
    </button>
    <strong>{titles[view] ?? ""}</strong>
    <div class="spacer"></div>
  {/if}
  <button
    class="icon-btn pinbtn"
    class:on={pinned}
    aria-label={pinned ? "Unpin (allow click-outside to close)" : "Pin open"}
    title={pinned ? "Pinned open — click to unpin" : "Pin open"}
    onclick={togglePin}>
    <Icon name="pin" />
  </button>
  <button class="icon-btn" aria-label="Collapse" onclick={() => collapse(true)}>
    <Icon name="x" />
  </button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 8px 9px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .spacer {
    flex: 1;
  }
  strong {
    font-size: 14px;
    font-weight: 600;
    margin-left: 3px;
  }
  .pinbtn.on {
    color: var(--accent-text);
    background: var(--accent-weak);
  }
  .dotwrap {
    position: relative;
  }
  .dot {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    border: 1.5px solid var(--surface);
  }
</style>

