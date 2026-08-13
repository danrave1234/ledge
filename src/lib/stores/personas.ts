import { writable, get } from "svelte/store";
import type { Persona } from "../types";
import { BUILTIN_PERSONAS } from "../personas";
import { settings } from "./settings";

export const customPersonas = writable<Persona[]>([]);

export function allPersonas(): Persona[] {
  return [...BUILTIN_PERSONAS, ...get(customPersonas)];
}

export function getPersona(id: string): Persona {
  return allPersonas().find((p) => p.id === id) ?? BUILTIN_PERSONAS[0];
}

export function upsertPersona(p: Persona) {
  customPersonas.update((list) => {
    const exists = list.some((x) => x.id === p.id);
    return exists ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p];
  });
}

export function deletePersona(id: string) {
  customPersonas.update((list) => list.filter((p) => p.id !== id));
  if (get(settings).personaId === id) {
    settings.update((s) => ({ ...s, personaId: "default" }));
  }
}
