import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { ContentPack } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { PaperSurface } from "../../components/material/PaperSurface";
import { parseContentPackImport, sampleJoshuaPackJson } from "./contentPackImport";

export function ContentPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const packs = useQuery({
    queryKey: ["packs", me?.organizationId],
    queryFn: () => api.contentPacks(me!.organizationId),
    enabled: !!me,
  });
  const units = useQuery({
    queryKey: ["source-units", me?.organizationId, selectedPackId],
    queryFn: () => api.sourceUnits(me!.organizationId, selectedPackId!),
    enabled: !!me && !!selectedPackId,
  });
  const importPack = useMutation({
    mutationFn: (body: ReturnType<typeof parseContentPackImport>) => api.importContentPack(me!.organizationId, body),
    onSuccess: (pack) => {
      setError(null);
      setSelectedPackId(pack.id);
      void queryClient.invalidateQueries({ queryKey: ["packs"] });
      void queryClient.invalidateQueries({ queryKey: ["source-units"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to import pack."),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      importPack.mutate(parseContentPackImport(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import pack.");
    }
  };

  return (
    <div className="space-y-4">
      <PaperSurface>
        <h1 className="text-2xl font-semibold">Content packs</h1>
        <p className="mt-2 text-sm text-[var(--er-graphite)]">
          Import only text this organization is licensed to store. Development samples are synthetic and are not a
          copyrighted Bible translation.
        </p>
        <ul className="mt-4 space-y-2">
          {packs.data?.map((pack) => (
            <li key={pack.id}>
              <PackButton pack={pack} selected={selectedPackId === pack.id} onSelect={() => setSelectedPackId(pack.id)} />
            </li>
          ))}
        </ul>
      </PaperSurface>
      {selectedPackId ? (
        <PaperSurface>
          <h2 className="text-xl font-semibold">Stored verses</h2>
          <ul className="mt-4 space-y-3" data-testid="source-unit-list">
            {units.data?.map((unit) => (
              <li key={unit.id} className="border-t border-[var(--er-border)] pt-3">
                <p className="font-medium">{unit.citation}</p>
                <p className="er-scripture mt-1 text-sm">{unit.canonicalText}</p>
              </li>
            ))}
          </ul>
        </PaperSurface>
      ) : null}
      <PaperSurface>
        <h2 className="text-xl font-semibold">Import a versioned pack</h2>
        <p className="mt-2 text-sm text-[var(--er-muted-ink)]">
          Changed wording needs a new version. Re-importing the same pack key, version, and hashes is idempotent.
        </p>
        <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
          <label className="text-sm font-medium">
            Pack JSON
            <textarea
              data-testid="import-pack-json"
              className="mt-1 min-h-48 w-full rounded-[var(--er-radius-control)] border border-[var(--er-border)] px-3 py-2 font-mono text-sm"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="load-sample-pack"
              className="rounded-[var(--er-radius-control)] border px-4"
              onClick={() => setDraft(sampleJoshuaPackJson())}
            >
              Load sample pack
            </button>
            <button
              type="submit"
              data-testid="import-pack-submit"
              className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-4 text-[var(--er-card)]"
              disabled={importPack.isPending}
            >
              Import pack
            </button>
          </div>
          {error ? (
            <p className="text-sm text-[var(--er-stamp-red)]" data-testid="import-pack-error">
              {error}
            </p>
          ) : null}
        </form>
      </PaperSurface>
    </div>
  );
}

function PackButton({
  pack,
  selected,
  onSelect,
}: {
  pack: ContentPack;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="content-pack"
      className={`w-full rounded-[var(--er-radius-control)] border px-3 py-3 text-left ${
        selected ? "border-[var(--er-ink-navy)] bg-[var(--er-parchment)]" : "border-[var(--er-border)]"
      }`}
      onClick={onSelect}
    >
      {pack.packKey} v{pack.version} · {pack.unitCount} units · {pack.licensingStatus}
    </button>
  );
}
