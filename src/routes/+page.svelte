<script lang="ts">
  import { onMount } from "svelte";
  import Panel from "$lib/components/Panel.svelte";
  import Handle from "$lib/components/Handle.svelte";
  import {
    ui,
    settings,
    updateSettings,
    hydrate,
    hydrationReady,
    cacheClearSafe,
    updateAvailable,
    reconcileVersion,
    refreshProviderAuth,
    flushWrites,
    flushToasts,
  } from "$lib/stores";
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
    onGameFocus,
    quitApp,
  } from "$lib/native";
  import { panelIn } from "$lib/motion";
  import {
    createNativeSettingsState,
    initializeGameMode,
    reconcileNativeSettings,
  } from "$lib/native-settings";
  import { fly } from "svelte/transition";

  /** Collapse delay after the pointer leaves, and the extra grace period while
      the expand resize settles (a resize fires spurious mouseleave/enter). */
  const COLLAPSE_MS = 250;
  const RESIZE_GRACE_MS = 450;

  let expanded = $derived($ui.expanded);
  let resizing = $derived($ui.resizing);
  let closing = $derived($ui.closing);
  const tauri = isTauri();
  const preview = !tauri;
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while the hover-open delay counts down, so the handle can show it. */
  let arming = $state(false);
  let expandedAt = 0;
  let root: HTMLDivElement;
  let pointerInside = false;
  let blurredWhileGenerating = false;

  let lastPlacement = "";
  let lastDisplay: number | undefined = undefined;
  const nativeSettingsState = createNativeSettingsState();
  let startupGameModeReady = $state(preview);

  $effect(() => {
    if ($ui.generating || !blurredWhileGenerating) return;
    blurredWhileGenerating = false;
    collapse();
  });

  function cancelCollapse() {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  }

  function cancelHoverOpen() {
    arming = false;
    if (hoverOpenTimer) {
      clearTimeout(hoverOpenTimer);
      hoverOpenTimer = null;
    }
  }

  /** Pointer entered the window. While expanded this just cancels a pending
      collapse — it must NOT open the panel: the collapsed window is a strip
      wider than the visible handle, so opening from here meant merely passing
      near the handle expanded the widget. */
  function onEnter() {
    pointerInside = true;
    cancelCollapse();
  }

  /** Pointer is on the handle mark itself — the only thing that hover-opens. */
  function onHandleHover() {
    cancelCollapse();
    if (!$ui.expanded && $settings.hoverOpen) {
      cancelHoverOpen();
      arming = $settings.hoverOpenDelay > 0;
      hoverOpenTimer = setTimeout(() => {
        hoverOpenTimer = null;
        arming = false;
        if ($ui.expanded || !$settings.hoverOpen) return;
        expandedAt = Date.now();
        expand();
      }, $settings.hoverOpenDelay * 1000);
    }
  }

  function onLeave() {
    pointerInside = false;
    cancelHoverOpen();
    // Moving the mouse away must not close the panel while the user is typing
    // or otherwise has a control selected. A real click outside is handled by
    // the native window-blur listener below.
    if (root.contains(document.activeElement)) return;
    scheduleCollapse();
  }

  function scheduleCollapse() {
    if (collapseTimer) clearTimeout(collapseTimer);
    // The window resize on expand can spuriously fire mouseleave/enter — hold off
    // collapsing until the resize has settled, and let a real re-enter cancel it.
    const cooldownLeft = Math.max(0, RESIZE_GRACE_MS - (Date.now() - expandedAt));
    collapseTimer = setTimeout(() => collapse(), COLLAPSE_MS + cooldownLeft);
  }

  function onFocusOut(e: FocusEvent) {
    const from = e.target as Node | null;
    // Focus may move directly between controls inside Ledge. Wait until the
    // browser has committed the new active element before deciding it is idle.
    queueMicrotask(() => {
      // The focused control was REMOVED (Send turning into Stop, an approval
      // button turning into its receipt, onboarding closing). Focus falls to
      // <body>, but the user hasn't gone anywhere — collapsing here closed the
      // panel right after a keyboard click.
      if (from && !from.isConnected) return;
      if (!pointerInside && !root.contains(document.activeElement)) scheduleCollapse();
    });
  }

  onMount(() => {
    let cleanup = () => {};
    let unblur = () => {};
    let ungame = () => {};
    (async () => {
      if (preview) {
        document.body.classList.add("preview");
        ui.update((u) => ({ ...u, expanded: true }));
      }

      try {
        await hydrate();
      } catch (e) {
        console.error("hydrate failed", e);
      }

      if (!preview) {
        // The backend classifies the current foreground window before this
        // resolves. Only then may the first dock make Ledge visible.
        try {
          await initializeGameMode($settings.gameMode, nativeSettingsState, setGameMode);
        } catch (e) {
          console.error("initial game mode failed", e);
        }
        startupGameModeReady = true;
        await collapse(true);
      }

      // First launch after an update: settings were migrated during hydrate;
      // this clears the stale WebView cache and records the new version.
      try {
        await reconcileVersion();
      } catch (e) {
        console.error("version reconcile failed", e);
      }

      // Know what's connected before the model picker is first opened.
      void refreshProviderAuth();

      // First run: open the panel so the login/onboarding shows.
      if (!preview && !$settings.onboarded) {
        ui.update((u) => ({ ...u, expanded: true }));
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
        cleanup = await onTray(async (a) => {
          if (a === "quit") {
            // Persist anything still queued, THEN exit. Rust force-exits after
            // a short watchdog, so this can't leave the app un-quittable.
            try {
              flushToasts();
              await flushWrites();
            } finally {
              await quitApp();
            }
          } else if (a === "settings") setView("settings");
          else {
            ui.update((u) => ({ ...u, expanded: true }));
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

      // A game took focus: collapse to the handle before the backend hides the
      // window, so leaving the game doesn't reveal a stale open panel.
      if (!preview) {
        try {
          ungame = await onGameFocus((inGame) => {
            if (inGame) collapse(true);
          });
        } catch (e) {
          console.error("game focus listen failed", e);
        }
      }

      // Click outside the widget → minimize, unless pinned or generating.
      if (!preview) {
        try {
          unblur = await onWindowBlur(() => {
            if ($ui.generating) {
              blurredWhileGenerating = true;
              return;
            }
            collapse();
          });
        } catch (e) {
          console.error("blur listen failed", e);
        }
      }
    })();
    return () => {
      cancelCollapse();
      cancelHoverOpen();
      cleanup();
      unblur();
      ungame();
    };
  });

  // React to settings changes (guarded so unrelated toggles don't thrash).
  $effect(() => {
    const s = $settings;
    if (!tauri || !startupGameModeReady) return;
    reconcileNativeSettings($hydrationReady, s, nativeSettingsState, {
      setAutostart,
      registerHotkey: (hotkey) => void registerHotkey(hotkey, () => toggle()),
      setGameMode: (enabled) => void setGameMode(enabled),
      // Trust the OS, not our stored flag: if the registry write is refused the
      // toggle must not keep claiming Ledge launches at login.
      correctAutostart: (autostart) => updateSettings({ autostart }),
    });
    if (
      (lastPlacement && s.placement !== lastPlacement) ||
      (lastDisplay !== undefined && s.display !== lastDisplay)
    ) {
      redock();
    }
    lastPlacement = s.placement;
    lastDisplay = s.display;
  });
</script>

<div
  bind:this={root}
  class="root"
  role="presentation"
  onmouseenter={onEnter}
  onmouseleave={onLeave}
  onfocusout={onFocusOut}
>
  {#if resizing}
    <!-- Window is mid-resize: draw nothing so neither the panel nor the handle
         is painted at the wrong size (that produced ghost bars and flicker). -->
  {:else if expanded}
    <div
      class="shell {$settings.placement}"
      class:preview
      class:closing
      in:fly={panelIn($settings.placement)}
    >
      <Panel />
    </div>
  {:else}
    <Handle
      onhover={onHandleHover}
      onhoverend={cancelHoverOpen}
      {arming}
      armMs={$settings.hoverOpenDelay * 1000}
    />
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
    transition:
      opacity var(--dur-fast) var(--ease),
      transform var(--dur-fast) var(--ease);
  }
  /* Exit: slide back toward the docked edge while fading. Plays for
     PANEL_EXIT_MS (motion.ts) before the window shrinks to the handle. */
  .shell.closing {
    opacity: 0;
  }
  .shell.closing.top {
    transform: translateY(-8px);
  }
  .shell.closing.left {
    transform: translateX(-8px);
  }
  .shell.closing.right {
    transform: translateX(8px);
  }
  .shell.preview.closing.top {
    transform: translate(-50%, -8px);
  }
  /* Browser preview has no native window: fake the docked panel's size.
     Matches PANEL_TOP_W / PANEL_TOP_H in src-tauri/src/window.rs. */
  .shell.preview {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 640px;
    height: 460px;
  }
</style>
