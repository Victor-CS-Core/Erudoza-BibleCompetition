import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Button, EmptyState, ExternalLinkButton, LinkButton, LoadingState, Notice, PageHeader, Panel } from "../../components/ui";
import type { PbeNewsArticleSummary, PbeNewsLinkedMaterial } from "../../api/types";
import { ArticleTypeArt, articleTypeLabel, normalizeArticleType } from "./articleTypeArt";
import "./news.css";

export function formatNewsDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function readTimeLabel(readMinutes?: number | null) {
  return typeof readMinutes === "number" && readMinutes > 0 ? `${readMinutes} min read` : null;
}

/** Internal app paths use client routing; external URLs open a new tab. */
export function NewsDeepLink({ href, className, title, children }: { href: string; className?: string; title?: string; children: ReactNode }) {
  if (href.startsWith("/")) return <Link to={href} className={className} title={title}>{children}</Link>;
  return <a href={href} target="_blank" rel="noreferrer" className={className} title={title}>{children}</a>;
}

/** "In this article" block: key points plus deep links to the reading material behind the article. */
function InsideArticle({ keyPoints, linkedMaterials }: { keyPoints: string[]; linkedMaterials: PbeNewsLinkedMaterial[] }) {
  if (!keyPoints.length && !linkedMaterials.length) return null;
  return <div className="news-inside">
    <p className="news-inside-label">In this article</p>
    <div className="news-inside-chips">
      {keyPoints.map((point, index) => <span key={index} className="news-chip">{point}</span>)}
      {linkedMaterials.map((material, index) => <NewsDeepLink key={`material-${index}`} href={material.href} className="news-chip news-chip-link" title={material.hint ?? material.label}>{material.label}</NewsDeepLink>)}
    </div>
  </div>;
}

function NewsMeta({ article }: { article: { publishedAtUtc?: string | null; readMinutes?: number | null; sourceUrl?: string | null; sourceLabel?: string | null } }) {
  const read = readTimeLabel(article.readMinutes);
  return <div className="news-meta">
    {article.publishedAtUtc && <time dateTime={article.publishedAtUtc}>{formatNewsDate(article.publishedAtUtc)}</time>}
    {read && <><span aria-hidden="true">·</span><span>{read}</span></>}
    {article.sourceUrl && <><span aria-hidden="true">·</span><NewsDeepLink href={article.sourceUrl} className="news-source-chip">{article.sourceLabel ?? "View source"}</NewsDeepLink></>}
  </div>;
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
  return <div className="training-page news-page"><PageHeader title="PBE news" help="Announcements, new materials, and event updates for Pathfinder Bible Experience." />
    {feed.isPending ? <LoadingState label="Loading PBE news…" /> : feed.isError ? <Notice tone="danger">The news feed could not load. <Button variant="secondary" onClick={() => void feed.refetch()}>Try again</Button></Notice>
      : feed.data.length === 0 ? <EmptyState title="No PBE news yet" description="Published announcements and material updates will appear here." />
      : <div className="news-feed">
        {feed.data.map(article => <NewsCard key={article.id} base={base} article={article} />)}
      </div>}
  </div>;
}

function NewsCard({ base, article }: { base: string; article: PbeNewsArticleSummary }) {
  const type = normalizeArticleType(article.articleType);
  return <Panel as="article" className="news-card" aria-labelledby={`news-card-${article.id}`}>
    <ArticleTypeArt type={type} />
    <p className="news-kicker">{articleTypeLabel(type)}</p>
    <h3 id={`news-card-${article.id}`}><Link to={`${base}/${encodeURIComponent(article.id)}`}>{article.title}</Link></h3>
    <p className="news-summary">{article.summary}</p>
    <InsideArticle keyPoints={article.keyPoints ?? []} linkedMaterials={article.linkedMaterials ?? []} />
    <NewsMeta article={article} />
  </Panel>;
}

function NewsArticleReader({ base, id }: { base: string; id: string }) {
  const { me } = useAuth();
  const org = me!.organizationId;
  const article = useQuery({ queryKey: ["pbe-news-article", org, id], queryFn: () => api.pbeNewsArticle(org, id), retry: false });
  return <div className="training-page news-page"><LinkButton variant="secondary" to={base}>← All news</LinkButton>
    {article.isPending ? <LoadingState label="Loading the article…" /> : article.isError ? <Notice tone="danger">This article is not available. It may be an unpublished draft. <LinkButton variant="secondary" to={base}>Back to the news feed</LinkButton></Notice>
      : (() => {
        const data = article.data;
        const type = normalizeArticleType(data.articleType);
        const materials = data.linkedMaterials ?? [];
        return <Panel as="article" className="news-article" aria-labelledby="news-article-title">
          <ArticleTypeArt type={type} />
          <p className="news-kicker">{articleTypeLabel(type)}</p>
          <h1 id="news-article-title">{data.title}</h1>
          <NewsMeta article={data} />
          <p className="news-lede">{data.summary}</p>
          {data.sections.map((section, index) => <section key={index} aria-label={section.heading}><h2>{section.heading}</h2><p className="news-section-body">{section.body}</p></section>)}
          {materials.length > 0 && <section className="news-materials" aria-label="Reading material">
            <h2>Reading material — open directly</h2>
            <ul>{materials.map((material, index) => <li key={index} className="news-material-row">
              <div className="news-material-detail"><strong>{material.label}</strong>{material.hint && <small>{material.hint}</small>}</div>
              <NewsDeepLink href={material.href} className="news-open-button">Open</NewsDeepLink>
            </li>)}</ul>
          </section>}
          {data.sourceUrl && <div className="news-original"><ExternalLinkButton href={data.sourceUrl} target="_blank" rel="noreferrer">View original announcement</ExternalLinkButton></div>}
        </Panel>;
      })()}
  </div>;
}
