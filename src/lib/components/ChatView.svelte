<script lang="ts">
  import Message from "./Message.svelte";
  import Composer from "./Composer.svelte";
  import Icon from "./Icon.svelte";
  import { messages, ui, settings } from "../stores";
  import { pluginActive } from "../plugins";
  import { send } from "../controller";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";

  let list = $derived($messages);
  let generating = $derived($ui.generating);
  let scroller: HTMLDivElement | undefined = $state();

  let suggestions = $derived([
    ...(pluginActive($settings, "job-analyzer")
      ? ["Is this job applicable to me? Should I apply?"]
      : []),
    "Summarize what's on my screen",
    "Draft a reply to this email",
  ]);

  let prevLen = 0;
  $effect(() => {
    const len = list.length;
    // touch last content so the effect re-runs on each streamed token
    if (len) void list[len - 1].content;
    if (!scroller) return;
    const added = len > prevLen;
    prevLen = len;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    // Jump to the newest message; while streaming, only follow if already at the bottom.
    if (added || nearBottom) scroller.scrollTop = scroller.scrollHeight;
  });
</script>

<div class="scroll" bind:this={scroller}>
  {#if list.length === 0}
    <div class="empty" in:fade={{ duration: 180 }}>
      <div class="orb"><Icon name="spark" size={22} /></div>
      <p class="hi">How can I help?</p>
      <div class="suggs">
        {#each suggestions as sg, i}
          <button
            class="sugg"
            in:fly={{ y: 8, duration: 260, delay: 50 * i, easing: cubicOut }}
            onclick={() => send(sg)}>{sg}</button>
        {/each}
      </div>
    </div>
  {:else}
    {#each list as m, i (m.id)}
      <Message
        msg={m}
        streaming={generating && i === list.length - 1 && m.role === "assistant"} />
    {/each}
  {/if}
</div>
<Composer />

<style>
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 14px 14px 4px;
    min-height: 0;
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
    border-radius: 15px;
    background: var(--accent-weak);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
  }
  .hi {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 14px;
  }
  .suggs {
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 100%;
    max-width: 300px;
  }
  .sugg {
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }
  .sugg:hover {
    color: var(--text);
    border-color: var(--accent);
  }
</style>
