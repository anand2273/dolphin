import { cambridgeIgcseMathematics0580 } from "./cambridge-igcse-mathematics-0580";
import { psleMathematics } from "./psle-mathematics";
import type { SyllabusPreset } from "./types";

export type { SyllabusPreset, SyllabusPresetConcept, SyllabusPresetTopic } from "./types";

/** The full registry, for the "choose a preset" UI to list from. */
export const SYLLABUS_PRESETS: SyllabusPreset[] = [
  psleMathematics,
  cambridgeIgcseMathematics0580,
];

export function getSyllabusPreset(key: string): SyllabusPreset | null {
  return SYLLABUS_PRESETS.find((p) => p.key === key) ?? null;
}
