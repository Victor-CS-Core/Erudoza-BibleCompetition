import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChaseBar, EntryAvatar, LevelCrest, MomentCard, PatchDisplay, PlayerCard, Podium, QuestCard, StatTile, XPBar, initialsFor, nextLevelName, type PodiumEntry } from "./GameLayer";
import type { QuestDto } from "../../api/trainingTypes";

// CSS imports are stubbed in this test setup, so the fidelity pins read the
// real stylesheet from disk (Node builtins are untyped in this tsconfig, so
// the specifier is built dynamically and loaded with a top-level await).
const nodeFs = "node:" + "fs";
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ nodeFs)) as {
  readFileSync(path: string, encoding: string): string;
  readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
};
const cwd = (globalThis as { process?: { cwd(): string } }).process?.cwd() ?? ".";
const gameLayerCss = readFileSync(`${cwd}/src/components/game/game-layer.css`, "utf8");

vi.mock("../../features/profile/character/CharacterPreview", () => ({
  CharacterPortrait: ({ appearance }: { appearance: { style: string } }) => <span className="character-portrait"><img src={`portrait://${appearance.style}`} alt="" data-character-portrait="true" /></span>,
}));

describe("LevelCrest tiers", () => {
  it("maps the eight levels onto kraft, teal, blue, gold and gold-flame rings", () => {
    const tiers: [number, string][] = [[1, "kraft"], [2, "kraft"], [3, "teal"], [4, "teal"], [5, "blue"], [6, "blue"], [7, "gold"], [8, "gold-flame"]];
    for (const [level, tier] of tiers) {
      const { container, unmount } = render(<LevelCrest level={level} />);
      expect(container.querySelector(".game-level-crest")).toHaveClass(`game-level-crest--${tier}`);
      expect(screen.getByRole("img", { name: `Level ${level} · ${["Seedling", "Seeker", "Reader", "Keeper", "Scribe", "Scholar", "Guide", "Torchbearer"][level - 1]}` })).toBeInTheDocument();
      unmount();
    }
  });
  it("clamps out-of-range levels", () => {
    render(<LevelCrest level={99} />);
    expect(screen.getByRole("img", { name: /Level 8/ })).toBeInTheDocument();
  });
});

describe("XPBar", () => {
  it("always captions the next level and the XP remaining", () => {
    render(<XPBar xp={{ total: 845, xpIntoLevel: 45, xpForNext: 55, nextLevelName: "Keeper" }} />);
    expect(screen.getByText(/845 XP/)).toBeInTheDocument();
    expect(screen.getByText(/55 XP to Keeper/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "45");
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "100");
  });
  it("tints the final stretch before a level-up", () => {
    const { container } = render(<XPBar xp={{ xpIntoLevel: 90, xpForNext: 10, nextLevelName: "Keeper" }} />);
    expect(container.querySelector(".game-xp-bar")).toHaveClass("is-final-stretch");
  });
  it("names the top level instead of a next level at level 8", () => {
    render(<XPBar xp={{ total: 5000, xpIntoLevel: 400, xpForNext: 0, nextLevelName: null, levelName: "Torchbearer" }} />);
    expect(screen.getByText(/Top level reached — Torchbearer/)).toBeInTheDocument();
  });
});

describe("ChaseBar", () => {
  it("scales to the target and clamps overflow", () => {
    render(<ChaseBar value={150} max={100} caption="gap" ariaLabel="chase" />);
    const bar = screen.getByRole("progressbar", { name: "chase" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
  it("fills exactly value/max of the track (one yardstick, no per-bar rescaling)", () => {
    const { container } = render(<ChaseBar value={650} max={845} ariaLabel="chase" />);
    const bar = screen.getByRole("progressbar", { name: "chase" });
    expect(bar).toHaveAttribute("aria-valuenow", "650");
    expect(bar).toHaveAttribute("aria-valuemax", "845");
    const fill = container.querySelector<HTMLElement>(".game-chase-bar__track > span");
    expect(parseFloat(fill!.style.width)).toBeCloseTo((650 / 845) * 100, 3);
  });
});

describe("PlayerCard", () => {
  it("carries identity, level text (no crest), captioned XPBar and chip states", () => {
    const { container } = render(<PlayerCard name="Sam Rivera" xp={{ total: 612, xpIntoLevel: 112, xpForNext: 288, nextLevelName: "Scribe", level: 4, levelName: "Keeper" }} streak={6} streakState="active" seasonLabel="Daniel" />);
    expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
    expect(screen.getByText("Level 4 · Keeper")).toBeInTheDocument();
    // The level is spelled out in text, so the card carries no crest.
    expect(container.querySelector(".game-level-crest")).toBeNull();
    expect(screen.getByText(/288 XP to Scribe/)).toBeInTheDocument();
    expect(screen.getByText("6-day streak")).toBeInTheDocument();
    expect(screen.getByText("Daniel")).toBeInTheDocument();
  });
  it("turns the streak chip into the paused nudge", () => {
    render(<PlayerCard name="Sam Rivera" streak={3} streakState="paused" />);
    expect(screen.getByText("Streak paused — practice today to restart")).toBeInTheDocument();
  });
});

describe("QuestCard", () => {
  const quest: QuestDto = { key: "warmup", title: "Warm-up", description: "Answer 3 cards", target: 3, progress: 1, completed: false, xpReward: 25 };
  it("shows reward, pips and progress for an open quest", () => {
    render(<ul><QuestCard quest={quest} /></ul>);
    expect(screen.getByText("+25 XP")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Warm-up: 1 of 3 done" })).toBeInTheDocument();
  });
  it("shows the done state without progress text", () => {
    render(<ul><QuestCard quest={{ ...quest, progress: 3, completed: true }} /></ul>);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByText("3 of 3 done")).not.toBeInTheDocument();
  });
});

describe("StatTile", () => {
  it("renders label, value and context", () => {
    render(<dl><StatTile label="Attempts" value={42} context="this season" /></dl>);
    expect(screen.getByText("Attempts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("this season")).toBeInTheDocument();
  });
});

describe("PatchDisplay", () => {
  it("treats an earned patch with its date", () => {
    render(<PatchDisplay title="Exact Recall" artwork={<span>art</span>} earnedAtUtc="2026-09-11T12:00:00Z" requirement="Reach 90 on 12 passages" />);
    expect(screen.getAllByText("Earned").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sep 11, 2026/).length).toBeGreaterThan(0);
  });
  it("treats a locked patch as muted with requirement and progress", () => {
    const { container } = render(<PatchDisplay title="Full Coverage" artwork={<span>art</span>} requirement="Master all 30 passages" completed={5} target={7} />);
    expect(container.querySelector(".game-patch-display")).toHaveClass("is-locked");
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("5 of 7")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Full Coverage progress" })).toHaveAttribute("value", "5");
  });
  it("teaser names the next patch and its progress", () => {
    render(<PatchDisplay variant="teaser" title="Steady Study" artwork={<span>art</span>} requirement="Daniel assigned scope" completed={2} target={5} />);
    expect(screen.getByText("Next Achievement patch")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Steady Study" })).toBeInTheDocument();
    expect(screen.getByText("2 of 5")).toBeInTheDocument();
  });
});

describe("MomentCard", () => {
  it("big moments carry a tally receipt", () => {
    render(<MomentCard level="big" title="Level up!" tally={[{ label: "XP earned", value: "+85" }, { label: "Correct answers", value: 7 }]} />);
    const card = screen.getByTestId("moment-card-big");
    expect(card).toHaveTextContent("Level up!");
    expect(card).toHaveTextContent("+85");
    expect(card).toHaveTextContent("Correct answers");
  });
  it("line moments are a single status line", () => {
    render(<MomentCard level="line" title="New personal best!" description="Best accuracy yet." />);
    expect(screen.getByTestId("moment-line")).toHaveTextContent("New personal best!");
    expect(screen.queryByTestId("moment-card-big")).not.toBeInTheDocument();
  });
  it("silent moments are tally only", () => {
    render(<MomentCard level="silent" title="Practice complete" tally={[{ label: "XP earned", value: "+40" }]} />);
    expect(screen.getByTestId("moment-card-silent")).toHaveTextContent("+40");
    expect(screen.queryByTestId("moment-card-big")).not.toBeInTheDocument();
  });
});

describe("Podium", () => {
  const entries = [
    { userId: "a", displayName: "Ada L.", xp: 500, level: 4, levelName: "Keeper", streak: 5 },
    { userId: "b", displayName: "Grace H.", xp: 400, level: 3, levelName: "Reader", streak: 0 },
    { userId: "c", displayName: "Katherine J.", xp: 300, level: 3, levelName: "Reader", streak: 0 },
  ];
  it("raises the winner in the center with 2nd and 3rd beside", () => {
    render(<Podium entries={entries} modeLabel="Season" isMe={entry => entry.userId === "b"} />);
    const podium = screen.getByTestId("leaderboard-podium");
    const items = [...podium.querySelectorAll("li")];
    expect(items.map(item => item.getAttribute("data-testid"))).toEqual(["leaderboard-podium-2", "leaderboard-podium-1", "leaderboard-podium-3"]);
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("Ada L.");
    expect(items[0]).toHaveClass("is-me");
  });

  it("the podium face is the student's profile image, not the level crest (regression: number circle on top)", () => {
    const withAvatars: PodiumEntry[] = entries.map((entry, index) => ({
      ...entry,
      avatar: index === 0
        ? { avatarKind: "character" as const, avatarHonorKey: null, character: { bodyType: "female" as const, style: "braids" as const, hairColor: "black" as const, skin: "deep" as const, eyes: "hazel" as const } }
        : index === 1
          ? { avatarKind: "honor" as const, avatarHonorKey: "solo:exact-recall", character: null }
          : { avatarKind: "initials" as const, avatarHonorKey: null, character: null },
    }));
    render(<Podium entries={withAvatars} modeLabel="Season" />);
    for (const rank of [1, 2, 3]) {
      const face = screen.getByTestId(`leaderboard-podium-${rank}`).querySelector(".game-podium__face");
      expect(face).not.toBeNull();
      // The face's primary content is the entry avatar at hero size for 1st, card size for 2nd/3rd.
      const avatar = face?.querySelector("[data-entry-avatar]");
      expect(avatar).not.toBeNull();
      const sizeClass = rank === 1 ? "--moment" : "--card";
      const disc = face?.querySelector(".game-entry-avatar, .game-initials-disc");
      expect([...(disc?.classList ?? [])].some(name => name.endsWith(sizeClass))).toBe(true);
      // No level-crest badge on the podium: the face stands alone (level crests live on the board rows).
      expect(face?.querySelector(".game-level-crest")).toBeNull();
      expect(face?.querySelector(".game-podium__crest")).toBeNull();
    }
    expect(screen.getByTestId("leaderboard-podium-1").querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "character");
    expect(screen.getByTestId("leaderboard-podium-2").querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "honor");
    expect(screen.getByTestId("leaderboard-podium-3").querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "initials");
  });

  it("podium blocks carry face, name, XP and the big rank numeral only — streak and race bar live on the rows", () => {
    // Sam (3rd) holds a 6-day streak and Jonah (2nd) none: neither may leak onto
    // the podium, and no content may change the block structure by rank.
    const ranked = [
      { userId: "maya", displayName: "Maya R.", xp: 845 },
      { userId: "jonah", displayName: "Jonah K.", xp: 650 },
      { userId: "sam", displayName: "Sam R.", xp: 612 },
    ];
    render(<Podium entries={ranked} modeLabel="Season" />);
    for (const [index, entry] of ranked.entries()) {
      const rank = index + 1;
      const item = screen.getByTestId(`leaderboard-podium-${rank}`);
      const block = item.querySelector(".game-podium__block");
      expect(block).not.toBeNull();
      expect(block).toHaveTextContent(entry.displayName);
      expect(block).toHaveTextContent(`${entry.xp} XP`);
      expect(item.querySelector(".game-podium__numeral")).toHaveTextContent(String(rank));
      expect(item.querySelector(".game-chase-bar")).toBeNull();
      expect(item.querySelector(".game-podium__streak")).toBeNull();
      expect(item.querySelector(".game-podium__plinth")).toBeNull();
      expect(item.querySelector(".game-podium__rank")).toBeNull();
    }
  });

  it("pins the Kahoot block geometry in CSS: fixed block heights stepping by rank, content never drives them", () => {
    const heightOf = (selector: string) => {
      const match = gameLayerCss.match(new RegExp(`\\${selector} \\{[^}]*\\}`));
      const height = match?.[0].match(/height: (\d+)px/);
      return height ? Number(height[1]) : 0;
    };
    const first = heightOf(".game-podium__item.is-rank-1 .game-podium__block");
    const second = heightOf(".game-podium__block");
    const third = heightOf(".game-podium__item.is-rank-3 .game-podium__block");
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(third);
    expect(first - second).toBeGreaterThanOrEqual(16);
    expect(second - third).toBeGreaterThanOrEqual(16);
    // Ghost spots share the winner block geometry: the ghost override sets
    // no height of its own, so a partial podium steps exactly like a full one.
    const ghostRule = gameLayerCss.match(/\.game-podium__item\.is-ghost \.game-podium__block--ghost \{[^}]*\}/)?.[0] ?? "";
    expect(ghostRule).not.toContain("height:");
    // The empty board's dashed wireframe plinths are gone for good.
    expect(gameLayerCss).not.toContain(".season-board-zero-plinth");
    expect(gameLayerCss).not.toMatch(/border: \dpx dashed/);
  });

  it("fills unclaimed spots with soft ghost spots when fillGhosts is set (partial boards)", () => {
    const one = [{ userId: "a", displayName: "Ada L.", xp: 500 }];
    const { unmount } = render(<Podium entries={one} modeLabel="Season" fillGhosts />);
    const podium = screen.getByTestId("leaderboard-podium");
    const items = [...podium.querySelectorAll("li")];
    // Display order centers the winner: ghost 2nd, winner 1st, ghost 3rd.
    expect(items.map(item => item.getAttribute("data-testid"))).toEqual(["leaderboard-podium-ghost-2", "leaderboard-podium-1", "leaderboard-podium-ghost-3"]);
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("Ada L.");
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("500 XP");
    for (const rank of [2, 3]) {
      const ghost = screen.getByTestId(`leaderboard-podium-ghost-${rank}`);
      expect(ghost).toHaveTextContent("Open spot");
      expect(ghost).toHaveTextContent(String(rank));
      // No fake winner: no name plate, no XP, no avatar, no "?" placeholder.
      expect(ghost.querySelector(".game-podium__block")).toHaveClass("game-podium__block--ghost");
      expect(ghost.querySelector(".game-podium__xp")).toBeNull();
      expect(ghost.querySelector("[data-entry-avatar]")).toBeNull();
      expect(ghost).not.toHaveTextContent("?");
      expect(screen.queryByTestId(`leaderboard-podium-${rank}`)).not.toBeInTheDocument();
    }
    unmount();

    const two = [one[0], { userId: "b", displayName: "Grace H.", xp: 400 }];
    render(<Podium entries={two} modeLabel="Season" fillGhosts />);
    const items2 = [...screen.getByTestId("leaderboard-podium").querySelectorAll("li")];
    expect(items2.map(item => item.getAttribute("data-testid"))).toEqual(["leaderboard-podium-2", "leaderboard-podium-1", "leaderboard-podium-ghost-3"]);
    expect(screen.getByTestId("leaderboard-podium-2")).toHaveTextContent("Grace H.");
  });

  it("renders no ghost spots without fillGhosts (single-entry podium stays a single item)", () => {
    render(<Podium entries={[{ userId: "a", displayName: "Ada L.", xp: 500 }]} modeLabel="Season" />);
    const items = [...screen.getByTestId("leaderboard-podium").querySelectorAll("li")];
    expect(items.map(item => item.getAttribute("data-testid"))).toEqual(["leaderboard-podium-1"]);
    expect(screen.queryByTestId("leaderboard-podium-ghost-2")).not.toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("derives initials and next level names", () => {
    expect(initialsFor("Sam Rivera")).toBe("SR");
    expect(initialsFor("  ")).toBe("?");
    expect(nextLevelName(4)).toBe("Scribe");
    expect(nextLevelName(8)).toBeNull();
  });
});

describe("circle fidelity (regression: discs and crests stretched into ellipses)", () => {
  const rule = (selector: string) => {
    const match = gameLayerCss.match(new RegExp(`\\${selector} \\{[^}]*\\}`));
    return match?.[0] ?? "";
  };
  it("pins square sizing on every circular game-layer element", () => {
    for (const selector of [".game-level-crest", ".game-initials-disc", ".game-entry-avatar", ".game-podium__ghost-ring"]) {
      expect(rule(selector), selector).toContain("aspect-ratio: 1");
      expect(rule(selector), selector).toContain("flex: none");
      expect(rule(selector), selector).toContain("border-radius: 50%");
    }
  });
  it("never flexes every span in the starting-line row (the ellipse root cause)", () => {
    expect(gameLayerCss).not.toContain(".season-board-zero-line li span");
    expect(rule(".season-board-zero-line__who")).toContain("flex: 1");
  });
  it("keeps quest pips at their fixed ratio under flex stretch", () => {
    expect(rule(".game-quest-card__pips span")).toContain("flex: none");
  });
});

describe("EntryAvatar", () => {
  it("renders the initials disc when no profile image is set", () => {
    const { container } = render(<EntryAvatar name="Eve V." avatar={{ avatarKind: "initials", avatarHonorKey: null, character: null }} />);
    expect(container.querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "initials");
    expect(container.querySelector(".game-initials-disc")).toHaveTextContent("EV");
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
  it("renders the selected character portrait when the student set one", async () => {
    const { container } = render(<EntryAvatar name="Eve V." avatar={{ avatarKind: "character", avatarHonorKey: null, character: { bodyType: "female", style: "Explorer", hairColor: "brown", skin: "medium", eyes: "brown" } }} />);
    await vi.waitFor(() => expect(container.querySelector("img[data-character-portrait]")).toBeInTheDocument());
    expect(container.querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "character");
    expect(container.querySelector(".game-entry-avatar")).toBeInTheDocument();
    expect(container.querySelector(".game-initials-disc")).not.toBeInTheDocument();
  });
  it("renders the chosen Achievement patch artwork for honor avatars", () => {
    const { container } = render(<EntryAvatar name="Eve V." avatar={{ avatarKind: "honor", avatarHonorKey: "solo:exact-recall", character: null }} />);
    expect(container.querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "honor");
    expect(container.querySelector("img")).toBeInTheDocument();
  });
  it("falls back to initials for an honor avatar without artwork", () => {
    const { container } = render(<EntryAvatar name="Eve V." avatar={{ avatarKind: "honor", avatarHonorKey: "solo:not-a-patch", character: null }} />);
    expect(container.querySelector("[data-entry-avatar]")).toHaveAttribute("data-entry-avatar", "initials");
  });
});

describe("PlayerCard avatar slot", () => {
  it("renders no avatar element when avatar is null (character appears once per screen)", () => {
    const { container } = render(<PlayerCard name="Sam Rivera" avatar={null} xp={{ total: 612, xpIntoLevel: 112, xpForNext: 288, nextLevelName: "Scribe", level: 4, levelName: "Keeper" }} />);
    expect(container.querySelector(".game-player-card__avatar")).not.toBeInTheDocument();
    // The level rides as text under the name — no crest image carries it.
    expect(screen.getByText("Level 4 · Keeper")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Level 4/ })).not.toBeInTheDocument();
  });
  it("falls back to the initials disc when no avatar is passed", () => {
    const { container } = render(<PlayerCard name="Sam Rivera" />);
    expect(container.querySelector(".game-player-card__avatar .game-initials-disc")).toHaveTextContent("SR");
  });
});

describe("level wording consistency (guard)", () => {
  // Canonical level wording (Nov 23 audit): identity is "Level N · <Name>",
  // progress names the next level ("… XP to <NextName>", bar label
  // "Progress to the next level", top state "Top level reached — <Name>"),
  // and the level-up announcement is "Level up!". "Rank" means board
  // position only. This scan fails if a non-canonical level format is
  // introduced in any shipped source file (client or worker, tests
  // excluded — fixtures may quote the old strings to assert their absence).
  const forbidden: [RegExp, string][] = [
    [/Rank \{/, "JSX 'Rank {level}' — the tier is worded 'Level {level} · {levelName}'"],
    [/Rank \$\{/, "template 'Rank ${level}' — the tier is worded 'Level ${level} · ${levelName}'"],
    [/Rank up!/, "'Rank up!' — the announcement is 'Level up!'"],
    [/next rank/i, "'next rank' — say 'next level' (or name it: 'XP to <NextName>')"],
    [/Top rank/, "'Top rank reached' — the top state is 'Top level reached — <Name>'"],
    [/\bLvl\b/, "'Lvl' — always spell out 'Level'"],
  ];
  const sourceFiles: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) sourceFiles.push(path);
    }
  };
  walk(`${cwd}/src`);
  walk(`${cwd}/worker`);
  it("scans a real source tree", () => {
    expect(sourceFiles.length).toBeGreaterThan(100);
  });
  it("no shipped source words a learner's level non-canonically", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      for (const [pattern, rule] of forbidden) {
        if (pattern.test(text)) offenders.push(`${file.replace(`${cwd}/`, "")}: ${rule}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
