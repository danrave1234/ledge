<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ModelMenu from "$lib/components/ModelMenu.svelte";
  import { ui, newChat, updateAvailable, type View } from "$lib/stores";
  import { setView, collapse, stop } from "$lib/controller";
  import { fadeIn } from "$lib/motion";
  import { fade } from "svelte/transition";

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
    <button
      class="icon-btn"
      aria-label="New chat"
      title="New chat (Ctrl+N)"
      onclick={startNewChat}
    >
      <Icon name="plus" />
    </button>
    <button
      class="icon-btn"
      aria-label="History"
      title="History (Ctrl+H)"
      onclick={() => setView("history")}
    >
      <Icon name="history" />
    </button>
    <button
      class="icon-btn dotwrap"
      aria-label={$updateAvailable ? "Settings — update available" : "Settings"}
      title={$updateAvailable ? "Settings — an update is available" : "Settings (Ctrl+,)"}
      onclick={() => setView("settings")}
    >
      <Icon name="settings" />
      {#if $updateAvailable}<span class="dot"></span>{/if}
    </button>
  {:else}
    <button
      class="icon-btn"
      aria-label="Back"
      title="Back (Esc)"
      onclick={() => setView(view === "personas" ? "settings" : "chat")}
    >
      <Icon name="back" />
    </button>
    {#key view}
      <strong in:fade={fadeIn()}>{TITLES[view]}</strong>
    {/key}
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
    title="Collapse (Esc) — Ledge keeps running at the screen edge"
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
  .pinbtn :global(svg) {
    transition: transform var(--dur-slow) var(--ease-spring);
  }
  .pinbtn.on :global(svg) {
    transform: rotate(-30deg);
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
    animation: dot-in var(--dur-slow) var(--ease-spring) both;
  }
  @keyframes dot-in {
    from {
      transform: scale(0);
    }
  }
</style>
