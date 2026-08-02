import type { SyllabusPreset } from "./types";

/**
 * A representative slice of the syllabus, not the full official spec — enough
 * for a tutor to start from and customize. Extend as real presets are authored.
 */
export const psleMathematics: SyllabusPreset = {
  key: "psle-mathematics",
  title: "PSLE Mathematics",
  subject: "Mathematics",
  level: "Primary",
  description: "Singapore's Primary School Leaving Examination Mathematics syllabus.",
  topics: [
    {
      name: "Whole Numbers",
      description: "Place value, the four operations, order of operations.",
      concepts: [{ name: "Order of Operations" }, { name: "Place Value" }],
    },
    {
      name: "Fractions and Decimals",
      concepts: [
        { name: "Equivalent Fractions" },
        { name: "Fraction of a Quantity" },
        { name: "Decimal Place Value" },
      ],
    },
    {
      name: "Ratio and Percentage",
      concepts: [{ name: "Ratio and Proportion" }, { name: "Percentages" }],
    },
    {
      name: "Measurement",
      description: "Area, perimeter, volume, and rate.",
      concepts: [{ name: "Area and Perimeter" }, { name: "Volume of Cubes and Cuboids" }],
    },
    {
      name: "Geometry",
      description: "Angles, properties of shapes, nets.",
      concepts: [{ name: "Angle Properties" }, { name: "Nets of Solids" }],
    },
    {
      name: "Data Analysis",
      description: "Tables, graphs, and average.",
      concepts: [{ name: "Mean, Median and Mode" }, { name: "Reading Graphs" }],
    },
  ],
};
