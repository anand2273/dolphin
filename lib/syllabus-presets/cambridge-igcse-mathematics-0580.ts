import type { SyllabusPreset } from "./types";

/**
 * A representative slice of the syllabus, not the full official spec — enough
 * for a tutor to start from and customize. Extend as real presets are authored.
 */
export const cambridgeIgcseMathematics0580: SyllabusPreset = {
  key: "cambridge-igcse-mathematics-0580",
  title: "Cambridge IGCSE Mathematics 0580",
  subject: "Mathematics",
  level: "IGCSE",
  description:
    "Cambridge International's IGCSE Mathematics syllabus (0580), commonly tutored in Singapore.",
  topics: [
    {
      name: "Number",
      description: "Types of number, ratio, percentages, standard form, surds.",
      concepts: [
        { name: "Standard Form" },
        { name: "Ratio and Proportion" },
        { name: "Percentages" },
        { name: "Surds" },
      ],
    },
    {
      name: "Algebra",
      description: "Expressions, equations, sequences, functions, inequalities.",
      concepts: [
        { name: "Quadratic Formula" },
        { name: "Simultaneous Equations" },
        { name: "Sequences" },
        { name: "Inequalities" },
      ],
    },
    {
      name: "Geometry",
      description: "Properties of shapes, similarity, congruence, constructions.",
      concepts: [
        { name: "Similarity and Congruence" },
        { name: "Circle Theorems" },
        { name: "Bearings" },
      ],
    },
    {
      name: "Trigonometry",
      description: "Right-angled and non-right-angled triangle trigonometry.",
      concepts: [
        { name: "Sine and Cosine Rules" },
        { name: "Trigonometric Ratios" },
      ],
    },
    {
      name: "Statistics and Probability",
      description: "Data representation, measures of central tendency, probability.",
      concepts: [
        { name: "Probability" },
        { name: "Mean, Median and Mode" },
        { name: "Histograms" },
      ],
    },
  ],
};
