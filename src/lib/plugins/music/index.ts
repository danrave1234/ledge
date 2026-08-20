import type { PluginModule } from "../types";
import type { Settings, TurnConsent } from "../../types";
import { pluginActive } from "../../plugins";
import { musicTools, canControl } from "./tools";
import { spotifyTools, spotifyReady } from "./spotify-tools";
import { youtubeTools, youtubeKeyPresent } from "./youtube-tools";
import MusicCard from "./MusicCard.svelte";
import MusicPicker from "./MusicPicker.svelte";
import MusicSettings from "./MusicSettings.svelte";

/** Standing facts about the music capability.
 *
 *  This exists because of a specific failure: the model will confidently accept
 *  "play my Discover Weekly" and then do nothing, because SMTC can only drive
 *  what a player already has loaded. The tool description says so, but a model
 *  that has decided not to call the tool never reads it — so it belongs in the
 *  prompt too, where it shapes the answer before any tool is chosen. */
function context(s: Settings, consent: TurnConsent): string | null {
  if (!pluginActive(s, "music")) return null;

  const lines = [
    "Music: you can see what the user is listening to in any player (Spotify, YouTube Music, a browser tab, a desktop app).",
  ];
  if (canControl(s, consent)) {
    lines.push(
      "You can also play, pause, skip, and seek whatever is already loaded in that player.",
    );
  } else {
    lines.push(
      "You can only READ what is playing this turn — playback control is off. If the user asks you to pause or skip, say the Music toggle in the composer needs turning on.",
    );
  }

  if (canControl(s, consent) && spotifyReady()) {
    lines.push(
      "Their Spotify account is connected, so you can also search it and start a specific song, album, or playlist. When a request could match several things, prefer music_search and let the user tap one of the buttons rather than choosing for them. For a playlist of THEIRS, use music_playlists — a search returns other people's playlists.",
    );
  } else {
    // Without this the model accepts "play my Discover Weekly" and then does
    // nothing, because transport control can only drive an already-loaded track.
    lines.push(
      "Spotify is NOT connected, so you cannot search it or start a specific song from it.",
    );
  }

  if (canControl(s, consent)) {
    // Honesty about the weakest layer. Without this the model reports "playing
    // X on YouTube Music" whenever the tool returns, and browsers block
    // autoplay often enough that the claim is regularly false.
    lines.push(
      "You can also open something on YouTube Music in the user's browser (music_play_youtube)." +
        (youtubeKeyPresent()
          ? ""
          : " Without a YouTube API key you can only open a SEARCH there, not a specific track — say so rather than implying you played something.") +
        " YouTube playback is opened in a browser tab and is not guaranteed to start: only say it is playing when the tool result says it was confirmed. Prefer Spotify when it is connected.",
    );
  }

  if (!canControl(s, consent) || (!spotifyReady() && !youtubeKeyPresent())) {
    lines.push(
      "If the user asks you to put on a specific song, album, or playlist and you have no way to start it, say plainly that you can only control what is already playing, and that connecting Spotify in Settings → Plugins → Music would let you start things.",
    );
  }
  return lines.join(" ");
}

export const musicPlugin: PluginModule = {
  id: "music",
  tools: [...musicTools, ...spotifyTools, ...youtubeTools],
  context,
  cards: { now_playing: MusicCard, music_picker: MusicPicker },
  settingsPanel: MusicSettings,
};
