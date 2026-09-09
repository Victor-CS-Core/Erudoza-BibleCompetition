import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { PaperSurface } from "../../components/material/PaperSurface";
import { SeasonStatusBadge } from "./SeasonStatusBadge";

export function AdminHomePage() {
  const { me } = useAuth();
  const org = useQuery({
    queryKey: ["org", me?.organizationId],
    queryFn: () => api.organization(me!.organizationId),
    enabled: !!me,
  });
  const seasons = useQuery({
    queryKey: ["seasons", me?.organizationId],
    queryFn: () => api.seasons(me!.organizationId),
    enabled: !!me,
  });

  return (
    <div className="space-y-5">
      <FieldGuideCover folio>
        <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="organization-name">
          {org.data?.name ?? me?.organizationName}
        </p>
        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-[var(--er-muted-ink)]">
          Season readiness
        </h2>
        <ul className="mt-2 space-y-2" data-testid="season-readiness-folio">
          {seasons.data?.map((season) => (
            <li key={season.id} className="er-season-row">
              <span>{season.name}</span>
              <SeasonStatusBadge status={season.status} />
            </li>
          ))}
          {seasons.data && seasons.data.length === 0 ? (
            <li className="text-[var(--er-graphite)]">No seasons yet.</li>
          ) : null}
        </ul>
      </FieldGuideCover>
      <PaperSurface>
        <h2 className="text-xl font-semibold">Seasons</h2>
        <p className="er-seasons-lede">
          Create and manage seasons to guide learning, track progress, and grow with purpose.
        </p>
        <ul className="mt-4 space-y-2">
          {seasons.data?.map((season) => (
            <li key={season.id}>
              <Link className="er-season-card" to={`/admin/seasons/${season.id}`}>
                <span>{season.name}</span>
                <SeasonStatusBadge status={season.status} />
              </Link>
            </li>
          ))}
        </ul>
        {seasons.data && seasons.data.length === 0 ? (
          <p className="mt-4 text-[var(--er-graphite)]">No seasons yet.</p>
        ) : null}
        <Link to="/admin/seasons/new" data-testid="create-season" className="er-create-season">
          <span className="er-create-season-mark" aria-hidden="true">
            +
          </span>
          <span className="er-create-season-copy">
            <strong>Create season</strong>
            <span>Start a new season</span>
          </span>
        </Link>
      </PaperSurface>
    </div>
  );
}
