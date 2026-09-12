import { Link } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { AppIcon } from "../../components/AppIcon";
import { LinkButton, PageHeader, Panel } from "../../components/ui";
import { PatchArtwork } from "../../components/ui/PatchArtwork";
import { InstallApp } from "../install/InstallApp";
import { CoffeeFooter, CoffeeWidget } from "../support/CoffeeWidget";
import "../../styles/training-public.css";

const trainingSteps = [
  { title: "Learn your passages", description: "Read the Scripture your coach assigns, then work through it a few verses at a time." },
  { title: "Review with purpose", description: "Return to the verses you missed and review them when they’re due." },
  { title: "Rehearse with your team", description: "Try a timed rehearsal or answer questions together in your coach’s practice room." },
];

export function LandingPage() {
  return <div className="training-public public-expedition">
    <CoffeeWidget />
    <a className="training-skip" href="#public-main">Skip to content</a>
    <header className="public-header">
      <Link to="/" aria-label="Erudoza home"><ErudozaWordmark inverted /></Link>
      <div className="public-header-actions">
        <div className="public-install-desktop"><InstallApp variant="ghost" className="ds-text-action" /></div>
        <LinkButton to="/login" variant="secondary">Sign in</LinkButton>
      </div>
    </header>
    <main id="public-main" className="public-main" data-testid="landing-phone-column" tabIndex={-1}>
      <section className="public-hero ds-inverse-surface" aria-labelledby="public-title">
        <img className="public-hero-art"
          src="/assets/landing/expedition-hero-1440.webp"
          srcSet="/assets/landing/expedition-hero-960.webp 960w, /assets/landing/expedition-hero-1440.webp 1440w, /assets/landing/expedition-hero-1920.webp 1920w"
          sizes="(max-width: 760px) 760px, 100vw"
          width={1855} height={848} fetchPriority="high"
          alt="An open Bible, compass and Pathfinder neckerchief beside a mountain lake" />
        <div className="public-hero-inner">
          <p className="ds-eyebrow">Bible competition preparation</p>
          <PageHeader as="div" titleId="public-title" className="ds-display-header"
            title={<><span>Rooted in Scripture.</span>{" "}<span>Ready for the journey.</span></>}
            description="Learn your assigned passages. Practice recalling them for your next Bible competition." />
          <div className="public-actions">
            <LinkButton to="/login" size="large" data-testid="start-studying">Start studying<AppIcon name="arrow" /></LinkButton>
            <LinkButton to="/signup" size="large" variant="secondary" data-testid="build-a-season">Coach your team</LinkButton>
          </div>
          <p className="public-access-note ds-caption">Use the account provided by your coach.</p>
        </div>
      </section>
      <div className="public-content">
        <section className="public-training" aria-labelledby="training-title">
          <h2 id="training-title" className="ds-section-title">Your training, chapter by chapter.</h2>
          <div className="public-training-columns">
            <ol className="public-training-steps">
              {trainingSteps.map((step, index) => <li key={step.title}>
                <span className="ds-step-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
              </li>)}
            </ol>
            <figure className="public-honors" aria-labelledby="public-honors-title">
              <figcaption>
                <h3 id="public-honors-title">A glimpse of Erudoza Honors</h3>
                <p className="ds-caption">Sample artwork</p>
              </figcaption>
              <div className="public-honor-art">
                <PatchArtwork src="/assets/landing/honor-flame-320.webp" srcSet="/assets/landing/honor-flame-160.webp 160w, /assets/landing/honor-flame-320.webp 320w" sizes="(max-width: 760px) 28vw, (max-width: 1200px) 16vw, 216px" size={216} alt="" />
                <PatchArtwork src="/assets/landing/honor-mountain-320.webp" srcSet="/assets/landing/honor-mountain-160.webp 160w, /assets/landing/honor-mountain-320.webp 320w" sizes="(max-width: 760px) 28vw, (max-width: 1200px) 16vw, 216px" size={216} alt="" />
                <PatchArtwork src="/assets/training/exact-recall-320.webp" srcSet="/assets/training/exact-recall-160.webp 160w, /assets/training/exact-recall-320.webp 320w" sizes="(max-width: 760px) 28vw, (max-width: 1200px) 16vw, 216px" size={216} alt="" />
              </div>
            </figure>
          </div>
        </section>
        <Panel className="public-coach" aria-labelledby="coach-title">
          <img className="public-coach-art" src="/assets/landing/expedition-coach-960.webp" srcSet="/assets/landing/expedition-coach-640.webp 640w, /assets/landing/expedition-coach-960.webp 960w" sizes="(min-width: 761px) 50vw, 100vw" width={2172} height={724} loading="lazy" alt="" />
          <div className="public-coach-copy">
            <h2 id="coach-title" className="ds-section-title">Guide your team’s next step.</h2>
            <p>Assign passages and see where each student needs practice.</p>
            <LinkButton to="/signup" variant="ghost" className="ds-text-action">Create your club<AppIcon name="arrow" /></LinkButton>
          </div>
        </Panel>
      </div>
    </main>
    <footer className="public-footer">
      <div className="public-footer-brand"><span className="ds-brand-name">Erudoza</span><span className="ds-caption">Study. Master. Compete.</span></div>
      <div className="public-footer-actions">
        <div className="public-install-mobile"><InstallApp variant="ghost" className="ds-text-action" /></div>
        <CoffeeFooter />
      </div>
    </footer>
  </div>;
}
