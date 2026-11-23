import { lazy, Suspense, type ReactNode } from "react";
import { AppIcon } from "../AppIcon";
import { Badge, Panel } from "../ui";
import { HonorPatchCard } from "../../features/profile/HonorPatchCard";
import { MasteryHonorArtwork, isHonorArtwork } from "../../features/profile/MasteryHonorArtwork";
import { CelebrationBurst } from "../../features/student/CelebrationBurst";
import type { QuestDto } from "../../api/trainingTypes";
import type { BoardAvatar } from "../../api/types";
import "./game-layer.css";

const CharacterPortrait = lazy(() => import("../../features/profile/character/CharacterPreview").then(module => ({ default: module.CharacterPortrait })));

export const LEVEL_NAMES = ["Seedling", "Seeker", "Reader", "Keeper", "Scribe", "Scholar", "Guide", "Torchbearer"] as const;

export function nextLevelName(level: number): string | null {
  return LEVEL_NAMES[level] ?? null;
}

export function initialsFor(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join("").toLocaleUpperCase() || "?";
}

export function InitialsDisc({ name, size = "row", className = "" }: { name: string; size?: "row" | "card" | "moment"; className?: string }) {
  return <span className={`game-initials-disc game-initials-disc--${size} ${className}`} aria-hidden="true">{initialsFor(name)}</span>;
}

/**
 * A board member's selected profile image in the disc slot: their character
 * portrait (the profile's static, appearance-cached render — no animation
 * loop, so a full board stays cheap) or their Achievement patch artwork when
 * that is the chosen avatar. Falls back to the initials disc when the student
 * chose initials, set nothing, or the portrait cannot render.
 */
export function EntryAvatar({ avatar, name, size = "row", className = "" }: { avatar?: BoardAvatar | null; name: string; size?: "row" | "card" | "moment"; className?: string }) {
  const px = size === "moment" ? 72 : size === "card" ? 44 : 28;
  const fallback = <InitialsDisc name={name} size={size} />;
  if (avatar?.avatarKind === "character" && avatar.character) {
    return <span className={`game-entry-avatar game-entry-avatar--${size} ${className}`} aria-hidden="true" data-entry-avatar="character">
      <Suspense fallback={fallback}><CharacterPortrait appearance={avatar.character} fallback={fallback} /></Suspense>
    </span>;
  }
  if (avatar?.avatarKind === "honor" && avatar.avatarHonorKey && isHonorArtwork(avatar.avatarHonorKey)) {
    return <span className={`game-entry-avatar game-entry-avatar--${size} ${className}`} aria-hidden="true" data-entry-avatar="honor">
      <MasteryHonorArtwork honorKey={avatar.avatarHonorKey} size={px} />
    </span>;
  }
  return <span className={className} data-entry-avatar="initials">{fallback}</span>;
}

type CrestSize = "row" | "card" | "moment";
export function LevelCrest({ level, levelName, size = "row", className = "" }: { level: number; levelName?: string; size?: CrestSize; className?: string }) {
  const safeLevel = Math.min(8, Math.max(1, Math.floor(level) || 1));
  const tier = safeLevel <= 2 ? "kraft" : safeLevel <= 4 ? "teal" : safeLevel <= 6 ? "blue" : safeLevel === 7 ? "gold" : "gold-flame";
  const name = levelName ?? LEVEL_NAMES[safeLevel - 1];
  return <span className={`game-level-crest game-level-crest--${size} game-level-crest--${tier} ${className}`} role="img" aria-label={`Level ${safeLevel} · ${name}`} title={`Level ${safeLevel} · ${name}`}>
    <span className="game-level-crest__number">{safeLevel}</span>
    {safeLevel === 8 && <AppIcon name="flame" />}
  </span>;
}

export type XpProgress = {
  total?: number;
  xpIntoLevel: number;
  xpForNext: number;
  nextLevelName?: string | null;
  levelName?: string;
};

export function XPBar({ xp, label = "Experience progress", className = "" }: { xp: XpProgress; label?: string; className?: string }) {
  const into = Math.max(0, xp.xpIntoLevel);
  const remaining = Math.max(0, xp.xpForNext);
  const span = into + remaining;
  const percent = span > 0 ? Math.min(100, Math.max(0, (into / span) * 100)) : 100;
  const nextName = xp.nextLevelName ?? null;
  return <div className={`game-xp-bar ${percent >= 85 && remaining > 0 ? "is-final-stretch" : ""} ${className}`}>
    <div className="game-xp-bar__caption">
      <span>{xp.total !== undefined ? <><strong>{xp.total} XP</strong><span aria-hidden="true"> · </span></> : null}{remaining > 0 && nextName ? `${remaining} XP to ${nextName}` : `Top level reached${xp.levelName ? ` — ${xp.levelName}` : ""}`}</span>
      <span>{into} / {span} XP in this level</span>
    </div>
    <progress className="game-xp-bar__track" aria-label={label} value={into} max={span || 1} />
  </div>;
}

export function ChaseBar({ value, max, caption, ariaLabel, className = "" }: { value: number; max: number; caption?: ReactNode; ariaLabel: string; className?: string }) {
  const safeMax = Math.max(0, max);
  const safeValue = Math.min(safeMax, Math.max(0, value));
  const percent = safeMax > 0 ? (safeValue / safeMax) * 100 : 0;
  return <div className={`game-chase-bar ${className}`}>
    <div className="game-chase-bar__track" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={safeMax || 1} aria-valuenow={safeValue}>
      <span style={{ width: `${percent}%` }} />
    </div>
    {caption && <p className="game-chase-bar__caption">{caption}</p>}
  </div>;
}

export type PlayerCardXp = XpProgress & { level: number; levelName: string };

export function PlayerCard({
  name,
  avatar,
  xp,
  streak,
  streakState,
  seasonLabel,
  formatLabel,
  title,
  titleId,
  description,
  background,
  children,
  className = "",
  testId,
}: {
  name: string;
  avatar?: ReactNode;
  xp?: PlayerCardXp | null;
  streak?: number;
  streakState?: "active" | "paused" | "none";
  seasonLabel?: ReactNode;
  formatLabel?: ReactNode;
  title?: ReactNode;
  titleId?: string;
  description?: ReactNode;
  background?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const streakText = streak === undefined ? null : streakState === "paused"
    ? "Streak paused — practice today to restart"
    : streakState === "none" || streak === 0
      ? "Start your streak today"
      : `${streak}-day streak`;
  const content = <>
    {background}
    <div className="game-player-card__content">
      {title ? <h1 id={titleId} className="game-player-card__title">{title}</h1> : null}
      {description ? <p className="game-player-card__description">{description}</p> : null}
      <div className="game-player-card__identity">
        {avatar !== null && <span className="game-player-card__avatar">{avatar ?? <InitialsDisc name={name} size="card" />}</span>}
        <div className="game-player-card__who">
          <strong>{name}</strong>
          {xp && <span>Level {xp.level} · {xp.levelName}</span>}
        </div>
        {xp && <LevelCrest level={xp.level} levelName={xp.levelName} size="card" />}
      </div>
      {(streakText || seasonLabel || formatLabel) && <div className="game-player-card__chips">
        {streakText && <span className={`game-player-chip ${streakState === "paused" ? "is-urgent" : ""}`}><AppIcon name="flame" />{streakText}</span>}
        {seasonLabel && <span className="game-player-chip">{seasonLabel}</span>}
        {formatLabel && <span className="game-player-chip">{formatLabel}</span>}
      </div>}
      {xp && <XPBar xp={xp} label="Progress to the next rank" />}
      {children}
    </div>
  </>;
  if (background) return <section className={`game-player-card game-player-card--banner ${className}`} data-testid={testId}>{content}</section>;
  return <Panel className={`game-player-card ${className}`} data-testid={testId}>{content}</Panel>;
}

export function QuestCard({ quest }: { quest: QuestDto }) {
  const reward = quest.xpReward ?? 25;
  return <li className={`game-quest-card ${quest.completed ? "is-complete" : ""}`} data-testid={`quest-card-${quest.key}`}>
    <div className="game-quest-card__head">
      <strong>{quest.title}</strong>
      <span className="game-quest-card__reward">+{reward} XP</span>
    </div>
    <p>{quest.description}</p>
    {quest.completed
      ? <p className="game-quest-card__status is-done"><AppIcon name="check" /> Completed</p>
      : <>
        <div className="game-quest-card__pips" role="img" aria-label={`${quest.title}: ${quest.progress} of ${quest.target} done`}>
          {Array.from({ length: Math.max(1, quest.target) }, (_, index) => <span key={index} className={index < quest.progress ? "is-done" : ""} />)}
        </div>
        <p className="game-quest-card__status">{quest.progress} of {quest.target} done</p>
      </>}
  </li>;
}

export function StatTile({ label, value, context, testId }: { label: ReactNode; value: ReactNode; context?: ReactNode; testId?: string }) {
  return <div className="game-stat-tile" data-testid={testId}>
    <dt>{label}</dt>
    <dd className="game-stat-tile__value">{value}</dd>
    {context && <dd className="game-stat-tile__context">{context}</dd>}
  </div>;
}

function formatGameDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function PatchDisplay({
  title,
  artwork,
  earnedAtUtc,
  requirement,
  completed,
  target,
  detail,
  status,
  variant = "card",
  className = "",
  testId,
}: {
  title: string;
  artwork: ReactNode;
  earnedAtUtc?: string | null;
  requirement?: ReactNode;
  completed?: number;
  target?: number;
  detail?: ReactNode | ((close: () => void) => ReactNode);
  status?: ReactNode;
  variant?: "card" | "teaser";
  className?: string;
  testId?: string;
}) {
  const earned = !!earnedAtUtc;
  const hasProgress = !earned && completed !== undefined && target !== undefined && target > 0;
  const progress = hasProgress ? <div className="game-patch-display__progress"><progress aria-label={`${title} progress`} value={Math.min(target, Math.max(0, completed))} max={target} /><span>{completed} of {target}</span></div> : null;
  if (variant === "teaser") {
    return <article className={`game-patch-display game-patch-display--teaser ${earned ? "is-earned" : "is-locked"} ${className}`} data-testid={testId ?? "patch-display"}>
      <span className="game-patch-display__art">{artwork}</span>
      <div className="game-patch-display__copy">
        <p className="game-patch-display__eyebrow">{earned ? "Achievement patch earned" : "Next Achievement patch"}</p>
        <h3>{title}</h3>
        {earned ? <p>Earned <time dateTime={earnedAtUtc!}>{formatGameDate(earnedAtUtc!)}</time></p> : requirement ? <p>{requirement}</p> : null}
        {progress}
        {status}
      </div>
    </article>;
  }
  const composedStatus = status ?? <>
    <Badge tone={earned ? "success" : "neutral"}>{earned ? "Earned" : "Locked"}</Badge>
    {earned ? <span>Earned <time dateTime={earnedAtUtc!}>{formatGameDate(earnedAtUtc!)}</time></span> : hasProgress ? <span>{completed} / {target}</span> : null}
    {progress}
    {!earned && requirement ? <span className="game-patch-display__requirement">{requirement}</span> : null}
  </>;
  return <div className={`game-patch-display ${earned ? "is-earned" : "is-locked"} ${className}`} data-testid={testId ?? "patch-display"}>
    <HonorPatchCard title={title} artwork={artwork} status={composedStatus} detail={detail ?? <>{artwork}<h3>{earned ? "Earned" : "How to unlock"}</h3>{requirement && <p>{requirement}</p>}{earned ? <p>Earned <time dateTime={earnedAtUtc!}>{formatGameDate(earnedAtUtc!)}</time>.</p> : progress}</>} />
  </div>;
}

export type MomentLevel = "big" | "line" | "silent";

export function MomentCard({
  level,
  title,
  description,
  artwork,
  tally,
  children,
  action,
  className = "",
  testId,
}: {
  level: MomentLevel;
  title: ReactNode;
  description?: ReactNode;
  artwork?: ReactNode;
  tally?: { label: ReactNode; value: ReactNode }[];
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  if (level === "line") {
    return <p className={`game-moment-line ${className}`} role="status" data-testid={testId ?? "moment-line"}><AppIcon name="flag" /><span><strong>{title}</strong>{description ? <> {description}</> : null}{children}</span></p>;
  }
  const isBig = level === "big";
  return <Panel className={`game-moment-card ${isBig ? "is-big" : "is-silent"} ${className}`} data-testid={testId ?? (isBig ? "moment-card-big" : "moment-card-silent")}>
    {isBig && <CelebrationBurst celebrate />}
    {artwork && <div className="game-moment-card__art">{artwork}</div>}
    <div className="game-moment-card__copy">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
      {tally && tally.length > 0 && <dl className="game-moment-card__tally" aria-label="Session XP tally">
        {tally.map((item, index) => <div key={index}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>}
      {action && <div className="game-moment-card__action">{action}</div>}
    </div>
  </Panel>;
}

export type PodiumEntry = {
  userId: string;
  displayName: string;
  xp: number;
  level: number;
  levelName: string;
  streak: number;
  sublabel?: ReactNode;
  avatar?: BoardAvatar | null;
};

export function Podium({ entries, leaderXp, isMe, modeLabel }: { entries: PodiumEntry[]; leaderXp: number; isMe?: (entry: PodiumEntry) => boolean; modeLabel: string }) {
  const top = entries.slice(0, 3);
  if (!top.length) return null;
  const display = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return <ol className="game-podium" aria-label={`Top ${top.length} · ${modeLabel}`} data-testid="leaderboard-podium">
    {display.map(entry => {
      const rank = top.indexOf(entry) + 1;
      return <li key={entry.userId} className={`game-podium__item is-rank-${rank} ${isMe?.(entry) ? "is-me" : ""}`} data-testid={`leaderboard-podium-${rank}`}>
        <span className="game-podium__face">
          <EntryAvatar avatar={entry.avatar} name={entry.displayName} size={rank === 1 ? "moment" : "card"} />
          <LevelCrest level={entry.level} levelName={entry.levelName} size="row" className="game-podium__crest" />
        </span>
        <strong>{entry.displayName}</strong>
        <span className="game-podium__rank">#{rank}</span>
        <span className="game-podium__xp">{entry.xp} XP</span>
        {entry.streak >= 3 && <span className="game-podium__streak"><AppIcon name="flame" />{entry.streak}</span>}
        {entry.sublabel && <span className="game-podium__sub">{entry.sublabel}</span>}
        <ChaseBar value={entry.xp} max={leaderXp} ariaLabel={`${entry.displayName}: ${entry.xp} XP compared with the leader's ${leaderXp} XP`} />
        <span className="game-podium__plinth" aria-hidden="true">{rank}</span>
      </li>;
    })}
  </ol>;
}
