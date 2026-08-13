/* Barrel: keep `import … from "../stores"` working everywhere while the
   implementation is organized by domain (persistence, settings, ui, …). */
export { uid, cacheClearSafe } from "./persistence";
export {
  DEFAULT_SETTINGS,
  settings,
  updateSettings,
  togglePlugin,
  installPlugin,
  uninstallPlugin,
  fetchedModels,
  addCustomModel,
  removeCustomModel,
  addMemory,
  importMemories,
  toggleMemory,
  deleteMemory,
  completeOnboarding,
  reopenLogin,
} from "./settings";
export {
  type View,
  type UiState,
  ui,
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
  openConversation,
  deleteConversation,
  clearHistory,
} from "./conversations";
export {
  customPersonas,
  allPersonas,
  getPersona,
  upsertPersona,
  deletePersona,
} from "./personas";
export { hydrate } from "./hydrate";
