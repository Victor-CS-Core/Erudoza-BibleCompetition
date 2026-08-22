import { Link } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { PaperSurface } from "../../components/material/PaperSurface";

export function LandingPage() {
  return (
    <div className="er-canvas">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <ErudozaWordmark />
        <Link to="/login" className="rounded-[var(--er-radius-control)] px-4 font-medium text-[var(--er-action-blue)]">
          Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16">
        <section className="er-kraft-board mt-6 px-6 py-12 md:px-12">
          <p className="er-scripture text-4xl font-semibold md:text-6xl">Study. Master. Compete.</p>
          <p className="mt-4 max-w-2xl text-lg text-[var(--er-graphite)]">
            Turn assigned Scripture into personalized study decks, memory challenges, targeted review, and
            competition-ready practice.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/login"
              data-testid="start-studying"
              className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-5 text-[var(--er-card)]"
            >
              Start studying
            </Link>
            <Link
              to="/login"
              data-testid="build-a-season"
              className="rounded-[var(--er-radius-control)] border border-[var(--er-ink-navy)] px-5"
            >
              Build a season
            </Link>
          </div>
        </section>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <PaperSurface>
            <h2 className="text-xl font-semibold">Assigned material. Smarter practice.</h2>
            <p className="mt-2 text-[var(--er-graphite)]">
              Every study session is built from the books, chapters, verses, and approved supplemental material
              assigned for the current competition.
            </p>
          </PaperSurface>
          <PaperSurface>
            <h2 className="text-xl font-semibold">Practice the same truth in different ways.</h2>
            <p className="mt-2 text-[var(--er-graphite)]">
              Restore missing words. Rebuild verses. Match references. Recall facts. Then move into competition-style
              questions.
            </p>
          </PaperSurface>
        </div>
      </main>
    </div>
  );
}
