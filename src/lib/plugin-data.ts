import { setYoutubeKey, spotifyDisconnect } from "./native";
import { deletePluginState } from "./stores/plugin-state";

/** Remove state and credentials owned by an optional plugin. */
export async function deletePluginData(id: string): Promise<void> {
  if (id === "music") {
    await Promise.allSettled([spotifyDisconnect(), setYoutubeKey("")]);
  }
  await deletePluginState(id);
}
