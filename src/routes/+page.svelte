<script lang="ts">
  import { onMount } from "svelte";
  import Panel from "$lib/components/Panel.svelte";
  import Handle from "$lib/components/Handle.svelte";
  import { ui, settings, hydrate, cacheClearSafe, updateAvailable } from "$lib/stores";
  import { expand, collapse, toggle, redock, setView } from "$lib/controller";
  import {
    isTauri,
    onTray,
    setAutostart,
    registerHotkey,
    setGameMode,
    clearCache,
    checkForUpdates,
    onWindowBlur,
  } from "$lib/native";
  import { fade } from "svelte/transition";

  let expanded = $derived($ui.expanded);
  const tauri = isTauri();
  const preview = !tauri;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let expandedAt = 0;

  let lastPlacement = "";
  let lastHotkey = "";
  let lastAutostart: boolean | null = null;
  let lastGameMode: boolean | null = null;

  function onEnter() {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
    if (!$ui.expanded && $settings.hoverOpen) {
      expandedAt = Date.now();
      expand();
    }
  }

  function onLeave() {
    if (collapseTimer) clearTimeout(collapseTimer);
    // The window resize on expand can spuriously fire mouseleave/enter — hold off
    // collapsing until the resize has settled, and let a real re-enter cancel it.
    const cooldownLeft = Math.max(0, 450 - (Date.now() - expandedAt));
    collapseTimer = setTimeout(() => collapse(), 250 + cooldownLeft);
  }

  onMount(() => {
    let cleanup = () => {};
    let unblur = () => {};
    (async () => {
      // Show the widget first so persistence issues can never block startup.
      if (preview) {
        document.body.classList.add("preview");
        ui.update((u) => ({ ...u, expanded: true, pinned: true }));
      } else {
        collapse(true);
      }

      try {
        await hydrate();
      } catch (e) {
        console.error("hydrate failed", e);
      }

      // First run: open the panel so the login/onboarding shows.
      if (!preview && !$settings.onboarded) {
        ui.update((u) => ({ ...u, expanded: true, pinned: true }));
        await redock();
      }

      if (!preview && $settings.clearCacheOnLaunch && cacheClearSafe()) {
        // Safe: durable memory is in app-data and migration above succeeded.
        try {
          await clearCache();
        } catch (e) {
          console.error("clearCache failed", e);
        }
      }

      try {
        cleanup = await onTray((a) => {
          if (a === "settings") setView("settings");
          else {
            ui.update((u) => ({ ...u, expanded: true, pinned: true }));
            redock();
          }
        });
      } catch (e) {
        console.error("tray listen failed", e);
      }

      // Silent auto-check for updates on launch.
      if (!preview) {
        checkForUpdates()
          .then((u) => u.available && updateAvailable.set(true))
          .catch(() => {});
      }

      // Click outside the widget → minimize, unless pinned or generating.
      if (!preview) {
        try {
          unblur = await onWindowBlur(() => collapse());
        } catch (e) {
          console.error("blur listen failed", e);
        }
      }
    })();
    return () => {
      cleanup();
      unblur();
    };
  });

  // React to settings changes (guarded so unrelated toggles don't thrash).
  $effect(() => {
    const s = $settings;
    if (!tauri) return;
    if (lastAutostart === null || s.autostart !== lastAutostart) {
      lastAutostart = s.autostart;
      setAutostart(s.autostart);
    }
    if (s.hotkey !== lastHotkey) {
      lastHotkey = s.hotkey;
      registerHotkey(s.hotkey, () => toggle());
    }
    if (lastPlacement && s.placement !== lastPlacement) redock();
    lastPlacement = s.placement;
    if (s.gameMode !== lastGameMode) {
      lastGameMode = s.gameMode;
      setGameMode(s.gameMode);
    }
  });
</script>

<div class="root" role="presentation" onmouseenter={onEnter} onmouseleave={onLeave}>
  {#if expanded}
    <div class="shell" class:preview transition:fade={{ duration: 150 }}>
      <Panel />
    </div>
  {:else}
    <Handle />
  {/if}
</div>

<style>
  .root {
    width: 100vw;
    height: 100vh;
  }
  .shell {
    width: 100%;
    height: 100%;
  }
  .shell.preview {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 640px;
    height: 460px;
  }
</style>
