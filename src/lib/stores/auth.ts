import { writable } from "svelte/store";
import { providers } from "../providers";

/** Which providers currently have the credential they need, keyed by provider id.
 *
 *  One source of truth for "can this actually answer?" — the model picker lists
 *  only authed providers, and Settings/Onboarding refresh this after any
 *  sign-in, sign-out, or key change instead of each screen tracking its own
 *  connected flag. */
export const providerAuth = writable<Record<string, boolean>>({});

export async function refreshProviderAuth(): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    providers.map(async (p) => {
      try {
        return [p.id, await p.isAuthed()] as const;
      } catch {
        return [p.id, false] as const;
      }
    }),
  );
  const map = Object.fromEntries(entries);
  providerAuth.set(map);
  return map;
}

/** Provider to fall back to when nothing is connected yet: Codex, whose default
 *  model needs no API key of ours — the user only has to sign in to the CLI. */
export const FALLBACK_PROVIDER_ID = "codex";
