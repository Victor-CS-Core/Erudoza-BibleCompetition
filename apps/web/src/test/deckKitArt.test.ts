const brandWebps = import.meta.glob("../../public/brand/*.webp", { eager: true });

function brandWebpNames() {
  return Object.keys(brandWebps).map((path) => path.slice(path.lastIndexOf("/") + 1));
}

describe("academy deck kit art", () => {
  it("wires Learner / Reviews / Rehearsal pack files and retires leftover New / Review / Simulation webps", () => {
    const names = brandWebpNames();
    expect(names).toEqual(expect.arrayContaining(["deck-learner.webp", "deck-reviews.webp", "deck-rehearsal.webp"]));
    expect(names).not.toContain("deck-new.webp");
    expect(names).not.toContain("deck-review.webp");
    expect(names).not.toContain("deck-simulation.webp");
  });
});
