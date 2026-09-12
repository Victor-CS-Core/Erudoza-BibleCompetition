import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { PassageRange, Season, TrainingDifficulty } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Badge, Button, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { RangeFields } from "../admin/SeasonWizardPage";
import { scopePacks, segmentRanges, withinRange } from "../admin/passageRanges";
import "./my-assignments.css";

const rangeLabel = (range: PassageRange) => `${range.bookKey} ${range.startChapter}:${range.startVerse}–${range.endChapter}:${range.endVerse}`;
const types = { PrimarySpecialist: "Specialist", RequiredCoverage: "Required coverage", OptionalReview: "Optional review" };
export function MyAssignmentsPage() {
  const { me } = useAuth();
  const allowed = me?.kind === "Adult" && (me.role === "Owner" || me.role === "Admin");
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ["seasons", me?.organizationId], queryFn: () => api.seasons(me!.organizationId), enabled: allowed });
  const requested = params.get("seasonId");
  const season = requested ? seasons.data?.find(item => item.id === requested) : seasons.data?.find(item => item.status === "Active") ?? seasons.data?.[0];
  useEffect(() => { if (!requested && season) setParams({ seasonId: season.id }, { replace: true }); }, [requested, season, setParams]);
  if (!allowed) return <Navigate to="/student" replace />;
  return <div className="training-page assignment-overview">
    <PageHeader title="My assignments" description="Choose passages from an existing season for your own training." action={<LinkButton variant="secondary" to={`/student${season ? `?seasonId=${encodeURIComponent(season.id)}` : ""}`}>Back to Training HQ</LinkButton>} />
    {seasons.isPending && <LoadingState label="Loading seasons…" />}
    {seasons.isError && <Notice tone="danger">Unable to load seasons. <Button onClick={() => void seasons.refetch()}>Try again</Button></Notice>}
    {!!seasons.data?.length && <label>Season<Select value={season?.id ?? ""} onChange={event => setParams({ seasonId: event.target.value })}>{!season && <option value="">Choose a season</option>}{seasons.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
    {seasons.data?.length === 0 && <Panel><p>No seasons are available. Set up a season in Coach mode, then return here to choose your passages.</p></Panel>}
    {!!seasons.data?.length && requested && !season && <Notice tone="danger">This season is unavailable. Choose another season.</Notice>}
    {season && <PersonalAssignmentEditor key={season.id} season={season} />}
  </div>;
}
function PersonalAssignmentEditor({ season }: { season: Season }) {
  const { me } = useAuth();
  const org = me!.organizationId;
  const cache = useQueryClient();
  const [packId, setPackId] = useState("");
  const [choice, setChoice] = useState("0");
  const [custom, setCustom] = useState<PassageRange | null>(null);
  const [type, setType] = useState("PrimarySpecialist");
  const [difficulty, setDifficulty] = useState<TrainingDifficulty>("Standard");
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const scope = useQuery({ queryKey: ["season-scope", org, season.id], queryFn: () => api.seasonScope(org, season.id) });
  const assignments = useQuery({ queryKey: ["my-assignments", org, me!.userId, season.id], queryFn: () => api.myAssignments(org, season.id) });
  const packs = scopePacks(scope.data);
  const pack = packs.find(item => item.contentPackId === packId) ?? packs[0];
  const source = useQuery({ queryKey: ["source-units", org, pack?.contentPackId], queryFn: () => api.sourceUnits(org, pack!.contentPackId), enabled: !!pack });
  const allUnits = source.data ?? [];
  const units = pack ? allUnits.filter(unit => pack.includes.some(range => withinRange(unit, range)) && !pack.excludes.some(range => withinRange(unit, range))) : [];
  const ranges = segmentRanges(units, allUnits);
  const range = choice === "custom" ? custom ?? ranges[0] : ranges[Number(choice)] ?? ranges[0];
  const closed = season.status === "Completed" || season.status === "Archived";
  const refresh = async () => { await Promise.all(["my-assignments", "assigned-seasons", "progress", "training-today", "training-honors", "training-journey"].map(key => cache.invalidateQueries({ queryKey: [key] }))); };
  const add = useMutation({ mutationFn: () => api.assignMyself(org, season.id, { contentPackId: pack!.contentPackId, range: range!, type, difficulty }), onSuccess: async () => { setMessage("Assignment saved."); await refresh(); } });
  const remove = useMutation({ mutationFn: (id: string) => api.removeMyAssignment(org, season.id, id), onSuccess: async () => { setRemoving(null); setMessage("Assignment removed."); await refresh(); } });
  const pending = add.isPending || remove.isPending;
  const duplicate = assignments.data?.some(item => item.type === type && item.contentPackId === pack?.contentPackId && range && rangeLabel(item) === rangeLabel(range));
  return <>
    {message && <Notice tone="success">{message}</Notice>}
    {closed && <Notice>This season is closed. Your assignments and saved progress remain available.</Notice>}
    {!closed && <Panel><h2>Add a passage</h2>
      {scope.isPending || (pack && source.isPending) ? <LoadingState label="Loading permitted passages…" /> : null}
      {(scope.isError || source.isError) && <Notice tone="danger">Unable to load permitted passages. <Button onClick={() => { void scope.refetch(); void source.refetch(); }}>Try again</Button></Notice>}
      {scope.isSuccess && !packs.length && <Notice>This season has no permitted passages yet.</Notice>}
      <form className="my-assignment-form" onSubmit={event => { event.preventDefault(); if (range && pack && !pending) { setMessage(""); add.mutate(); } }}>
        <fieldset disabled={pending} className="assignment-context">
          {packs.length > 1 && <label>Book<Select value={pack?.contentPackId ?? ""} onChange={event => { setPackId(event.target.value); setChoice("0"); setCustom(null); }}>{packs.map(item => <option key={item.contentPackId} value={item.contentPackId}>{item.includes[0]?.bookKey ?? "Passages"}</option>)}</Select></label>}
          <label>Passage<Select value={choice} onChange={event => { setChoice(event.target.value); setCustom(null); }}>{ranges.map((item, index) => <option key={index} value={index}>{rangeLabel(item)}</option>)}{!!ranges.length && <option value="custom">Choose a chapter or verse range</option>}</Select></label>
          <label>Assignment type<Select value={type} onChange={event => setType(event.target.value)}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></label>
          <label>Training difficulty<Select value={difficulty} onChange={event => setDifficulty(event.target.value as TrainingDifficulty)}>{["Foundation", "Standard", "Advanced"].map(value => <option key={value}>{value}</option>)}</Select></label>
        </fieldset>
        {choice === "custom" && range && <RangeFields prefix="my-assignment" label="My passage" range={range} onChange={setCustom} units={units} allUnits={allUnits} />}
        {add.isError && <Notice tone="danger">{add.error.message || "Unable to save your assignment."}</Notice>}
        {duplicate && <Notice>This passage already has this assignment type.</Notice>}
        <Button type="submit" disabled={pending || !range || !pack || !assignments.isSuccess || !!duplicate}>{add.isPending ? "Saving…" : "Add assignment"}</Button>
      </form>
    </Panel>}
    <Panel><h2>Assigned passages</h2>
      {assignments.isPending && <LoadingState label="Loading your assignments…" />}
      {assignments.isError && <Notice tone="danger">Unable to load assignments. <Button onClick={() => void assignments.refetch()}>Try again</Button></Notice>}
      {assignments.data?.length === 0 && <p>{closed ? "No personal assignments were added to this season." : "No personal assignments yet. Choose a passage above to start training."}</p>}
      {assignments.data?.map(item => <div key={item.id} className="my-assignment-row"><div><strong>{rangeLabel(item)}</strong><p>{types[item.type as keyof typeof types] ?? item.type} · <Badge>{item.difficulty}</Badge></p></div>{!closed && <Button variant="secondary" size="compact" disabled={pending} onClick={() => { remove.reset(); setRemoving(item.id); }}>Remove assignment<span className="sr-only"> {rangeLabel(item)}</span></Button>}</div>)}
    </Panel>
    {removing && <ConfirmationDialog title="Remove assignment?" description="This removes the passage from your current training plan. Saved attempts remain in your history." confirmLabel="Remove assignment" pending={remove.isPending} error={remove.error?.message} onCancel={() => setRemoving(null)} onConfirm={() => remove.mutate(removing)} />}
  </>;
}
