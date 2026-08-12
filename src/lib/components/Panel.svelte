<script lang="ts">
  import HeaderBar from "./HeaderBar.svelte";
  import ChatView from "./ChatView.svelte";
  import SettingsView from "./SettingsView.svelte";
  import HistoryView from "./HistoryView.svelte";
  import PersonasView from "./PersonasView.svelte";
  import PluginsView from "./PluginsView.svelte";
  import Canvas from "./Canvas.svelte";
  import Onboarding from "./Onboarding.svelte";
  import { ui, settings } from "../stores";
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
      <div class="subview" in:fade={{ duration: 130 }}>
        {#if view === "settings"}
          <SettingsView />
        {:else if view === "history"}
          <HistoryView />
        {:else if view === "personas"}
          <PersonasView />
        {:else if view === "plugins"}
          <PluginsView />
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
