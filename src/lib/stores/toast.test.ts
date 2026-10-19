import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import {
  toasts,
  toast,
  toastUndo,
  dismissToast,
  runToastAction,
  flushToasts,
} from "./toast";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  flushToasts();
  vi.useRealTimers();
});

describe("toasts", () => {
  it("expires on its own", () => {
    toast("Saved");
    expect(get(toasts).map((t) => t.message)).toEqual(["Saved"]);
    vi.advanceTimersByTime(3000);
    expect(get(toasts)).toEqual([]);
  });

  it("commits an undo toast once it expires without Undo", () => {
    const undo = vi.fn();
    const commit = vi.fn();
    toastUndo("Deleted", undo, commit);
    vi.advanceTimersByTime(4000);
    expect(commit).not.toHaveBeenCalled(); // undo toasts stay up longer
    vi.advanceTimersByTime(2000);
    expect(commit).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });

  it("Undo reverses the change and never commits it", () => {
    const undo = vi.fn();
    const commit = vi.fn();
    const id = toastUndo("Deleted", undo, commit);
    runToastAction(id);
    vi.advanceTimersByTime(10_000);
    expect(undo).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(get(toasts)).toEqual([]);
  });

  it("dismissing commits, and so does overflow or quitting", () => {
    const commits = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const ids = commits.map((c, i) => toastUndo(`#${i}`, () => {}, c));
    // Only the newest two stay visible; older ones finish early.
    expect(get(toasts).map((t) => t.message)).toEqual(["#2", "#3"]);
    expect(commits[0]).toHaveBeenCalledOnce();
    expect(commits[1]).toHaveBeenCalledOnce();
    dismissToast(ids[2]);
    expect(commits[2]).toHaveBeenCalledOnce();
    flushToasts();
    expect(commits[3]).toHaveBeenCalledOnce();
    expect(get(toasts)).toEqual([]);
  });
});
