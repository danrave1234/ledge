<script lang="ts">
  import type { Msg } from "$lib/types";
  import { renderMd, renderStreamMd } from "$lib/md";
  import { openExternal } from "$lib/native";
  import { openCanvas, reopenLogin, openImage } from "$lib/stores";
  import { flyIn } from "$lib/motion";
  import { cardComponent, renderableCards } from "$lib/cards";
  import { tick } from "svelte";
  import { fly } from "svelte/transition";
  import Icon from "$lib/components/Icon.svelte";

  /** Cap markdown re-parses while streaming (ms). */
  const RENDER_THROTTLE = 70;

  let proseEl: HTMLDivElement | undefined = $state();

  let { msg, streaming = false }: { msg: Msg; streaming?: boolean } = $props();

  // Cards this build can draw. A conversation can outlive the plugin that
  // produced its cards, so an unknown type is skipped rather than rendered blank.
  let cards = $derived(renderableCards(msg.cards));

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
    // Mid-stream the source is half-typed markdown, so it is stabilized before
    // parsing (see md.ts) — otherwise every bold label and code span flashes as
    // raw punctuation before snapping into place.
    const now = Date.now();
    if (now - lastRender >= RENDER_THROTTLE) {
      lastRender = now;
      html = renderStreamMd(content);
    } else {
      clearTimeout(pending);
      pending = setTimeout(() => {
        lastRender = Date.now();
        html = renderStreamMd(msg.content);
      }, RENDER_THROTTLE);
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
      if (cancelled || !proseEl) return;
      enhanceCode(proseEl);
      linkCitations(proseEl);
    });
    return () => {
      cancelled = true;
    };
  });

  /** Turn the model's `[1]` markers into clickable superscript chips pointing at
   *  the matching source. Done on the rendered DOM rather than the markdown so a
   *  bracket inside a code block is never rewritten. */
  function linkCitations(root: HTMLElement) {
    const list = msg.sources ?? [];
    if (!list.length) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n as Text;
      if (text.parentElement?.closest("pre, code, .cite")) continue;
      if (/\[\d+\]/.test(text.data)) targets.push(text);
    }

    for (const node of targets) {
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of node.data.matchAll(/\[(\d+)\]/g)) {
        const n = Number(m[1]);
        const source = list[n - 1];
        const at = m.index ?? 0;
        if (!source) continue; // a number the model invented — leave as text
        frag.append(node.data.slice(last, at));
        const a = document.createElement("a");
        a.className = "cite";
        a.href = source.url;
        a.textContent = String(n);
        a.title = `${source.title} — ${source.url}`;
        frag.append(a);
        last = at + m[0].length;
      }
      if (last === 0) continue;
      frag.append(node.data.slice(last));
      node.replaceWith(frag);
    }
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

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

<div class="msg {msg.role}" in:fly={flyIn}>
  {#if msg.role === "user"}
    <div class="bubble user">{msg.content}</div>
    {#if msg.usedScreen || msg.usedWeb || msg.image}
      <div class="tags">
        {#if msg.image}
          <button class="viewbtn" onclick={() => openImage(msg.image!)}>
            <Icon name="screen" size={12} /> view {msg.usedScreen ? "screen" : "image"}
          </button>
        {/if}
        {#if msg.usedWeb}<span><Icon name="web" size={12} /> web</span>{/if}
      </div>
    {/if}
  {:else}
    <div class="bubble asst" class:error={msg.error}>
      {#if msg.content === "" && streaming}
        <span class="typing"><i></i><i></i><i></i></span>
      {:else}
        <!-- Model output is untrusted, so `html` is markdown rendered through
             DOMPurify in lib/md.ts (covered by md.test.ts). Never pass raw
             model text here. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="prose" bind:this={proseEl} use:externalLinks>{@html html}</div>
        {#if streaming}<span class="caret"></span>{/if}
        {#if cards.length && !streaming}
          <div class="cards">
            {#each cards as card, i (i)}
              <!-- Rendered as a component, never as HTML: card data carries
                   remote text (track titles, playlist names), and Svelte
                   templating escapes it. -->
              {@const Card = cardComponent(card.type)}
              <Card data={card.data} />
            {/each}
          </div>
        {/if}
        {#if msg.sources?.length && !streaming}
          <div class="sources" use:externalLinks>
            <span class="slabel">Sources</span>
            {#each msg.sources as src, i (src.url)}
              <!-- Not in-app navigation: `externalLinks` intercepts the click and
                   opens the URL in the real browser. The href is there so the
                   destination is visible on hover and copyable. -->
              <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
              <a class="source" href={src.url} title={src.title}>
                <span class="snum">{i + 1}</span>
                <span class="shost">{hostOf(src.url)}</span>
              </a>
            {/each}
          </div>
        {/if}
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
    font-size: var(--fs-md);
    line-height: var(--lh);
    border-radius: var(--radius-lg);
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
    border-radius: var(--radius-sm);
    border: 1px solid var(--accent);
    background: var(--accent-weak);
    color: var(--accent-text);
    font-family: inherit;
    font-size: var(--fs-sm);
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
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
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .viewbtn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: inherit;
    font-size: var(--fs-xs);
    color: var(--accent-text);
    background: var(--accent-weak);
    border: none;
    border-radius: var(--radius-pill);
    padding: 3px 9px;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .viewbtn:hover {
    background: var(--accent);
    color: var(--accent-on);
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
    font-size: var(--fs-sm);
    background: var(--surface-3);
    padding: 1px 5px;
    border-radius: var(--radius-xs);
  }
  .prose :global(pre) {
    background: var(--surface-3);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
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
    border-radius: var(--radius-md);
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
    font-size: var(--fs-xs);
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
    font-family: inherit;
    font-size: var(--fs-xs);
    padding: 3px 9px;
    border-radius: var(--radius-xs);
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
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
  /* Inline citation chip, ChatGPT-style: a small superscript number that opens
     the source in the real browser. */
  .prose :global(.cite) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    margin: 0 1px;
    border-radius: var(--radius-xs);
    background: var(--accent-weak);
    color: var(--accent-text);
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    vertical-align: 2px;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .prose :global(.cite:hover) {
    background: var(--accent);
    color: var(--accent-on);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 10px;
  }
  .sources {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid var(--border);
  }
  .slabel {
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 2px;
  }
  .source {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 3px 8px 3px 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: var(--surface);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-decoration: none;
    cursor: pointer;
    transition:
      border-color var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .source:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .snum {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--accent-weak);
    color: var(--accent-text);
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .shost {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    50% {
      opacity: 0;
    }
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
  .typing i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .typing i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.5;
    }
    30% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }
</style>
