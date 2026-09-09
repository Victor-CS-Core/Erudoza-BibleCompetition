import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import type { ContentPack } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { PaperSurface } from "../../components/material/PaperSurface";
import { CoachFieldGuideCover } from "./academyCover";
import { parseContentPackImport, sampleJoshuaPackJson } from "./contentPackImport";

export function ContentPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translationId, setTranslationId] = useState("web");
  const [catalogBook, setCatalogBook] = useState("DAN");
  const [catalogStart, setCatalogStart] = useState(1);
  const [catalogEnd, setCatalogEnd] = useState(1);
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
  const catalog = useQuery({
    queryKey: ["scripture-catalog", me?.organizationId],
    queryFn: () => api.scriptureCatalog(me!.organizationId),
    enabled: !!me,
  });
  const importCatalog = useMutation({
    mutationFn: () =>
      api.importFromCatalog(me!.organizationId, {
        translationId,
        bookKey: catalogBook,
        startChapter: catalogStart,
        endChapter: catalogEnd,
      }),
    onSuccess: (pack) => {
      setError(null);
      setSelectedPackId(pack.id);
      void queryClient.invalidateQueries({ queryKey: ["packs"] });
      void queryClient.invalidateQueries({ queryKey: ["source-units"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to import translation."),
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
      <CoachFieldGuideCover organizationName={me?.organizationName} />
      <PaperSurface>
        <h1 className="text-2xl font-semibold">Content packs</h1>
        <p className="mt-2 text-sm text-[var(--er-graphite)]">
          Import only text this organization is licensed to store. The catalog below is public-domain English text.
          Copyrighted translations such as NIV or ESV are not fetched or bundled.
        </p>
        <ul className="mt-4 space-y-2">
          {packs.data?.map((pack) => (
            <li key={pack.id}>
              <PackButton pack={pack} selected={selectedPackId === pack.id} onSelect={() => setSelectedPackId(pack.id)} />
            </li>
          ))}
        </ul>
        {packs.data && packs.data.length === 0 ? (
          <p className="mt-4 text-[var(--er-graphite)]">No content packs yet.</p>
        ) : null}
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
        <h2 className="text-xl font-semibold">Import a public-domain translation</h2>
        <p className="mt-2 text-sm text-[var(--er-muted-ink)]">
          Stored verses become the season pack. Study games use that text directly, so OpenAI never writes Scripture.
        </p>
        <form
          className="mt-4 grid gap-3 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            importCatalog.mutate();
          }}
        >
          <label className="text-sm font-medium">
            Translation
            <select
              data-testid="catalog-translation"
              className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3"
              value={translationId}
              onChange={(event) => setTranslationId(event.target.value)}
            >
              {catalog.data?.translations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Book
            <select
              data-testid="catalog-book"
              className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3"
              value={catalogBook}
              onChange={(event) => setCatalogBook(event.target.value)}
            >
              {catalog.data?.books.map((item) => (
                <option key={item.bookKey} value={item.bookKey}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Start chapter
            <input
              data-testid="catalog-start-chapter"
              type="number"
              min={1}
              className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3"
              value={catalogStart}
              onChange={(event) => setCatalogStart(Number(event.target.value))}
            />
          </label>
          <label className="text-sm font-medium">
            End chapter
            <input
              data-testid="catalog-end-chapter"
              type="number"
              min={1}
              className="mt-1 w-full rounded-[var(--er-radius-control)] border px-3"
              value={catalogEnd}
              onChange={(event) => setCatalogEnd(Number(event.target.value))}
            />
          </label>
          <button
            data-testid="import-catalog-submit"
            className="rounded-[var(--er-radius-control)] bg-[var(--er-ink-navy)] px-4 text-[var(--er-card)] md:col-span-4"
            type="submit"
            disabled={importCatalog.isPending}
          >
            Import translation
          </button>
        </form>
      </PaperSurface>
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
