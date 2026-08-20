<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ModelMenu from "$lib/components/ModelMenu.svelte";
  import { ui, newChat, updateAvailable, type View } from "$lib/stores";
  import { setView, collapse, stop } from "$lib/controller";

  let view = $derived($ui.view);
  let pinned = $derived($ui.pinned);

  const TITLES: Record<View, string> = {
    chat: "",
    settings: "Settings",
    history: "History",
    personas: "Personas",
  };

  function togglePin() {
    ui.update((u) => ({ ...u, pinned: !u.pinned }));
  }
  function startNewChat() {
    stop();
    newChat();
    setView("chat");
  }
</script>

<header>
  {#if view === "chat"}
    <ModelMenu />
    <div class="spacer"></div>
    <button class="icon-btn" aria-label="New chat" onclick={startNewChat}>
      <Icon name="plus" />
    </button>
    <button class="icon-btn" aria-label="History" onclick={() => setView("history")}>
      <Icon name="history" />
    </button>
    <button
      class="icon-btn dotwrap"
      aria-label="Settings"
      onclick={() => setView("settings")}
    >
      <Icon name="settings" />
      {#if $updateAvailable}<span class="dot"></span>{/if}
    </button>
  {:else}
    <button class="icon-btn" aria-label="Back" onclick={() => setView("chat")}>
      <Icon name="back" />
    </button>
    <strong>{TITLES[view]}</strong>
    <div class="spacer"></div>
  {/if}
  <button
    class="icon-btn pinbtn"
    class:on={pinned}
    aria-label={pinned ? "Unpin (allow click-outside to close)" : "Pin open"}
    aria-pressed={pinned}
    title={pinned ? "Pinned open — click to unpin" : "Pin open"}
    onclick={togglePin}
  >
    <Icon name="pin" />
  </button>
  <button
    class="icon-btn"
    aria-label="Collapse"
    title="Collapse to the handle — Perch keeps running (quit in Settings → General)"
    onclick={() => collapse(true)}
  >
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
    font-size: var(--fs-lg);
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
  /* Update-available badge on the settings icon. */
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
