import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChaseBar, LevelCrest, MomentCard, PatchDisplay, PlayerCard, Podium, QuestCard, StatTile, XPBar, initialsFor, nextLevelName } from "./GameLayer";
import type { QuestDto } from "../../api/trainingTypes";

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
});

describe("PlayerCard", () => {
  it("carries identity, crest, captioned XPBar and chip states", () => {
    render(<PlayerCard name="Sam Rivera" xp={{ total: 612, xpIntoLevel: 112, xpForNext: 288, nextLevelName: "Scribe", level: 4, levelName: "Keeper" }} streak={6} streakState="active" seasonLabel="Daniel" />);
    expect(screen.getByText("Sam Rivera")).toBeInTheDocument();
    expect(screen.getByText("Level 4 · Keeper")).toBeInTheDocument();
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
    render(<MomentCard level="big" title="Rank up!" tally={[{ label: "XP earned", value: "+85" }, { label: "Correct answers", value: 7 }]} />);
    const card = screen.getByTestId("moment-card-big");
    expect(card).toHaveTextContent("Rank up!");
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
    render(<Podium entries={entries} leaderXp={500} modeLabel="Season" isMe={entry => entry.userId === "b"} />);
    const podium = screen.getByTestId("leaderboard-podium");
    const items = [...podium.querySelectorAll("li")];
    expect(items.map(item => item.getAttribute("data-testid"))).toEqual(["leaderboard-podium-2", "leaderboard-podium-1", "leaderboard-podium-3"]);
    expect(screen.getByTestId("leaderboard-podium-1")).toHaveTextContent("Ada L.");
    expect(items[0]).toHaveClass("is-me");
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
