<script lang="ts">
  import type { Msg } from "../types";
  import { renderMd } from "../md";
  import { openExternal } from "../native";
  import { openCanvas, reopenLogin } from "../stores";
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "./Icon.svelte";

  let proseEl: HTMLDivElement | undefined = $state();

  let { msg, streaming = false }: { msg: Msg; streaming?: boolean } = $props();

  // Throttle markdown rendering so long streamed replies don't re-parse the whole
  // message on every token (O(n^2)); render immediately once streaming finishes.
  let html = $state("");
  let lastRender = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    if (msg.role !== "assistant") return;
    const content = msg.content;
    if (!streaming) {
      clearTimeout(pending);
      html = renderMd(content);
      return;
    }
    const now = Date.now();
    if (now - lastRender >= 70) {
      lastRender = now;
      html = renderMd(content);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => {
        lastRender = Date.now();
        html = renderMd(msg.content);
      }, 70);
    }
    return () => clearTimeout(pending);
  });

  // Wrap each code block in a canvas card (language label + copy + expand).
  // Depend on `html` explicitly and run after the {@html} DOM update via tick().
  $effect(() => {
    const el = proseEl;
    const current = html;
    if (!el || current === "") return;
    let cancelled = false;
    tick().then(() => {
      if (!cancelled && proseEl) enhanceCode(proseEl);
    });
    return () => {
      cancelled = true;
    };
  });

  function enhanceCode(root: HTMLElement) {
    root.querySelectorAll("pre").forEach((pre) => {
      const parent = pre.parentElement;
      if (parent?.classList.contains("canvas-block")) return;
      const code = pre.querySelector("code");
      const langClass = code
        ? Array.from(code.classList).find((c) => c.startsWith("language-"))
        : undefined;
      const lang = langClass ? langClass.replace("language-", "") : "code";

      const wrap = document.createElement("div");
      wrap.className = "canvas-block";
      const head = document.createElement("div");
      head.className = "canvas-head";
      const label = document.createElement("span");
      label.className = "canvas-lang";
      label.textContent = lang;
      const spacer = document.createElement("span");
      spacer.className = "canvas-spacer";
      const copyBtn = document.createElement("button");
      copyBtn.className = "canvas-btn";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(code?.textContent ?? "");
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
      };
      const expandBtn = document.createElement("button");
      expandBtn.className = "canvas-btn";
      expandBtn.type = "button";
      expandBtn.textContent = "Expand";
      expandBtn.onclick = () => openCanvas(lang, code?.textContent ?? "");

      head.append(label, spacer, copyBtn, expandBtn);
      parent?.insertBefore(wrap, pre);
      wrap.append(head, pre);
    });
  }

  // Open links from model/web output in the real browser, never in the webview.
  function externalLinks(node: HTMLElement) {
    const handler = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      const href = a?.getAttribute("href");
      if (href) {
        e.preventDefault();
        openExternal(href);
      }
    };
    node.addEventListener("click", handler);
    return {
      destroy() {
        node.removeEventListener("click", handler);
      },
    };
  }
</script>

<div class="msg {msg.role}" in:fly={{ y: 10, duration: 200, easing: cubicOut }}>
  {#if msg.role === "user"}
    <div class="bubble user">{msg.content}</div>
    {#if msg.usedScreen || msg.usedWeb}
      <div class="tags">
        {#if msg.usedScreen}<span><Icon name="screen" size={12} /> screen</span>{/if}
        {#if msg.usedWeb}<span><Icon name="web" size={12} /> web</span>{/if}
      </div>
    {/if}
  {:else}
    <div class="bubble asst" class:error={msg.error}>
      {#if msg.content === "" && streaming}
        <span class="typing"><i></i><i></i><i></i></span>
      {:else}
        <div class="prose" bind:this={proseEl} use:externalLinks>{@html html}</div>
        {#if streaming}<span class="caret"></span>{/if}
        {#if msg.action === "auth"}
          <button class="authbtn" onclick={reopenLogin}>Connect an account →</button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .msg.user {
    align-items: flex-end;
  }
  .bubble {
    max-width: 88%;
    font-size: 13.5px;
    line-height: 1.55;
    border-radius: 13px;
    padding: 9px 12px;
    word-wrap: break-word;
    user-select: text;
  }
  .bubble.user {
    background: var(--accent-weak);
    color: var(--accent-text);
    border-bottom-right-radius: 4px;
  }
  .bubble.asst {
    background: var(--surface-2);
    color: var(--text);
    border-bottom-left-radius: 4px;
  }
  .bubble.asst.error {
    background: var(--danger-weak);
    color: var(--danger);
  }
  .authbtn {
    display: block;
    margin-top: 10px;
    padding: 8px 13px;
    border-radius: 9px;
    border: 1px solid var(--accent);
    background: var(--accent-weak);
    color: var(--accent-text);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .authbtn:hover {
    background: var(--accent);
    color: var(--accent-on);
  }
  .tags {
    display: flex;
    gap: 8px;
  }
  .tags span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-3);
  }
  .prose :global(p) {
    margin: 0 0 8px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }
  .prose :global(ul),
  .prose :global(ol) {
    margin: 6px 0;
    padding-left: 18px;
  }
  .prose :global(li) {
    margin: 3px 0;
  }
  .prose :global(code) {
    font-family: var(--mono);
    font-size: 12px;
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: 5px;
  }
  .prose :global(pre) {
    background: var(--surface-3);
    padding: 10px 12px;
    border-radius: 9px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .prose :global(pre code) {
    background: none;
    padding: 0;
  }
  .prose :global(.canvas-block) {
    margin: 10px 0;
    border: 1px solid var(--border-2);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface-3);
  }
  .prose :global(.canvas-head) {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px 5px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .prose :global(.canvas-lang) {
    font-size: 11px;
    color: var(--text-3);
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .prose :global(.canvas-spacer) {
    flex: 1;
  }
  .prose :global(.canvas-btn) {
    border: none;
    background: transparent;
    color: var(--text-2);
    font-size: 11.5px;
    padding: 3px 9px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .prose :global(.canvas-btn:hover) {
    background: var(--surface-3);
    color: var(--text);
  }
  .prose :global(.canvas-block pre) {
    margin: 0;
    border-radius: 0;
    background: transparent;
  }
  .prose :global(a) {
    color: var(--accent-text);
  }
  .prose :global(strong) {
    font-weight: 600;
  }
  .caret {
    display: inline-block;
    width: 7px;
    height: 14px;
    background: var(--accent);
    border-radius: 2px;
    margin-left: 1px;
    vertical-align: -2px;
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .typing {
    display: inline-flex;
    gap: 4px;
    padding: 2px 0;
  }
  .typing i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-3);
    animation: bounce 1.2s infinite;
  }
  .typing i:nth-child(2) { animation-delay: 0.15s; }
  .typing i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
    30% { transform: translateY(-4px); opacity: 1; }
  }
</style>
