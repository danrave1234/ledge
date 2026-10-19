<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";

  let {
    image,
    redacted = false,
    onredact,
    onreset,
    onremove,
    onrecapture,
  }: {
    image: string;
    /** True once the user has blacked something out of this capture. */
    redacted?: boolean;
    onredact: (image: string) => void;
    onreset: () => void;
    onremove: () => void;
    onrecapture: () => void;
  } = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let start: { x: number; y: number } | null = null;
  let box = $state<{ left: number; top: number; width: number; height: number } | null>(
    null,
  );
  // Painted onto the image itself, so this is pixel data rather than UI chrome.
  const REDACTION_COLOR = "#000";

  function paint() {
    if (!canvas) return;
    const img = new Image();
    img.onload = () => {
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
    };
    img.src = image;
  }

  $effect(() => {
    void image;
    paint();
  });

  function point(e: PointerEvent) {
    const rect = canvas!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas!.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas!.height,
    };
  }

  /** The drag rectangle in CSS pixels, drawn live so you can see what will be hidden. */
  function cssBox(e: PointerEvent) {
    if (!canvas || !start) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = (start.x / canvas.width) * rect.width;
    const sy = (start.y / canvas.height) * rect.height;
    const ex = e.clientX - rect.left;
    const ey = e.clientY - rect.top;
    return {
      left: Math.min(sx, ex),
      top: Math.min(sy, ey),
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
    };
  }

  function begin(e: PointerEvent) {
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    start = point(e);
  }

  function move(e: PointerEvent) {
    if (start) box = cssBox(e);
  }

  function finish(e: PointerEvent) {
    box = null;
    if (!canvas || !start) return;
    const end = point(e);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    start = null;
    if (w < 2 || h < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = REDACTION_COLOR;
    ctx.fillRect(x, y, w, h);
    onredact(canvas.toDataURL("image/png"));
  }
</script>

<section class="preview" aria-label="Screen capture preview">
  <div class="preview-head">
    <Icon name="screen" size={13} />
    <span class="title">Review before sending</span>
    <span class="hint">Drag over anything private to black it out</span>
    {#if redacted}
      <button class="btn btn-sm" onclick={onreset} title="Undo all redactions">
        Undo redactions
      </button>
    {/if}
    <button
      class="icon-btn"
      onclick={onrecapture}
      aria-label="Recapture screen"
      title="Recapture"
    >
      <Icon name="refresh" size={14} />
    </button>
    <button
      class="icon-btn"
      onclick={onremove}
      aria-label="Remove screen capture"
      title="Don't send the screen"
    >
      <Icon name="x" size={14} />
    </button>
  </div>
  <div class="stage">
    <canvas
      bind:this={canvas}
      onpointerdown={begin}
      onpointermove={move}
      onpointerup={finish}
      onpointercancel={() => {
        start = null;
        box = null;
      }}
      tabindex="0"
      aria-label="Exact screen image that will be sent. Drag to hide sensitive content."
    ></canvas>
    {#if box}
      <div
        class="box"
        style="left:{box.left}px;top:{box.top}px;width:{box.width}px;height:{box.height}px"
      ></div>
    {/if}
  </div>
</section>

<style>
  .preview {
    margin-bottom: 8px;
    overflow: hidden;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .preview-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 9px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .title {
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    margin-right: auto;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stage {
    position: relative;
  }
  canvas {
    display: block;
    width: 100%;
    max-height: 128px;
    object-fit: contain;
    cursor: crosshair;
    touch-action: none;
    background: var(--surface-3);
  }
  .box {
    position: absolute;
    pointer-events: none;
    background: color-mix(in srgb, var(--text) 70%, transparent);
    outline: 1px dashed var(--accent);
  }
</style>
