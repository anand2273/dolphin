import { describe, expect, it } from "vitest";
import { clusterConcepts, pairKey } from "@/lib/concepts/cluster";

const c = (id: string, name: string) => ({ id, name });
const NONE = new Set<string>();

describe("pairKey", () => {
  it("is order independent", () => {
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});

describe("clusterConcepts", () => {
  it("groups concepts sharing a normalised key", () => {
    const clusters = clusterConcepts(
      [c("1", "alcohol"), c("2", "alcohols"), c("3", "nitrate")],
      NONE,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].concepts.map((x) => x.id).sort()).toEqual(["1", "2"]);
  });

  it("drops groups of one", () => {
    expect(clusterConcepts([c("1", "nitrate"), c("2", "nitrite")], NONE))
      .toHaveLength(0);
  });

  it("hides a cluster whose every pair is rejected", () => {
    const rejected = new Set([pairKey("1", "2")]);
    expect(clusterConcepts([c("1", "alcohol"), c("2", "alcohols")], rejected))
      .toHaveLength(0);
  });

  it("still shows a cluster with one unrejected pair", () => {
    // 1 and 2 were rejected, but 3 has just arrived and was never ruled on.
    const rejected = new Set([pairKey("1", "2")]);
    const clusters = clusterConcepts(
      [c("1", "alcohol"), c("2", "alcohols"), c("3", "Alcohols")],
      rejected,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].concepts).toHaveLength(3);
  });

  it("excludes concepts whose key is empty", () => {
    expect(clusterConcepts([c("1", "the of"), c("2", "and a")], NONE))
      .toHaveLength(0);
  });

  it("orders clusters largest first", () => {
    const clusters = clusterConcepts(
      [
        c("1", "alcohol"), c("2", "alcohols"), c("3", "Alcohol"),
        c("4", "rate constant"), c("5", "rate constants"),
      ],
      NONE,
    );
    expect(clusters[0].concepts).toHaveLength(3);
  });
});
