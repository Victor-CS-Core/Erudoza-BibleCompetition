import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { useAuth } from "../../auth/AuthContext";
import { AppFooter } from "../../components/ui/AppFooter";
import { LinkButton, Notice, PageHeader, Panel } from "../../components/ui";
import "../../styles/training-public.css";
import type { LegalBlock, LegalMetaItem, LegalSection } from "./legalContent";

/** Bold "Label." lead-ins used throughout the drafts, e.g. "Account details. …". */
const LEAD_IN = /^([A-Z][^.[\]@]{1,52}?)\.\s+(?=[A-Z“"(])/;
const LINKABLE = /(https?:\/\/[^\s)]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function linkify(text: string): ReactNode[] {
  return text.split(LINKABLE).map((part, index) => {
    if (index % 2 === 1) {
      const href = part.startsWith("http") ? part : `mailto:${part}`;
      return <a key={index} href={href}>{part}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function LegalParagraph({ block }: { block: LegalBlock }) {
  const match = block.text.match(LEAD_IN);
  const label = match?.[1] ?? null;
  const body = label ? block.text.slice(match![0].length) : block.text;
  return (
    <p>
      {label ? <><strong>{label}.</strong>{" "}</> : null}
      {linkify(body)}
    </p>
  );
}

export function LegalPage({
  title,
  description,
  meta,
  intro,
  sections,
  testId,
}: {
  title: string;
  description: string;
  meta?: LegalMetaItem[];
  intro?: string[];
  sections: LegalSection[];
  testId: string;
}) {
  const { me } = useAuth();
  const home = me?.kind === "Adult" ? "/admin" : "/student";
  return (
    <div className="training-public public-legal">
      <a className="training-skip" href="#public-main">Skip to content</a>
      <header className="public-header">
        <Link to="/" aria-label="Erudoza home"><ErudozaWordmark inverted /></Link>
        <div className="public-header-actions">
          {me
            ? <LinkButton to={home} variant="secondary">Back to workspace</LinkButton>
            : <LinkButton to="/login" variant="secondary">Sign in</LinkButton>}
        </div>
      </header>
      <main id="public-main" className="public-main" tabIndex={-1}>
        <div className="public-legal-body">
          <PageHeader titleId={`${testId}-title`} title={title} help={description} />
          <Notice tone="info" className="public-legal-disclaimer">
            <strong>Independent training tool.</strong> Erudoza is not affiliated with, authorized by,
            sponsored by, or endorsed by the General Conference Corporation of Seventh-day Adventists,
            the North American Division of Seventh-day Adventists, NAD Club Ministries, the Pathfinder
            organization, Pathfinder Bible Experience, or any related church, conference, club-ministry,
            or Pathfinder entity. Official PBE information is published separately, including at{" "}
            <a href="https://nadpbe.org/">nadpbe.org</a>.
          </Notice>
          {meta && (
            <Panel className="public-legal-meta" aria-label="Document details">
              <dl>
                {meta.map((item) => (
                  <Fragment key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{linkify(item.value)}</dd>
                  </Fragment>
                ))}
              </dl>
            </Panel>
          )}
          {intro?.map((paragraph, index) => <p key={index} className="public-legal-intro">{linkify(paragraph)}</p>)}
          <article className="public-legal-article" aria-label={title}>
            {sections.map((section) => (
              <section key={section.num} aria-labelledby={`${testId}-section-${section.num}`}>
                <h2 id={`${testId}-section-${section.num}`} className="ds-section-title">
                  {section.num}. {section.title}
                </h2>
                {section.blocks.map((block, index) =>
                  block.kind === "h3" ? (
                    <h3 key={index}>{block.text}</h3>
                  ) : (
                    <LegalParagraph key={index} block={block} />
                  ),
                )}
              </section>
            ))}
          </article>
        </div>
      </main>
      <AppFooter variant="public" />
    </div>
  );
}
