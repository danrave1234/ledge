<script lang="ts">
  import HeaderBar from "$lib/components/HeaderBar.svelte";
  import ChatView from "$lib/components/ChatView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import HistoryView from "$lib/components/HistoryView.svelte";
  import PersonasView from "$lib/components/PersonasView.svelte";
  import Canvas from "$lib/components/Canvas.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import Toasts from "$lib/components/Toasts.svelte";
  import { ui, settings, canvas, closeCanvas, newChat, type View } from "$lib/stores";
  import { setView, collapse, stop } from "$lib/controller";
  import { viewIn } from "$lib/motion";
  import { fly } from "svelte/transition";

  let view = $derived($ui.view);
  let placement = $derived($settings.placement);
  let onboarded = $derived($settings.onboarded);

  /** Depth of each view, so moving deeper slides in from the right and going
      back slides in from the left — the same spatial model as any phone app. */
  const DEPTH: Record<View, number> = { chat: 0, history: 1, settings: 1, personas: 2 };
  let dir = $state<1 | -1>(1);
  let prev: View = "chat";
  $effect.pre(() => {
    const v = view;
    dir = DEPTH[v] >= DEPTH[prev] ? 1 : -1;
    prev = v;
  });

  /** Panel-wide shortcuts. Components that handle a key themselves (menus,
      dialogs, the history search) call preventDefault, and we leave it alone. */
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || !onboarded) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      e.preventDefault();
      if ($canvas.open) closeCanvas();
      else if ($ui.generating) stop();
      else if (view === "personas") setView("settings");
      else if (view !== "chat") setView("chat");
      else collapse(true);
    } else if (mod && e.key.toLowerCase() === "n") {
      e.preventDefault();
      stop();
      newChat();
      setView("chat");
    } else if (mod && e.key === ",") {
      e.preventDefault();
      setView("settings");
    } else if (mod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      setView(view === "history" ? "chat" : "history");
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="panel {placement}">
  <HeaderBar />
  <div class="views">
    {#key view}
      <div class="view" in:fly={viewIn(dir)}>
        {#if view === "chat"}
          <ChatView />
        {:else if view === "settings"}
          <SettingsView />
        {:else if view === "history"}
          <HistoryView />
        {:else if view === "personas"}
          <PersonasView />
        {/if}
      </div>
    {/key}
  </div>
  <Canvas />
  <Toasts />
  {#if !onboarded}
    <Onboarding />
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border-2);
    box-shadow: var(--shadow);
    overflow: hidden;
    position: relative;
  }
  /* Round only the corners away from the docked edge. */
  .panel.top {
    border-radius: 0 0 var(--radius) var(--radius);
    border-top: none;
  }
  .panel.left {
    border-radius: 0 var(--radius) var(--radius) 0;
    border-left: none;
  }
  .panel.right {
    border-radius: var(--radius) 0 0 var(--radius);
    border-right: none;
  }
  .views {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
</style>
