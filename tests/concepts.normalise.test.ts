import { describe, expect, it } from "vitest";
import { normalisedKey } from "@/lib/concepts/normalise";

const same = (a: string, b: string) =>
  expect(normalisedKey(a)).toBe(normalisedKey(b));
const different = (a: string, b: string) =>
  expect(normalisedKey(a)).not.toBe(normalisedKey(b));

describe("normalisedKey — pairs that MUST cluster", () => {
  it("collapses plurals", () => {
    same("alcohol", "alcohols");
    same("rate constant", "rate constants");
    same("ionisation energy", "ionisation energies");
    same("chiral centre", "chiral centres");
  });

  it("collapses apostrophe styles", () => {
    same("coulomb's law", "coulomb's law");
    same("newton's law of gravitation", "newton's law of gravitation");
  });

  it("collapses British and American spelling", () => {
    same("ideal gas behaviour", "ideal gas behavior");
  });

  it("collapses word order", () => {
    same("Inverse Matrix", "Matrix Inverse");
    same("batteries and fuel cells", "fuel cells and batteries");
    same("Concept of Definite Integral", "Definite Integral Concept");
  });

  it("collapses stopword differences", () => {
    same("nucleus of the atom", "the nucleus of the atom");
    same("recycling of plastics", "recycling plastics");
    same("Testing a population mean", "Testing for Population Mean");
  });

  it("is case insensitive", () => {
    same("Binomial Coefficient", "binomial coefficients");
  });
});

describe("normalisedKey — pairs that MUST NOT cluster", () => {
  it("keeps chemically distinct names apart", () => {
    different("nitrate", "nitrite");
    different("alkanes", "alkenes");
    different("acid dissociation constants", "base dissociation constants");
  });

  it("keeps physically distinct names apart", () => {
    different("electric potential", "electric potential energy");
    different("gravitational field strength", "gravitational potential");
  });

  it("keeps different aspects of one subject apart", () => {
    different(
      "formation of carboxylic acids",
      "reactions of carboxylic acids",
    );
  });
});

describe("normalisedKey — shape", () => {
  it("is stable under repeated application of the same input", () => {
    expect(normalisedKey("Rate Constants")).toBe(normalisedKey("rate constant"));
  });

  it("returns a non-empty key for a name made only of stopwords", () => {
    // An all-stopword name yields an empty key; clusterConcepts (Task 3) must exclude these.
    expect(normalisedKey("the of and")).toBe("");
  });
});
