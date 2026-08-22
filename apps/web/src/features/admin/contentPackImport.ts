export type ImportUnit = {
  citation: string;
  bookKey: string;
  chapter: number;
  verse: number;
  ordinal: number;
  text: string;
};

export type ImportDocument = {
  name: string;
  units: ImportUnit[];
};

export type ImportContentPackRequest = {
  packKey: string;
  version: number;
  locale: string;
  sourceType: string;
  documents: ImportDocument[];
};

export function sampleJoshuaPackJson(): string {
  return JSON.stringify(
    {
      packKey: "dev-joshua",
      version: 1,
      locale: "en",
      sourceType: "Scripture",
      documents: [
        {
          name: "Joshua",
          units: [
            {
              citation: "Joshua 1:1",
              bookKey: "JOS",
              chapter: 1,
              verse: 1,
              ordinal: 1,
              text: "Development sample: Joshua rose early.",
            },
            {
              citation: "Joshua 1:2",
              bookKey: "JOS",
              chapter: 1,
              verse: 2,
              ordinal: 2,
              text: "Development sample: Moses is mentioned as servant.",
            },
            {
              citation: "Joshua 1:3",
              bookKey: "JOS",
              chapter: 1,
              verse: 3,
              ordinal: 3,
              text: "Development sample: Every place your foot treads.",
            },
          ],
        },
      ],
    },
    null,
    2,
  );
}

export function parseContentPackImport(raw: string): ImportContentPackRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Paste valid JSON for a versioned content pack.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Paste valid JSON for a versioned content pack.");
  }

  const packKey = requiredString(parsed.packKey, "packKey");
  const version = requiredPositiveInt(parsed.version, "version");
  const locale = optionalString(parsed.locale) || "en";
  const sourceType = optionalString(parsed.sourceType) || "Scripture";
  const documentsRaw = parsed.documents;
  if (!Array.isArray(documentsRaw) || documentsRaw.length === 0) {
    throw new Error("A content pack needs at least one verse.");
  }

  const documents = documentsRaw.map((document, documentIndex) => {
    if (!isRecord(document)) {
      throw new Error(`Document ${documentIndex + 1} is invalid.`);
    }
    const unitsRaw = document.units;
    if (!Array.isArray(unitsRaw) || unitsRaw.length === 0) {
      throw new Error("A content pack needs at least one verse.");
    }
    return {
      name: requiredString(document.name, "document name"),
      units: unitsRaw.map((unit, unitIndex) => parseUnit(unit, unitIndex)),
    };
  });

  return { packKey, version, locale, sourceType, documents };
}

function parseUnit(unit: unknown, index: number): ImportUnit {
  if (!isRecord(unit)) {
    throw new Error(`Verse ${index + 1} is invalid.`);
  }
  const text = requiredString(unit.text, "verse text");
  return {
    citation: requiredString(unit.citation, "citation"),
    bookKey: requiredString(unit.bookKey, "bookKey"),
    chapter: requiredPositiveInt(unit.chapter, "chapter"),
    verse: requiredPositiveInt(unit.verse, "verse"),
    ordinal: requiredPositiveInt(unit.ordinal, "ordinal"),
    text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function requiredPositiveInt(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return number;
}
