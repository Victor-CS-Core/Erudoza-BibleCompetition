import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { ErudozaWordmark } from "../../components/brand/ErudozaWordmark";
import { AppIcon } from "../../components/AppIcon";
import { AppFooter } from "../../components/ui/AppFooter";
import { Badge, Button, Input, LinkButton, LoadingState, PageHeader, Panel } from "../../components/ui";
import { searchWiki, wikiArticles, wikiGroups, type WikiArticle, type WikiAudience } from "./wikiContent";
import "./wiki.css";

const filters: Array<"All" | WikiAudience> = ["All", "Student", "Coach", "Shared"];

function audienceLabel(audience: WikiAudience) {
  return audience === "Shared" ? "Everyone" : `${audience} guide`;
}

function WikiArticleView({ article, open }: { article: WikiArticle; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => setExpanded(open), [open]);

  return <details id={`wiki-${article.id}`} className="wiki-article" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <span className="wiki-article-heading"><span className="wiki-article-kicker">{audienceLabel(article.audience)}</span><strong>{article.title}</strong><span>{article.summary}</span></span>
      <AppIcon name="chevron" />
    </summary>
    <div className="wiki-article-body">
      <div className="wiki-article-meta"><Badge tone={article.audience === "Coach" ? "info" : article.audience === "Student" ? "success" : "neutral"}>{audienceLabel(article.audience)}</Badge>{article.links?.map(link => <LinkButton key={link.to} variant="secondary" size="compact" to={link.to}>{link.label}<AppIcon name="arrow" /></LinkButton>)}</div>
      {(article.purpose || article.prerequisites?.length || article.controls?.length || article.savedChanges?.length || article.permissions?.length || article.troubleshooting?.length || article.glossary?.length) && <section className="wiki-article-facts" aria-label="Guide details">
        {article.purpose && <div><h3>Purpose</h3><p>{article.purpose}</p></div>}
        {article.prerequisites?.length ? <div><h3>Before you start</h3><ul>{article.prerequisites.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        {article.controls?.length ? <div><h3>Controls and statuses</h3><dl>{article.controls.map(control => <div key={control.label}><dt>{control.label}</dt><dd>{control.explanation}</dd></div>)}</dl></div> : null}
        {article.savedChanges?.length ? <div><h3>What gets saved</h3><ul>{article.savedChanges.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        {article.permissions?.length ? <div><h3>Permissions</h3><ul>{article.permissions.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        {article.troubleshooting?.length ? <div><h3>Errors and recovery</h3><ul>{article.troubleshooting.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
        {article.glossary?.length ? <div><h3>Key terms</h3><ul>{article.glossary.map(item => <li key={item}>{item}</li>)}</ul></div> : null}
      </section>}
      {article.screenshot && <figure className="wiki-screenshot"><img src={article.screenshot.src} alt={article.screenshot.alt} loading="lazy" /><figcaption>{article.screenshot.caption}</figcaption></figure>}
      {article.steps && <section className="wiki-steps"><h3>How to use it</h3><ol>{article.steps.map(step => <li key={step}>{step}</li>)}</ol></section>}
      <div className="wiki-article-sections">{article.sections.map(section => <section key={section.heading}><h3>{section.heading}</h3>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}</section>)}</div>
      {article.faqs && <section className="wiki-faq"><h3>Common questions</h3>{article.faqs.map(faq => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</section>}
      {article.related?.length ? <nav className="wiki-related" aria-label={`Related to ${article.title}`}><h3>Related guides</h3><div>{article.related.map(id => { const related = wikiArticles.find(item => item.id === id); return related ? <a key={id} href={`#wiki-${id}`}>{related.title}<AppIcon name="arrow" /></a> : null; })}</div></nav> : null}
    </div>
  </details>;
}

export function WikiPage() {
  const { me, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<"All" | WikiAudience>("All");
  const query = params.get("q") ?? "";
  const coach = me?.kind === "Adult";
  const home = coach ? "/admin" : "/student";
  const roleLabel = coach ? "Coach workspace" : "Student workspace";
  const updateQuery = (value: string) => {
    const next = new URLSearchParams(params);
    if (value.trim()) next.set("q", value); else next.delete("q");
    setParams(next, { replace: true });
  };
  const results = useMemo(() => searchWiki(wikiArticles, query).filter(result => filter === "All" || result.article.audience === filter), [filter, query]);
  const resultIds = useMemo(() => new Set(results.map(result => result.article.id)), [results]);

  if (loading) return <main className="training-public public-recovery"><LoadingState label="Opening the wiki…" /></main>;
  if (!me) return <Navigate to="/login" replace />;

  return <div className="wiki-page training-app">
    <a className="training-skip" href="#wiki-main">Skip to content</a>
    <header className="wiki-header ds-inverse-surface"><div className="wiki-header-inner"><Link to={home} aria-label="Erudoza home"><ErudozaWordmark compact inverted /></Link><div className="wiki-header-account"><ProfileAvatar userId={me.userId} displayName={me.displayName} size={40} /><span><strong>{me.displayName}</strong><small>{roleLabel}</small></span><LinkButton to={home} variant="secondary" size="compact">Back to workspace</LinkButton></div></div></header>
    <main id="wiki-main" className="wiki-main" tabIndex={-1}>
      <PageHeader title="Erudoza wiki" description="Search practical explanations for every student and coach feature, control, status, and recovery path." />
      <Panel className="wiki-search-panel">
        <div className="wiki-search-heading"><div><p className="ds-eyebrow">Help for the trail ahead</p><h2>Find an explanation</h2></div><Badge tone="info">{roleLabel}</Badge></div>
        <label className="wiki-search-label">Search the wiki<Input type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="Try “save assignments”, “PBE”, or “profile”" /></label>
        <div className="wiki-filter-row" role="group" aria-label="Wiki audience filter">{filters.map(option => <Button key={option} variant={filter === option ? "secondary" : "ghost"} size="compact" aria-pressed={filter === option} onClick={() => setFilter(option)}>{option}</Button>)}</div>
        <p className="wiki-result-count" aria-live="polite">{query ? `${results.length} ${results.length === 1 ? "guide" : "guides"} match “${query}”.` : `${results.length} guides across the platform.`}</p>
      </Panel>
      <div className="wiki-layout">
        <aside className="wiki-contents ds-panel"><h2>Contents</h2>{wikiGroups.map(group => { const visible = group.articleIds.filter(id => resultIds.has(id) && (filter === "All" || wikiArticles.find(article => article.id === id)?.audience === filter)); if (!visible.length) return null; return <section key={group.id}><h3>{group.title}</h3><p>{group.description}</p><nav aria-label={`${group.title} articles`}>{visible.map(id => { const article = wikiArticles.find(item => item.id === id); return article ? <a key={id} href={`#wiki-${id}`}>{article.title}</a> : null; })}</nav></section>; })}</aside>
        <section className="wiki-results" aria-label="Wiki guides">
          {!results.length && <Panel className="wiki-empty"><h2>No matching guides</h2><p>Try a feature name, button label, status, or troubleshooting phrase. For example: “chapter”, “retry”, “weekly goal”, or “coach invitation”.</p><Button variant="secondary" onClick={() => { updateQuery(""); setFilter("All"); }}>Show all guides</Button></Panel>}
          {wikiGroups.map(group => {
            const ids = (query ? group.articleIds.filter(id => resultIds.has(id)) : group.articleIds).filter(id => filter === "All" || wikiArticles.find(article => article.id === id)?.audience === filter);
            if (!ids.length) return null;
            return <section key={group.id} className="wiki-group" aria-labelledby={`wiki-group-${group.id}`}><div className="wiki-group-heading"><div><p className="ds-eyebrow">{group.title}</p><h2 id={`wiki-group-${group.id}`}>{group.description}</h2></div><span>{ids.length} {ids.length === 1 ? "guide" : "guides"}</span></div>{ids.map(id => { const article = wikiArticles.find(item => item.id === id); if (!article) return null; return <WikiArticleView key={id} article={article} open={id === ids[0]} />; })}</section>;
          })}
          {query && results.length > 0 && <p className="wiki-search-footnote">Search includes article details, steps, FAQs, route names, and keywords. Use the role label on each guide to check who can open its linked feature.</p>}
        </section>
      </div>
    </main>
    <AppFooter variant="workspace" />
  </div>;
}
