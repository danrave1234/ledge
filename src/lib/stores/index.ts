/* Barrel: components import everything store-shaped from `$lib/stores`, while
   the implementation stays split by domain (persistence, settings, ui, …). */
export { uid, cacheClearSafe, flushWrites } from "./persistence";
export {
  settings,
  updateSettings,
  setProvider,
  selectModel,
  setFetchedModels,
  togglePlugin,
  installPlugin,
  uninstallPlugin,
  addCustomModel,
  removeCustomModel,
  addMemory,
  importMemories,
  toggleMemory,
  deleteMemory,
  restoreMemory,
  completeOnboarding,
  reopenLogin,
} from "./settings";
export { providerAuth, refreshProviderAuth, FALLBACK_PROVIDER_ID } from "./auth";
export { justUpdatedFrom, reconcileVersion } from "./version";
export {
  type View,
  type UiState,
  ui,
  setSettingsSection,
  setDraft,
  composerRequest,
  requestComposer,
  type ComposerRequest,
  canvas,
  openCanvas,
  openImage,
  closeCanvas,
  updateAvailable,
} from "./ui";
export {
  conversations,
  messages,
  activeId,
  newChat,
  saveActive,
  setConversationTitle,
  setConversationSummary,
  activeSummary,
  openConversation,
  deleteConversation,
  removeConversation,
  restoreConversation,
  purgeConversationAssets,
  resolveCard,
  truncateFrom,
  clearHistory,
} from "./conversations";
export { customPersonas, getPersona, upsertPersona, deletePersona } from "./personas";
export { hydrate, hydrationReady } from "./hydrate";
export {
  nowPlaying,
  refreshNowPlaying,
  syncMusicWatch,
  control,
  primarySession,
  isLive,
} from "./music";
export {
  toasts,
  toast,
  toastUndo,
  dismissToast,
  runToastAction,
  flushToasts,
  type Toast,
} from "./toast";
