import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { FieldGuideCover } from "../../components/material/FieldGuideCover";
import { PaperSurface } from "../../components/material/PaperSurface";

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
      <FieldGuideCover>
        <p className="mt-2 text-[var(--er-muted-ink)]" data-testid="organization-name">
          {org.data?.name ?? me?.organizationName}
        </p>
        <h2 className="mt-5 text-sm font-semibold uppercase tracking-wide text-[var(--er-muted-ink)]">
          Season readiness
        </h2>
        <ul className="mt-2 space-y-2" data-testid="season-readiness-folio">
          {seasons.data?.map((season) => (
            <li key={season.id} className="flex items-center justify-between gap-3 border-t border-[var(--er-border)] pt-2">
              <span>{season.name}</span>
              <span>{season.status}</span>
            </li>
          ))}
        </ul>
      </FieldGuideCover>
      <PaperSurface>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Seasons</h2>
          <Link
            to="/admin/seasons/new"
            data-testid="create-season"
            className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-4 text-[var(--er-card)]"
          >
            Create season
          </Link>
        </div>
        <ul className="mt-4 space-y-2">
          {seasons.data?.map((season) => (
            <li key={season.id}>
              <Link className="text-[var(--er-action-blue)]" to={`/admin/seasons/${season.id}`}>
                {season.name} · {season.status}
              </Link>
            </li>
          ))}
        </ul>
      </PaperSurface>
    </div>
  );
}
