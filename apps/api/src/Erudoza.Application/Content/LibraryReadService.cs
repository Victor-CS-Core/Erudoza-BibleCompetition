using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Content;

public sealed class LibraryReadService(IErudozaDbContext db)
{
    public async Task<LibraryDto?> GetAsync(CancellationToken ct)
    {
        var packs = await db.ContentPacks.AsNoTracking().Include(p => p.Documents)
            .Where(p => p.OrganizationId == BuiltInLibrary.OrganizationId && p.IsBuiltIn && p.IsActive && p.Version == BuiltInLibrary.Version)
            .ToListAsync(ct);
        if (packs.Count != 66) return null;
        var ids = packs.Select(p => p.Id).ToArray();
        var units = await db.SourceUnits.AsNoTracking()
            .Where(u => u.OrganizationId == BuiltInLibrary.OrganizationId && ids.Contains(u.ContentPackId) && u.IsActive && !u.IsRetired)
            .Select(u => new { u.ContentPackId, u.BookKey, u.Chapter, u.Verse }).ToListAsync(ct);
        var books = new List<LibraryBookDto>();
        foreach (var key in BuiltInLibrary.BookKeys)
        {
            var pack = packs.SingleOrDefault(p => p.Id == BuiltInLibrary.StableId("book:" + key));
            var verses = units.Where(u => u.ContentPackId == pack?.Id).ToList();
            if (pack is null || verses.Count == 0 || verses.Any(u => u.BookKey != key)) return null;
            books.Add(new(pack.Id, key, pack.Documents.Single().Name, verses.Count,
                verses.GroupBy(u => u.Chapter).OrderBy(g => g.Key)
                    .Select(g => new LibraryChapterDto(g.Key, g.Select(u => u.Verse).Order().ToArray())).ToArray()));
        }
        return new(BuiltInLibrary.TranslationId, BuiltInLibrary.TranslationName, BuiltInLibrary.Version, books);
    }
}
