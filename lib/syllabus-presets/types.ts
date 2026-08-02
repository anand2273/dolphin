/**
 * Backend-authored syllabus presets. These are static code fixtures, not DB
 * rows — there is no admin UI and no `is_preset` flag on `syllabuses`.
 * "Create from preset" deep-copies one of these into a brand-new tutor-owned
 * syllabus + topics + concepts; editing the copy never touches this fixture or
 * any other tutor's data.
 */
export type SyllabusPresetConcept = {
  name: string;
  description?: string;
};

export type SyllabusPresetTopic = {
  name: string;
  description?: string;
  concepts?: SyllabusPresetConcept[];
};

export type SyllabusPreset = {
  /** Stable identifier, stored as `syllabuses.preset_key` for provenance only. */
  key: string;
  title: string;
  subject?: string;
  level?: string;
  description?: string;
  topics: SyllabusPresetTopic[];
};
