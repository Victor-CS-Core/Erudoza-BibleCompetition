import { useMemo, useState } from "react";
import { Badge, HelpTip, Input } from "../../components/ui";
import type { Progress } from "../../api/types";

type MasteryItem = Progress["mastery"][number];

type Filter = "all" | "practice" | "due" | "mastered";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "practice", label: "Needs practice" },
  { key: "due", label: "Due" },
  { key: "mastered", label: "Mastered" },
];

const MASTERED_LEVELS = new Set(["Mastered", "Strong"]);

function isDue(item: MasteryItem, now: number): boolean {
  if (item.level === "Review") return true;
  if (item.reviewDueAtUtc && Date.parse(item.reviewDueAtUtc) <= now) return true;
  return false;
}

function bookOf(item: MasteryItem): string {
  if (item.bookKey) return item.bookKey;
  // Fall back to parsing the leading book name from titles like "Genesis 1:2" or "1 Samuel 3:1".
  const match = /^(\d?\s?[A-Za-z]+)/.exec(item.title);
  return match ? match[1].trim() : "Other";
}

function matchesFilter(item: MasteryItem, filter: Filter, now: number): boolean {
  switch (filter) {
    case "practice": return !MASTERED_LEVELS.has(item.level);
    case "due": return isDue(item, now);
    case "mastered": return MASTERED_LEVELS.has(item.level);
    case "all": return true;
  }
}

export function PassageBrowser({ mastery, difficulty }: { mastery: MasteryItem[]; difficulty?: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const now = useMemo(() => Date.now(), []);

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = mastery.filter(item => matchesFilter(item, filter, now) && (!normalized || item.title.toLowerCase().includes(normalized)));
    const byBook = new Map<string, MasteryItem[]>();
    for (const item of filtered) {
      const book = bookOf(item);
      const list = byBook.get(book);
      if (list) list.push(item); else byBook.set(book, [item]);
    }
    return [...byBook.entries()].map(([book, items]) => ({
      book,
      items,
      mastered: items.filter(item => MASTERED_LEVELS.has(item.level)).length,
    }));
  }, [mastery, query, filter, now]);

  const totalMastered = mastery.filter(item => MASTERED_LEVELS.has(item.level)).length;

  return (
    <div className="passage-browser" data-testid="progress-mastery">
      <div className="training-panel-title">
        <div>
          <h2>Passage progress</h2>
          <p>See which passages need practice and which are mastered.</p>
        </div>
        <HelpTip label="About passage scoring">
          Coach-set difficulty: {difficulty ?? "Not available"}. Foundation wording evidence stops at 40, Standard at 70. Memory warmups stop at 70 within those ceilings; Verse Builder records sequence practice. Advanced mastery challenges require coach-set Advanced difficulty. Your difficulty does not change automatically. Honors also require their listed passage, skill and delayed-recall evidence. PBE questions use their authored answer requirements at every Memory difficulty.
        </HelpTip>
      </div>
      {mastery.length > 0 && (
        <p className="passage-browser-summary">{totalMastered} of {mastery.length} mastered</p>
      )}
      <div className="passage-browser-controls">
        <Input
          type="search"
          aria-label="Search passages"
          placeholder="Search passages"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="passage-browser-filters" role="group" aria-label="Filter passages">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`passage-filter-chip${filter === key ? " is-active" : ""}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {groups.length === 0 ? (
        <p>{mastery.length === 0 ? "No passage progress yet. Complete a study activity to begin recording progress." : "No passages match this filter."}</p>
      ) : (
        <div className="passage-book-groups">
          {groups.map(group => (
            <details key={group.book} className="passage-book-group" open={groups.length <= 3}>
              <summary>
                <span className="passage-book-name">{group.book}</span>
                <span className="passage-book-count">{group.mastered} of {group.items.length} mastered</span>
                <span className="passage-book-bar" aria-hidden="true">
                  <span style={{ width: `${group.items.length ? Math.round((group.mastered / group.items.length) * 100) : 0}%` }} />
                </span>
              </summary>
              <ul className="training-list passage-compact-rows">
                {group.items.map(item => (
                  <li key={item.knowledgeUnitId}>
                    <span className="passage-row-title">{item.title}</span>
                    <span className="passage-row-bar" aria-hidden="true" title={`Exact wording score: ${item.exactWordingScore} / 100`}>
                      <span style={{ width: `${Math.max(0, Math.min(100, item.exactWordingScore))}%` }} />
                    </span>
                    <span className="passage-row-score">{item.exactWordingScore}</span>
                    <Badge tone={MASTERED_LEVELS.has(item.level) ? "success" : item.level === "Review" ? "warning" : "neutral"}>{item.level}</Badge>
                    {(item.algorithmVersion ?? "v1-scaffold") !== "v2-skill-evidence" && <span className="passage-row-legacy">Legacy scoring</span>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
