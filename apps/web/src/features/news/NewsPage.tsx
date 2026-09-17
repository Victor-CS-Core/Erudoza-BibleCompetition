import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Button, EmptyState, ExternalLinkButton, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import type { PbeNewsArticleSummary } from "../../api/types";
import "./news.css";

export function formatNewsDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function SourceChip({ sourceUrl, sourceLabel }: { sourceUrl?: string; sourceLabel?: string }) {
  if (!sourceUrl) return null;
  return <a className="news-source-chip" href={sourceUrl} target="_blank" rel="noreferrer">{sourceLabel ?? "View source"}</a>;
}

/** Shared student/coach news feed + article reader. `base` is the feed path ("/student/news" or "/admin/news"). */
export function NewsPage({ base }: { base: string }) {
  const { id } = useParams();
  return id ? <NewsArticleReader base={base} id={id} /> : <NewsFeed base={base} />;
}

function NewsFeed({ base }: { base: string }) {
  const { me } = useAuth();
  const org = me!.organizationId;
  const feed = useQuery({ queryKey: ["pbe-news", org], queryFn: () => api.pbeNews(org), retry: false });
  return <div className="training-page news-page"><PageHeader title="PBE news" description="Announcements, new materials, and event updates for Pathfinder Bible Experience." />
    {feed.isPending ? <LoadingState label="Loading PBE news…" /> : feed.isError ? <Notice tone="danger">The news feed could not load. <Button variant="secondary" onClick={() => void feed.refetch()}>Try again</Button></Notice>
      : feed.data.length === 0 ? <EmptyState title="No PBE news yet" description="Published announcements and material updates will appear here." />
      : <div className="news-feed">
        {feed.data.map((article, index) => index === 0
          ? <HeroCard key={article.id} base={base} article={article} />
          : <NewsCard key={article.id} base={base} article={article} />)}
      </div>}
  </div>;
}

function HeroCard({ base, article }: { base: string; article: PbeNewsArticleSummary }) {
  return <Panel className="news-hero"><article aria-labelledby={`news-hero-${article.id}`}>
    <p className="news-kicker">Latest update</p>
    <h2 id={`news-hero-${article.id}`}><Link to={`${base}/${encodeURIComponent(article.id)}`}>{article.title}</Link></h2>
    <p className="news-lede">{article.summary}</p>
    <div className="news-meta">{article.publishedAtUtc && <time dateTime={article.publishedAtUtc}>{formatNewsDate(article.publishedAtUtc)}</time>}<SourceChip sourceUrl={article.sourceUrl ?? undefined} sourceLabel={article.sourceLabel ?? undefined} /></div>
  </article></Panel>;
}

function NewsCard({ base, article }: { base: string; article: PbeNewsArticleSummary }) {
  return <Panel className="news-card"><article aria-labelledby={`news-card-${article.id}`}>
    <h3 id={`news-card-${article.id}`}><Link to={`${base}/${encodeURIComponent(article.id)}`}>{article.title}</Link></h3>
    <p>{article.summary}</p>
    <div className="news-meta">{article.publishedAtUtc && <time dateTime={article.publishedAtUtc}>{formatNewsDate(article.publishedAtUtc)}</time>}<SourceChip sourceUrl={article.sourceUrl ?? undefined} sourceLabel={article.sourceLabel ?? undefined} /></div>
  </article></Panel>;
}

function NewsArticleReader({ base, id }: { base: string; id: string }) {
  const { me } = useAuth();
  const org = me!.organizationId;
  const article = useQuery({ queryKey: ["pbe-news-article", org, id], queryFn: () => api.pbeNewsArticle(org, id), retry: false });
  return <div className="training-page news-page"><LinkButton variant="secondary" to={base}>← All news</LinkButton>
    {article.isPending ? <LoadingState label="Loading the article…" /> : article.isError ? <Notice tone="danger">This article is not available. It may be an unpublished draft. <LinkButton variant="secondary" to={base}>Back to the news feed</LinkButton></Notice>
      : <Panel className="news-article"><article aria-labelledby="news-article-title">
        <p className="news-kicker">PBE news</p>
        <h1 id="news-article-title">{article.data.title}</h1>
        <div className="news-meta">{article.data.publishedAtUtc && <time dateTime={article.data.publishedAtUtc}>{formatNewsDate(article.data.publishedAtUtc)}</time>}{article.data.sourceLabel && <span>{article.data.sourceLabel}</span>}</div>
        <p className="news-lede">{article.data.summary}</p>
        {article.data.sections.map((section, index) => <section key={index} aria-label={section.heading}><h2>{section.heading}</h2><p className="news-section-body">{section.body}</p></section>)}
        {article.data.sourceUrl && <div className="news-original"><ExternalLinkButton href={article.data.sourceUrl} target="_blank" rel="noreferrer">View original announcement</ExternalLinkButton></div>}
      </article></Panel>}
  </div>;
}
