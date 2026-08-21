<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";

  let { image, onredact, onremove, onrecapture } = $props<{
    image: string;
    onredact: (image: string) => void;
    onremove: () => void;
    onrecapture: () => void;
  }>();

  let canvas: HTMLCanvasElement | undefined = $state();
  let start: { x: number; y: number } | null = null;
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

  function begin(e: PointerEvent) {
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    start = point(e);
  }

  function finish(e: PointerEvent) {
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
    <span>Screen to send</span>
    <span class="hint">Drag to redact</span>
    <button class="active" aria-pressed="true">Redact</button>
    <button class="icon-btn" onclick={onrecapture} aria-label="Recapture screen">
      <Icon name="refresh" size={13} />
    </button>
    <button class="icon-btn" onclick={onremove} aria-label="Remove screen capture">
      <Icon name="x" size={13} />
    </button>
  </div>
  <canvas
    bind:this={canvas}
    onpointerdown={begin}
    onpointerup={finish}
    onpointercancel={() => (start = null)}
    tabindex="0"
    aria-label="Exact screen image that will be sent. Drag to hide sensitive content."
  ></canvas>
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
    padding: 5px 7px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .hint {
    margin-right: auto;
    color: var(--text-3);
  }
  .preview-head button.active {
    color: var(--accent);
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
</style>
