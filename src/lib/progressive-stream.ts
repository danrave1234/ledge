const FRAME_MS = 18;
const TARGET_FRAMES = 28;

/** Smooths provider batches into visible increments without delaying the model. */
export class ProgressiveStream {
  private queued = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finishing = false;
  private finishFrames = TARGET_FRAMES;
  private resolveFinished: (() => void) | undefined;

  constructor(private readonly reveal: (text: string) => void) {}

  append(text: string) {
    if (!text || this.finishing) return;
    const wasIdle = !this.timer && !this.queued;
    this.queued += text;
    if (wasIdle) this.revealNext();
  }

  finish(): Promise<void> {
    this.finishing = true;
    this.finishFrames = TARGET_FRAMES;
    if (!this.queued && !this.timer) return Promise.resolve();
    return new Promise((resolve) => {
      this.resolveFinished = resolve;
      if (!this.timer) this.schedule();
    });
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queued = "";
    this.resolveFinished?.();
    this.resolveFinished = undefined;
  }

  private revealNext() {
    this.timer = undefined;
    if (!this.queued) {
      this.resolveFinished?.();
      this.resolveFinished = undefined;
      return;
    }

    const frames = this.finishing ? this.finishFrames : TARGET_FRAMES;
    const size = Math.max(1, Math.ceil(this.queued.length / frames));
    if (this.finishing) this.finishFrames = Math.max(1, this.finishFrames - 1);
    const boundary = this.safeBoundary(size);
    this.reveal(this.queued.slice(0, boundary));
    this.queued = this.queued.slice(boundary);
    if (this.queued) this.schedule();
    else if (this.finishing) {
      this.resolveFinished?.();
      this.resolveFinished = undefined;
    }
  }

  private schedule() {
    this.timer = setTimeout(() => this.revealNext(), FRAME_MS);
  }

  private safeBoundary(size: number) {
    if (size >= this.queued.length) return this.queued.length;
    const first = this.queued.charCodeAt(size - 1);
    const next = this.queued.charCodeAt(size);
    return first >= 0xd800 && first <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
      ? size + 1
      : size;
  }
}
