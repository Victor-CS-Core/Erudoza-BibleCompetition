import { Link } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { LandscapeBanner } from "../../components/brand/LandscapeBanner";
import { PathfinderBackdrop } from "../../components/brand/PathfinderBackdrop";
import { AppIcon } from "../../components/AppIcon";
import { LinkButton } from "../../components/ui";
import { CoffeeWidget } from "../support/CoffeeWidget";
import "../../styles/training-public.css";

export function LandingPage() {
  return <div className="training-public pathfinder-canvas">
    <PathfinderBackdrop />
    <CoffeeWidget />
    <a className="training-skip" href="#public-main">Skip to content</a>
    <header className="public-header"><Link to="/" aria-label="Erudoza home"><ErudozaWordmark compact inverted /></Link><LinkButton to="/login" variant="secondary">Sign in<AppIcon name="arrow" /></LinkButton></header>
    <main id="public-main" className="public-main" data-testid="landing-phone-column">
      <div className="public-welcome"><LandscapeBanner className="public-landscape" priority sizes="(min-width: 1200px) 1128px, 100vw" alt="Mountains and forest surrounding an open valley" /><section className="public-intro">
        <h1>Know the passage.<br /><em>Own the moment.</em></h1>
        <p>Focused Scripture training for your next Bible competition. Study your assigned passages, strengthen your recall, and prepare together.</p>
        <div className="public-actions"><LinkButton to="/login" data-testid="start-studying">Start studying<AppIcon name="arrow" /></LinkButton><LinkButton to="/login" data-testid="build-a-season" variant="secondary">Coach your team</LinkButton></div>
        <p className="public-access-note">Sign in with the account provided by your coach or academy.</p>
      </section>
      </div>
      <section className="public-training" aria-labelledby="training-title">
        <div><h2 id="training-title">A clear path to confident recall.</h2><p>One assigned passage. Different ways to make it stick.</p></div>
        <ol className="public-training-steps">
          <li><AppIcon name="book" /><div><h3>Learn your passages</h3><p>Restore missing words, rebuild verses, and match references from the Scripture your coach assigns.</p></div></li>
          <li><AppIcon name="review" /><div><h3>Review what needs attention</h3><p>Return to due verses and follow your saved progress as your recall grows.</p></div></li>
          <li><AppIcon name="flag" /><div><h3>Rehearse for competition</h3><p>Practice under time pressure in a simulation or join your team in a coach-led room.</p></div></li>
        </ol>
      </section>
      <section className="public-coach"><img className="public-coach-art" src="/assets/training/coach-guide-480.webp" srcSet="/assets/training/coach-guide-480.webp 480w, /assets/training/coach-guide-960.webp 960w" sizes="(min-width: 900px) 320px, 80vw" width={480} height={320} loading="lazy" alt="" /><div><h2>Give every student a clear next step.</h2><p>Choose a season’s passages, set each student’s difficulty, and follow their progress in one place.</p><Link to="/signup">Create a club with a coach account →</Link></div><LinkButton to="/login" variant="secondary">Sign in as a coach<AppIcon name="arrow" /></LinkButton></section>
    </main>
    <footer className="public-footer">SCRIPTURE · DISCIPLESHIP · REAL-WORLD FAITH</footer>
  </div>;
}
