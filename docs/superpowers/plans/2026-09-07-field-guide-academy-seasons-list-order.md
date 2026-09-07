# Field Guide Academy Seasons List Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `GET /organizations/{orgId}/seasons` from 500ing on SQLite by sorting `CreatedAtUtc` in memory.

**Architecture:** Keep the existing endpoint and `SeasonDto` mapping. Load org seasons with EF, then `OrderByDescending(CreatedAtUtc)` in LINQ-to-Objects — the same pattern as progress recent attempts and question review lists.

**Tech Stack:** ASP.NET Core, EF Core SQLite, xUnit / FluentAssertions, existing `ErudozaApiFactory`.

## Global Constraints

- Smallest change. Spec-first. No gold-plating.
- Same request, same `SeasonDto` shape. No auth / study-session / idempotency / tenant contract changes.
- Keep Playwright testid `create-season` and API modes Practice / Review / Simulation.
- Cloud only. No deploy, DNS, live Firebase, paid resources, secrets, NKJV upload.

---

### Task 1: Fail GET /seasons on SQLite ORDER BY

**Files:**
- Modify: `apps/api/tests/Erudoza.IntegrationTests/SeasonStudyAndContentTests.cs`
- Modify: `apps/api/src/Erudoza.Api/Endpoints/ApiEndpoints.cs`

**Interfaces:**
- Consumes: existing `GET /api/v1/organizations/{orgId}/seasons` and `SeasonDto`
- Produces: HTTP 200 with newest-first `SeasonDto[]`

- [x] **Step 1: Write the failing test**

```csharp
[Fact]
public async Task Admin_can_list_seasons_newest_first_on_sqlite()
{
    var admin = await TestHttp.LoginAsync(factory, "admin@erudoza.local", "DevAdmin!234");
    var older = await admin.PostAsJsonAsync(
        $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
        new { name = "Older List Season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
    older.EnsureSuccessStatusCode();
    var newer = await admin.PostAsJsonAsync(
        $"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons",
        new { name = "Newer List Season", yearLabel = "2026", ruleProfileKey = "PBE_STYLE_V1" });
    newer.EnsureSuccessStatusCode();

    var response = await admin.GetAsync($"/api/v1/organizations/{SeedIdentifiers.OrganizationId}/seasons");
    response.StatusCode.Should().Be(HttpStatusCode.OK);
    var seasons = await response.Content.ReadFromJsonAsync<List<SeasonDto>>();
    seasons.Should().NotBeNull();
    var listed = seasons!.Where(item => item.Name is "Older List Season" or "Newer List Season").Select(item => item.Name).ToList();
    listed.Should().Equal("Newer List Season", "Older List Season");
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `dotnet test apps/api/tests/Erudoza.IntegrationTests/Erudoza.IntegrationTests.csproj --filter FullyQualifiedName~Admin_can_list_seasons_newest_first_on_sqlite`

Expected: FAIL with HTTP 500 — SQLite cannot `ORDER BY DateTimeOffset`.

- [x] **Step 3: Write minimal implementation**

In `ApiEndpoints.cs` `GET /seasons`, load then sort:

```csharp
var seasons = (await db.Seasons.AsNoTracking()
    .Where(item => item.OrganizationId == orgId)
    .ToListAsync(cancellationToken))
    .OrderByDescending(item => item.CreatedAtUtc)
    .ToList();
```

- [x] **Step 4: Run test to verify it passes**

Run the same filter. Expected: PASS.

- [x] **Step 5: Brand-guide sentence**

Add that the coach seasons folio lists newest-first in memory so SQLite is not asked to order `DateTimeOffset`.

- [ ] **Step 6: Verification**

Run `npm run test:web`, `npm run typecheck:web`, `npm run lint:web`, and the seasons-list API test.
