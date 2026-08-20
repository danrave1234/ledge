<script lang="ts">
  import HeaderBar from "$lib/components/HeaderBar.svelte";
  import ChatView from "$lib/components/ChatView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import HistoryView from "$lib/components/HistoryView.svelte";
  import PersonasView from "$lib/components/PersonasView.svelte";
  import Canvas from "$lib/components/Canvas.svelte";
  import Onboarding from "$lib/components/Onboarding.svelte";
  import { ui, settings } from "$lib/stores";
  import { fadeIn } from "$lib/motion";
  import { fade } from "svelte/transition";

  let view = $derived($ui.view);
  let placement = $derived($settings.placement);
  let onboarded = $derived($settings.onboarded);
</script>

<div class="panel {placement}">
  <HeaderBar />
  {#if view === "chat"}
    <ChatView />
  {:else}
    {#key view}
      <div class="subview" in:fade={fadeIn}>
        {#if view === "settings"}
          <SettingsView />
        {:else if view === "history"}
          <HistoryView />
        {:else if view === "personas"}
          <PersonasView />
        {/if}
      </div>
    {/key}
  {/if}
  <Canvas />
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
  .subview {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
