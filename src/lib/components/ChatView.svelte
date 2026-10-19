<script lang="ts">
  import Message from "$lib/components/Message.svelte";
  import Composer from "$lib/components/Composer.svelte";
  import NowPlayingBar from "$lib/plugins/music/NowPlayingBar.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import {
    messages,
    ui,
    settings,
    activeId,
    requestComposer,
    type ComposerRequest,
  } from "$lib/stores";
  import { pluginActive } from "$lib/plugins";
  import { stagger, fadeOverlay } from "$lib/motion";
  import { fade, fly } from "svelte/transition";
  import { tick } from "svelte";

  /** How long to keep pinning to the bottom after a conversation opens.
      Message height keeps growing for a few frames: markdown renders, then code
      blocks get wrapped in canvas cards. A single scroll fires too early and
      lands part-way up — which is why an opened chat showed its oldest
      messages instead of the newest. */
  const SETTLE_MS = 450;

  let list = $derived($messages);
  let generating = $derived($ui.generating);
  let activity = $derived($ui.activity);
  let conversation = $derived($activeId);
  let scroller: HTMLDivElement | undefined = $state();

  function toBottom() {
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  /** Pin to the bottom until the content stops growing. */
  async function settleToBottom() {
    await tick();
    toBottom();
    const until = Date.now() + SETTLE_MS;
    const again = () => {
      toBottom();
      if (Date.now() < until) requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }

  // Opening the widget or switching conversations starts at the newest message.
  $effect(() => {
    void conversation;
    void scroller;
    settleToBottom();
  });

  interface Suggestion extends ComposerRequest {
    icon: string;
    /** Shown on the chip when it differs from the text placed in the box. */
    label?: string;
  }

  /** Only suggest what will actually work right now: a screen suggestion
      without the Screen plugin used to send with no screen at all, and the
      model then answered "I can't see your screen" to our own suggestion.
      Each one goes through the composer, so screen/web ones switch the
      matching toggle on and get the same capture + review flow as typing. */
  let suggestions = $derived.by(() => {
    const out: Suggestion[] = [];
    const screen = pluginActive($settings, "screen-context");
    if (screen && pluginActive($settings, "job-analyzer"))
      out.push({
        icon: "screen",
        text: "Is this job a good fit for me? Should I apply?",
        screen: true,
        send: true,
      });
    if (screen)
      out.push({
        icon: "screen",
        text: "Summarize what's on my screen",
        screen: true,
        send: true,
      });
    if (pluginActive($settings, "web-search"))
      out.push({
        icon: "web",
        text: "What's new in tech this week?",
        web: true,
        send: true,
      });
    out.push({
      icon: "edit",
      text: "Draft a polite follow-up email",
      send: true,
    });
    out.push({
      icon: "spark",
      label: "Explain something simply",
      text: "Explain this simply: ",
      send: false,
    });
    return out.slice(0, 4);
  });

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 5
      ? "Up late?"
      : h < 12
        ? "Good morning"
        : h < 18
          ? "Good afternoon"
          : "Good evening";
  })();

  let prevLen = 0;
  $effect(() => {
    const len = list.length;
    // touch last content so the effect re-runs on each streamed token
    if (len) void list[len - 1].content;
    // ...and on the activity line appearing/disappearing, which also changes height
    void activity;
    if (!scroller) return;
    const added = len > prevLen;
    prevLen = len;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    // Jump to the newest message; while streaming, only follow if already at the
    // bottom, so scrolling up to read isn't yanked back down.
    if (added || nearBottom) toBottom();
  });
</script>

<div
  class="scroll"
  bind:this={scroller}
  role="log"
  aria-live="polite"
  aria-relevant="additions text"
  aria-label="Conversation"
>
  {#if list.length === 0}
    <div class="empty" in:fade={fadeOverlay()}>
      <div class="orb"><Icon name="ledge" size={24} /></div>
      <p class="hi">{greeting}. How can I help?</p>
      <div class="suggs">
        {#each suggestions as sg, i (sg.text)}
          <button
            class="sugg"
            in:fly={stagger(i + 1)}
            onclick={() => requestComposer({ ...sg })}
          >
            <Icon name={sg.icon} size={14} />
            <span>{sg.label ?? sg.text}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else}
    {#each list as m, i (m.id)}
      <Message
        msg={m}
        streaming={generating && i === list.length - 1 && m.role === "assistant"}
      />
    {/each}
    <!-- A tool round produces no tokens, so without this the panel looks
         frozen for the seconds a search or capture takes. -->
    {#if activity}
      <div class="activity" role="status" in:fade={fadeOverlay()}>
        <span class="dot"></span>{activity}…
      </div>
    {/if}
  {/if}
</div>
<NowPlayingBar />
<Composer />

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 14px 14px 4px;
    min-height: 0;
  }
  .activity {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    padding: 2px 2px 8px;
  }
  .activity .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: pulse 1.1s var(--ease) infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .activity .dot {
      animation: none;
      opacity: 0.7;
    }
  }
  .empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 4px;
    padding-bottom: 30px;
  }
  .orb {
    width: 48px;
    height: 48px;
    border-radius: var(--radius);
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
    animation: orb-in var(--dur-enter) var(--ease-spring) both;
  }
  @keyframes orb-in {
    from {
      opacity: 0;
      transform: scale(0.8) rotate(-8deg);
    }
  }
  .hi {
    font-size: var(--fs-xl);
    font-weight: 600;
    margin: 0 0 14px;
  }
  .suggs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    width: 100%;
    max-width: 440px;
  }
  .sugg {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-2);
    font-family: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
    text-align: left;
    transition:
      color var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }
  .sugg :global(svg) {
    flex-shrink: 0;
    color: var(--text-3);
    transition: color var(--dur) var(--ease);
  }
  .sugg:hover {
    color: var(--text);
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .sugg:hover :global(svg) {
    color: var(--accent);
  }
  .sugg:active {
    transform: scale(0.98);
  }
</style>
