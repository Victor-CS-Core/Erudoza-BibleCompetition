import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const brandDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public/brand");

describe("academy deck kit art", () => {
  it("wires Learner / Reviews / Rehearsal pack files and retires leftover New / Review / Simulation webps", () => {
    expect(existsSync(resolve(brandDir, "deck-learner.webp"))).toBe(true);
    expect(existsSync(resolve(brandDir, "deck-reviews.webp"))).toBe(true);
    expect(existsSync(resolve(brandDir, "deck-rehearsal.webp"))).toBe(true);
    expect(existsSync(resolve(brandDir, "deck-new.webp"))).toBe(false);
    expect(existsSync(resolve(brandDir, "deck-review.webp"))).toBe(false);
    expect(existsSync(resolve(brandDir, "deck-simulation.webp"))).toBe(false);
  });
});
