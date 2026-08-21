import { definePluginState, type PluginStateSpec } from "../../stores/plugin-state";

export interface ScreenContextState {
  schemaVersion?: number;
  reviewBeforeSend: boolean;
  autoRedact: boolean;
}

export const screenContextStateSpec: PluginStateSpec<ScreenContextState> = {
  id: "screen-context",
  schema: 2,
  defaults: { schemaVersion: 2, reviewBeforeSend: false, autoRedact: true },
  migrations: [
    {
      to: 2,
      describe: "Enable local automatic redaction by default",
      apply(draft, stored) {
        if (!("autoRedact" in stored)) draft.autoRedact = true;
      },
    },
  ],
};

export const screenContextState = definePluginState(screenContextStateSpec);
