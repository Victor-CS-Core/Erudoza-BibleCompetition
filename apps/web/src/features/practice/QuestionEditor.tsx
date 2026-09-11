import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { practiceApi, type PracticeBootstrap, type PracticeQuestion } from "../../api/practice";
import { Badge, Button, Input, Notice, Panel, Select, Textarea } from "../../components/ui";
import { parseQuestionImport } from "./practiceUtils";
import { scopePacks, withinRange } from "../admin/passageRanges";

export function QuestionEditor({ org, data }: { org: string; data: PracticeBootstrap }) {
  const cache = useQueryClient();
  const editor = useRef<HTMLDetailsElement>(null);
  const [identity, setIdentity] = useState<{ id?: string; version: number }>({ version: 1 });
  const [season, setSeason] = useState("");
  const [pack, setPack] = useState("");
  const [unit, setUnit] = useState("");
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState("ShortAnswer");
  const [parts, setParts] = useState<PracticeQuestion["parts"]>([{ acceptedAnswers: [""], points: 1 }]);
  const [ordered, setOrdered] = useState(false);
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState<PracticeQuestion[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const selectedSeason = season || data.seasons[0]?.id || "";
  const library = useQuery({ queryKey: ["library", org], queryFn: () => api.library(org) });
  const scope = useQuery({ queryKey: ["season-scope", org, selectedSeason], queryFn: () => api.seasonScope(org, selectedSeason), enabled: !!selectedSeason });
  const packs = scopePacks(scope.data);
  const selectedPack = packs.find(p => p.contentPackId === pack);
  const units = useQuery({ queryKey: ["source-units", org, pack], queryFn: () => api.sourceUnits(org, pack), enabled: !!selectedPack });
  const availableUnits = selectedPack ? units.data?.filter(unit => selectedPack.includes.some(range => withinRange(unit, range)) && !selectedPack.excludes.some(range => withinRange(unit, range))) ?? [] : [];

  const seasonQuestions = data.questions.filter(question => question.seasonId === selectedSeason);
  const visibleQuestions = seasonQuestions.filter(question => (status === "all" || (status === "published" ? question.published : !question.published)) && `${question.question.prompt} ${question.question.reference}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  async function run(work: () => Promise<unknown>) { setPending(true); setError(""); setSuccess(""); try { await work(); await cache.invalidateQueries({ queryKey: ["practice", org] }); setSuccess("Saved. Drafts require publication before matches can use them."); } catch (e) { setError(e instanceof Error ? e.message : "Could not save questions."); } finally { setPending(false); } }
  function prepare() { try { if (!selectedPack || !availableUnits.some(u => u.id === unit)) throw new Error("Choose a source within the selected season passages."); const normalized = parts.map(part => ({ ...part, acceptedAnswers: part.acceptedAnswers.map(answer => answer.trim()).filter(Boolean) })); if (normalized.some(part => !part.acceptedAnswers.length)) throw new Error("Each scoring part needs at least one accepted answer."); setPreview([{ id: identity.id, contentPackId: pack, sourceUnitId: unit, prompt, kind, parts: normalized, ordered, reference, evidence, version: identity.version }]); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Invalid scoring parts."); } }
  return <Panel><h2>Coach question bank</h2><p>Use approved season content. Every answer must be supported by Scripture or commentary. Published questions are versioned and frozen when a match starts.</p>
    {error && <Notice tone="danger">{error}</Notice>}{success && <Notice tone="success">{success}</Notice>}
    <label>Question season<Select disabled={!data.seasons.length} value={selectedSeason} onChange={e => { setSeason(e.target.value); setPack(""); setUnit(""); setPreview(null); }}>{!data.seasons.length && <option value="">No active seasons</option>}{data.seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></label>
    <details className="ds-disclosure" ref={editor}><summary>{identity.id ? "Edit a new question version" : "Create a question"}</summary><form className="practice-editor" onSubmit={e => { e.preventDefault(); prepare(); }}>
      {scope.isError && <Notice tone="danger">Season passages could not load. <Button variant="secondary" onClick={() => void scope.refetch()}>Retry season passages</Button></Notice>}
      {units.isError && <Notice tone="danger">Source passages could not load. <Button variant="secondary" onClick={() => void units.refetch()}>Retry source passages</Button></Notice>}
      <div className="practice-form"><label>Source book<Select value={selectedPack?.contentPackId ?? ""} required onChange={e => { setPack(e.target.value); setUnit(""); }}><option value="">Choose a season book</option>{packs.map(p => <option key={p.contentPackId} value={p.contentPackId}>{library.data?.books.find(book => book.contentPackId === p.contentPackId)?.name ?? [...new Set(p.includes.map(range => range.bookKey))].join(", ")}</option>)}</Select></label><label>Source unit<Select value={availableUnits.some(u => u.id === unit) ? unit : ""} required disabled={!selectedPack || units.isPending} onChange={e => setUnit(e.target.value)}><option value="">{!selectedPack ? "Choose a source book first" : units.isPending ? "Loading passages…" : "Choose source"}</option>{availableUnits.map(u => <option key={u.id} value={u.id}>{u.citation}</option>)}</Select></label><label>Type<Select value={kind} onChange={e => setKind(e.target.value)}><option value="ShortAnswer">Short answer</option><option value="List">List</option><option value="ExactWords">Exact-word blank</option><option value="TrueFalse">True or false</option></Select></label></div>
      <label>Prompt<Textarea required value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <label>Reference<Input required value={reference} onChange={e => setReference(e.target.value)} placeholder="Book, chapter and verse" /></label>
      <label>Evidence<Textarea required value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <div className="practice-editor"><h3>Scoring parts</h3><p>Each part earns its own accuracy points. Put each accepted wording on a separate line.</p>{parts.map((part, index) => <div className="practice-form" key={index}><label>Part {index + 1} accepted answers<Textarea required rows={3} value={part.acceptedAnswers.join("\n")} onChange={e => setParts(current => current.map((item, i) => i === index ? { ...item, acceptedAnswers: e.target.value.split("\n") } : item))} /></label><label>Part {index + 1} points<Input required type="number" min={1} max={8} step={1} value={part.points} onChange={e => setParts(current => current.map((item, i) => i === index ? { ...item, points: Number(e.target.value) } : item))} /></label><Button variant="ghost" disabled={parts.length === 1} onClick={() => setParts(current => current.filter((_, i) => i !== index))}>Remove part {index + 1}</Button></div>)}<div><Button variant="secondary" disabled={parts.length >= 8} onClick={() => setParts(current => [...current, { acceptedAnswers: [""], points: 1 }])}>Add scoring part</Button></div></div>
      <label>Answer order<Select value={String(ordered)} onChange={e => setOrdered(e.target.value === "true")}><option value="false">Any order</option><option value="true">Required order</option></Select></label>
      <div className="practice-actions"><Button type="submit" disabled={!selectedSeason}>Preview question</Button>{identity.id && <Button variant="ghost" onClick={() => { setIdentity({ version: 1 }); setPrompt(""); setParts([{ acceptedAnswers: [""], points: 1 }]); setPreview(null); }}>Start a different question</Button>}</div>
    </form></details>
    <details className="ds-disclosure"><summary>Import question JSON</summary><label>Import document<Textarea value={json} onChange={e => { setJson(e.target.value); setPreview(null); }} rows={8} placeholder={'{"questions":[{"contentPackId":"…","sourceUnitId":"…","prompt":"…","kind":"ShortAnswer","parts":[{"acceptedAnswers":["…"],"points":1}],"ordered":false,"evidence":"…","reference":"…","version":1}]}'} /></label><Button variant="secondary" disabled={!json.trim()} onClick={() => { try { setPreview(parseQuestionImport(json)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Invalid JSON."); } }}>Validate preview</Button><p>The server validates all questions together before saving any drafts.</p></details>
    {preview && <div className="practice-editor"><h3>Preview · {preview.length} question(s)</h3>{preview.map((q, i) => <article key={i}><strong>{q.prompt}</strong><p>{q.reference} · {q.kind}</p><p>{q.evidence}</p><p>{q.parts?.map(part => `${part.acceptedAnswers?.join(" / ")} (${part.points} points)`).join("; ")}</p></article>)}<Button disabled={pending || !selectedSeason} onClick={() => void run(async () => { await practiceApi.import(org, selectedSeason, preview); setPreview(null); })}>Save validated drafts</Button></div>}
    <div className="practice-section-heading"><h3>Saved questions</h3><Badge>{seasonQuestions.length}</Badge></div>
    {seasonQuestions.length > 0 && <div className="practice-form"><label>Search questions<Input type="search" placeholder="Question or Scripture reference" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Question status<Select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All questions</option><option value="draft">Drafts</option><option value="published">Published</option></Select></label></div>}
    {!seasonQuestions.length && <p>No questions in this season yet. Create or import questions, review them, then publish.</p>}
    {seasonQuestions.length > 0 && !visibleQuestions.length && <p>No questions match your search and status. Try a different reference or choose All questions.</p>}
    {visibleQuestions.map(q => <details className="ds-disclosure" key={q.id}><summary>{q.question.prompt} · {q.published ? "Published" : "Draft"}</summary><p>{q.question.reference}</p><p>{q.question.evidence}</p><p>{q.question.parts.map(p => p.acceptedAnswers.join(" / ")).join(" · ")}</p><Badge>Version {q.question.version}</Badge><Button variant="ghost" disabled={pending} onClick={() => { const question = q.question; setIdentity({ id: question.id, version: question.version + 1 }); setPack(question.contentPackId); setUnit(question.sourceUnitId); setPrompt(question.prompt); setKind(question.kind); setParts(question.parts.map(part => ({ ...part, acceptedAnswers: [...part.acceptedAnswers] }))); setOrdered(question.ordered); setReference(question.reference); setEvidence(question.evidence); setPreview(null); if (editor.current) { editor.current.open = true; editor.current.scrollIntoView({ block: "start", behavior: "instant" }); } }}>Edit new version</Button>{!q.published && <Button variant="secondary" disabled={pending} onClick={() => void run(() => practiceApi.publish(org, q.id))}>Publish reviewed question</Button>}</details>)}
  </Panel>;
}
