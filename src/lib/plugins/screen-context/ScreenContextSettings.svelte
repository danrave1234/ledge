<script lang="ts">
  import { screenContextState } from "$lib/plugins/screen-context/state";

  const preferences = screenContextState.store;
  let state = $derived($preferences);
</script>

<div class="row">
  <div>
    <strong>Review and redact before sending</strong>
    <p>Show the captured window in the composer so you can hide sensitive content.</p>
  </div>
  <button
    class="switch"
    class:on={state.reviewBeforeSend}
    role="switch"
    aria-checked={state.reviewBeforeSend}
    aria-label="Review and redact before sending"
    onclick={() =>
      screenContextState.update({ reviewBeforeSend: !state.reviewBeforeSend })}
    ><i></i></button
  >
</div>

<div class="row">
  <div>
    <strong>Automatically redact sensitive data</strong>
    <p>Locally mask common secrets, payment numbers, emails, and phone numbers.</p>
  </div>
  <button
    class="switch"
    class:on={state.autoRedact}
    role="switch"
    aria-checked={state.autoRedact}
    aria-label="Automatically redact sensitive data"
    onclick={() => screenContextState.update({ autoRedact: !state.autoRedact })}
    ><i></i></button
  >
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .row + .row {
    margin-top: 14px;
  }
  strong {
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  p {
    margin: 3px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
    line-height: var(--lh-tight);
  }
</style>
