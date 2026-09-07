import { Link } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { PaperSurface } from "../../components/material/PaperSurface";
import { Stamp } from "../../components/material/Stamp";

const trainingDecks = [
  {
    name: "Learner deck",
    label: "Learner",
    tone: "new",
    image: "/brand/deck-new.webp",
    className: "er-deck-new",
    testId: "landing-deck-learner",
  },
  {
    name: "Reviews deck",
    label: "Reviews",
    tone: "review",
    image: "/brand/deck-review.webp",
    className: "er-deck-review",
    testId: "landing-deck-reviews",
  },
  {
    name: "Rehearsal deck",
    label: "Rehearsal",
    tone: "due",
    image: "/brand/deck-simulation.webp",
    className: "er-deck-simulation",
    testId: "landing-deck-rehearsal",
  },
] as const;

export function LandingPage() {
  return (
    <div className="er-canvas er-landing">
      <header className="er-site-header mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
        <ErudozaWordmark />
        <Link to="/login" className="er-header-action px-4 font-semibold">
          Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-7xl space-y-8 px-4 pb-16 md:px-8">
        <FieldGuideCover />
        <section className="er-landing-hero">
          <div className="er-hero-copy">
            <h1 className="er-hero-title">
              Know the passage.
              <span>Own the moment.</span>
            </h1>
            <p className="er-hero-summary">
              Turn your assigned Scripture into focused memorization games, due reviews, and realistic
              rehearsal.
            </p>
            <div className="er-hero-actions">
              <Link to="/login" data-testid="start-studying" className="er-primary-action">
                Start studying
              </Link>
              <Link to="/login" data-testid="build-a-season" className="er-secondary-action">
                Build a season
              </Link>
            </div>
            <p className="er-hero-note">Your team chooses the passage. Erudoza deals the deck.</p>
          </div>

          <div className="er-deck-stage" aria-labelledby="training-decks-title">
            <div className="er-deck-stage-heading">
              <p className="er-deck-kicker">Learner · Reviews · Rehearsal</p>
              <h2 id="training-decks-title">Choose today’s training deck</h2>
              <p>Build recall first, reinforce what is due, then test it under pressure.</p>
            </div>
            <div className="er-deck-fan">
              {trainingDecks.map((deck) => (
                <Link
                  key={deck.name}
                  to="/login"
                  className={`er-deck-link ${deck.className}`}
                  aria-label={`Open the ${deck.name.toLowerCase()}`}
                >
                  <img src={deck.image} alt={deck.name} />
                  <span className="er-deck-label" data-testid={deck.testId}>
                    <Stamp label={deck.label} tone={deck.tone} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="er-proof-grid" aria-label="How Erudoza prepares competitors">
          <PaperSurface as="article" className="er-proof-card">
            <p className="er-proof-label">Learn exactly</p>
            <h2>Drill only the assigned Scripture.</h2>
            <p>Coaches define the season range. Every game stays anchored to that approved material.</p>
          </PaperSurface>
          <PaperSurface as="article" className="er-proof-card">
            <p className="er-proof-label">Remember longer</p>
            <h2>Meet each verse in more than one way.</h2>
            <p>Restore words, rebuild verses, match references, and revisit the material that needs attention.</p>
          </PaperSurface>
          <PaperSurface as="article" className="er-proof-card">
            <p className="er-proof-label">Compete calmly</p>
            <h2>Rehearse before the room gets loud.</h2>
            <p>Timed rehearsal turns growing recall into confident Bible Bowl performance.</p>
          </PaperSurface>
        </section>
      </main>
    </div>
  );
}
