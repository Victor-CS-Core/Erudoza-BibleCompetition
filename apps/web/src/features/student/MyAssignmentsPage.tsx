import { useEffect, useState } from "react";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Button, LinkButton, LoadingState, Notice, PageHeader, Panel, Select } from "../../components/ui";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { BookAssignmentEditor } from "../admin/BookAssignmentEditor";
import "./my-assignments.css";

export function MyAssignmentsPage() {
  const { me } = useAuth();
  const allowed = me?.kind === "Adult" && (me.role === "Owner" || me.role === "Admin");
  const [params, setParams] = useSearchParams();
  const seasons = useQuery({ queryKey: ["seasons", me?.organizationId], queryFn: () => api.seasons(me!.organizationId), enabled: allowed });
  const [dirty, setDirty] = useState(false);
  const [pendingSeason, setPendingSeason] = useState<string | null>(null);
  const busy = useIsMutating() > 0;
  const requested = params.get("seasonId");
  const season = requested ? seasons.data?.find(item => item.id === requested) : seasons.data?.find(item => item.status === "Active") ?? seasons.data?.[0];
  useEffect(() => { if (!requested && season) setParams({ seasonId: season.id }, { replace: true }); }, [requested, season, setParams]);
  if (!allowed) return <Navigate to="/student" replace />;
  return <div className="training-page assignment-overview">
    <PageHeader title="My assignments" description="Choose season books for your activities in Student Mode." action={<LinkButton variant="secondary" to={`/student${season ? `?seasonId=${encodeURIComponent(season.id)}` : ""}`}>Back to Training HQ</LinkButton>} />
    {seasons.isPending && <LoadingState label="Loading seasons…" />}
    {seasons.isError && <Notice tone="danger">Unable to load seasons. <Button onClick={() => void seasons.refetch()}>Try again</Button></Notice>}
    {!!seasons.data?.length && <label>Season<Select disabled={busy} value={season?.id ?? ""} onChange={event => { if (dirty) setPendingSeason(event.target.value); else setParams({ seasonId: event.target.value }); }}>{!season && <option value="">Choose a season</option>}{seasons.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
    {seasons.data?.length === 0 && <Panel><p>No seasons are available. Set up a season in Coach mode, then return here to choose your passages.</p></Panel>}
    {!!seasons.data?.length && requested && !season && <Notice tone="danger">This season is unavailable. Choose another season.</Notice>}
    {season && <Panel><BookAssignmentEditor key={season.id} season={season} studentId={me!.userId} name="My study books" showTrainingLink={false} onDirtyChange={setDirty} /></Panel>}
    {pendingSeason && <ConfirmationDialog title="Discard unsaved assignments?" description="Saved assignments are preserved. Unsaved book choices will be cleared." confirmLabel="Discard changes" onCancel={() => setPendingSeason(null)} onConfirm={() => { setDirty(false); setParams({ seasonId: pendingSeason }); setPendingSeason(null); }} />}
  </div>;
}
