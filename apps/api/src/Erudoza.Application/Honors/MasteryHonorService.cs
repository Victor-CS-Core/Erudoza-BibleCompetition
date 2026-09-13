using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Honors;

public sealed record MasteryHonorOption(string Key, string Title, string Requirement, string Category, string RuleVersion, DateTimeOffset? EarnedAtUtc);
public sealed record UserHonorProfile(Guid UserId, string DisplayName, string? AvatarHonorKey, IReadOnlyList<MasteryHonorOption> Honors, CharacterConfig Character, string AvatarKind, long CharacterVersion, CharacterShareOptions ShareOptions, CharacterSharePlacement[] SharePatches, bool CanUseMasterGuide);
public sealed record PublicHonorIdentity(Guid UserId, string? AvatarHonorKey, string AvatarKind, CharacterAppearance? Character);
public sealed class MasteryHonorLockedException(string message) : Exception(message);
public sealed record SaveHonorAvatar([property: System.Text.Json.Serialization.JsonRequired] string? HonorKey);

public sealed partial class MasteryHonorService(IErudozaDbContext db)
{
    public async Task<UserHonorProfile> ProfileAsync(Guid org, Guid user, CancellationToken ct)
    {
        var person = await (from u in db.Users.AsNoTracking() join m in db.OrganizationMembers.AsNoTracking() on u.Id equals m.UserId where u.Id == user && u.IsActive && m.OrganizationId == org select new { u.DisplayName, u.Kind, m.Role }).SingleOrDefaultAsync(ct)
            ?? throw new DomainException("Profile was not found.");
        var unlocks = await db.MasteryHonorUnlocks.AsNoTracking().Where(x => x.OrganizationId == org && x.UserId == user && (x.RuleVersion == MasteryHonorRules.Version || x.RuleVersion == SimulationHonorRules.Version)).ToListAsync(ct);
        var eligible = await SimulationEligibility(org, [user], ct);
        unlocks.RemoveAll(u => u.RuleVersion == SimulationHonorRules.Version && !eligible.Contains((u.UserId, u.Key)));
        var selected = await db.ProfileAvatarSelections.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user, ct);
        var avatarHonorKey = Avatar(selected, unlocks);
        var honors = MasteryHonorRules.Catalog.Concat(SimulationHonorRules.Catalog).Select(d => new MasteryHonorOption(d.Key, d.Title, d.Requirement, d.Category, Version(d.Key), unlocks.SingleOrDefault(x => x.Key == d.Key && x.RuleVersion == Version(d.Key))?.EarnedAtUtc)).ToArray();
        var canUseMasterGuide = person.Kind == UserKind.Adult && person.Role is OrganizationRole.Owner or OrganizationRole.Admin;
        var id = user.ToString();
        var record = await db.PbeTrainingRecords.AsNoTracking().SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == CharacterProfiles.Kind && r.Id == id && r.OwnerId == user, ct);
        var saved = CharacterProfiles.Read(record, user);
        var character = CharacterProfiles.Sanitize(saved, user, avatarHonorKey, honors.Where(h => h.EarnedAtUtc.HasValue).Select(h => h.Key).ToHashSet(StringComparer.Ordinal), canUseMasterGuide);
        return new(user, person.DisplayName, avatarHonorKey, honors, character.Character, character.AvatarKind, saved is null ? 0 : record!.Revision, character.ShareOptions, character.SharePatches, canUseMasterGuide);

    }

    public async Task<UserHonorProfile> SelectAsync(Guid org, Guid user, string? key, CancellationToken ct)
    {
        await SetSelectionAsync(org, user, key, ct);
        await AdvanceLegacyCharacterAsync(org, user, key, ct);
        await db.SaveChangesAsync(ct);
        return await ProfileAsync(org, user, ct);
    }

    private async Task SetSelectionAsync(Guid org, Guid user, string? key, CancellationToken ct)
    {
        if (!await db.OrganizationMembers.AnyAsync(m => m.OrganizationId == org && m.UserId == user, ct)) throw new DomainException("Profile was not found.");
        MasteryHonorUnlock? unlock = null;
        if (key is not null)
        {
            if (!MasteryHonorRules.Catalog.Concat(SimulationHonorRules.Catalog).Any(d => d.Key == key)) throw new DomainException("Choose an available mastery Honor.");
            if (Version(key) == SimulationHonorRules.Version && !(await SimulationEligibility(org, [user], ct)).Contains((user, key))) throw new MasteryHonorLockedException("This simulation Honor is not currently qualified.");
            var version = Version(key);
            unlock = await db.MasteryHonorUnlocks.SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user && x.Key == key && x.RuleVersion == version, ct)
                ?? throw new MasteryHonorLockedException("Earn this mastery Honor before using it as your profile image.");
        }
        var selection = await db.ProfileAvatarSelections.SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user, ct);
        if (selection is null)
        {
            if (unlock is null) return;
            selection = new() { OrganizationId = org, UserId = user };
            db.ProfileAvatarSelections.Add(selection);
        }
        selection.UnlockId = unlock?.Id; selection.HonorKey = unlock?.Key; selection.RuleVersion = unlock?.RuleVersion;
    }

    public async Task<IReadOnlyList<PublicHonorIdentity>> IdentitiesAsync(Guid org, IReadOnlyList<string> rawIds, CancellationToken ct)
    {
        if (rawIds.Count > 100 || rawIds.Any(x => x.Length != 36 || !Guid.TryParseExact(x, "D", out _))) throw new DomainException("Provide valid user IDs.");
        var ids = rawIds.Select(Guid.Parse).Distinct().ToArray();
        if (ids.Length > 50) throw new DomainException("Request no more than 50 identities.");
        var users = await db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.IsActive && db.OrganizationMembers.Any(m => m.OrganizationId == org && m.UserId == u.Id)).Select(u => u.Id).ToListAsync(ct);
        var selected = await db.ProfileAvatarSelections.AsNoTracking().Where(x => x.OrganizationId == org && users.Contains(x.UserId)).ToListAsync(ct);
        var proofIds = selected.Where(x => x.UnlockId.HasValue).Select(x => x.UnlockId!.Value).ToArray();
        var unlocks = await db.MasteryHonorUnlocks.AsNoTracking().Where(x => x.OrganizationId == org && proofIds.Contains(x.Id)).ToListAsync(ct);
        var eligible = await SimulationEligibility(org, users, ct);
        unlocks.RemoveAll(u => u.RuleVersion == SimulationHonorRules.Version && !eligible.Contains((u.UserId, u.Key)));
        var characterIds = users.Select(u => u.ToString()).ToArray();
        var characters = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.Kind == CharacterProfiles.Kind && characterIds.Contains(r.Id)).ToListAsync(ct);
        return users.Select(user => {
            var avatarHonorKey = Avatar(selected.SingleOrDefault(x => x.UserId == user), unlocks);
            var portrait = CharacterProfiles.Portrait(CharacterProfiles.Read(characters.SingleOrDefault(r => r.Id == user.ToString()), user), avatarHonorKey);
            return new PublicHonorIdentity(user, avatarHonorKey, portrait.Kind, portrait.Head);
        }).ToArray();
    }

    private static string Version(string? key) => key?.StartsWith("simulation:", StringComparison.Ordinal) == true ? SimulationHonorRules.Version : MasteryHonorRules.Version;
    private async Task<HashSet<(Guid, string)>> SimulationEligibility(Guid org, IReadOnlyList<Guid> users, CancellationToken ct)
    {
        var rows = await db.PbeTrainingRecords.AsNoTracking().Where(r => r.OrganizationId == org && r.Kind == "simulation-eligibility" && r.OwnerId.HasValue && users.Contains(r.OwnerId.Value)).ToListAsync(ct);
        return rows.Select(r => (r.OwnerId!.Value, JsonSerializer.Deserialize<JsonElement>(r.DataJson).GetProperty("key").GetString()!)).ToHashSet();
    }
    private static string? Avatar(ProfileAvatarSelection? selected, IReadOnlyList<MasteryHonorUnlock> unlocks) => selected is not null && selected.RuleVersion == Version(selected.HonorKey) && MasteryHonorRules.Catalog.Concat(SimulationHonorRules.Catalog).Any(d => d.Key == selected.HonorKey) && unlocks.Any(u => u.Id == selected.UnlockId && u.OrganizationId == selected.OrganizationId && u.UserId == selected.UserId && u.Key == selected.HonorKey && u.RuleVersion == selected.RuleVersion) ? selected.HonorKey : null;

    public async Task RecordAsync(Guid org, Guid user, Guid season, DateTimeOffset at, IEnumerable<MasteryQualification> qualifications, CancellationToken ct)
    {
        var existing = (await db.MasteryHonorUnlocks.Where(x => x.OrganizationId == org && x.UserId == user && x.RuleVersion == MasteryHonorRules.Version).Select(x => x.Key).ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
        foreach (var qualification in qualifications)
            if (existing.Add(qualification.Key)) db.MasteryHonorUnlocks.Add(new() { OrganizationId = org, UserId = user, SeasonId = season, Key = qualification.Key, RuleVersion = MasteryHonorRules.Version, EarnedAtUtc = at, EvidenceJson = qualification.EvidenceJson });
    }

    internal async Task ApplySoloAsync(StudySession session, Attempt attempt, ChallengeCard card, bool wasDue, IReadOnlyList<KnowledgeUnit> eligible, IReadOnlyList<MasteryState> states, CancellationToken ct)
    {
        var org = session.OrganizationId; var user = session.StudentUserId; var season = session.SeasonId;
        var ids = eligible.Select(x => x.Id).ToArray();
        var proofs = await db.MasteryPassageProofs.Where(x => x.OrganizationId == org && x.UserId == user && x.SeasonId == season && x.RuleVersion == MasteryHonorRules.Version && ids.Contains(x.KnowledgeUnitId)).ToListAsync(ct);
        var source = eligible.SingleOrDefault(x => x.Id == attempt.KnowledgeUnitId);
        var state = states.SingleOrDefault(x => x.KnowledgeUnitId == attempt.KnowledgeUnitId);
        var current = source is null || state is null ? null : Passage(source, state, null);
        if (!attempt.IsLegacyDuplicate && current is not null && MasteryHonorRules.MeetsStandard(current))
        {
            var proof = proofs.SingleOrDefault(x => x.KnowledgeUnitId == attempt.KnowledgeUnitId);
            if (proof is null)
            {
                proof = new() { OrganizationId = org, UserId = user, SeasonId = season, KnowledgeUnitId = attempt.KnowledgeUnitId, RuleVersion = MasteryHonorRules.Version };
                proofs.Add(proof); db.MasteryPassageProofs.Add(proof);
            }
            var frozen = session.TrainingJson is null ? null : JsonSerializer.Deserialize<SessionTrainingSnapshot>(session.TrainingJson, TrainingProgressService.Json);
            var due = frozen?.ReviewKnowledgeUnitIds.Count > 0 ? frozen.ReviewKnowledgeUnitIds.Contains(attempt.KnowledgeUnitId) : wasDue;
            var firstDue = session.Mode == StudyMode.Review && due && !await db.Attempts.AnyAsync(a => a.SessionId == session.Id && a.KnowledgeUnitId == attempt.KnowledgeUnitId && a.Id != attempt.Id && !a.IsLegacyDuplicate, ct);
            MasteryHonorRules.ObserveProof(proof, current, new(attempt.Id, attempt.CreatedAtUtc, attempt.IsCorrect, attempt.HintsUsed, attempt.IsLegacyDuplicate, card.AnswerMode, card.ActivityType, ActivitySerialization.ReadPayload(card.PayloadJson).Difficulty, firstDue, ActivitySerialization.ReadPayload(card.PayloadJson).EvidenceProfile));
        }
        var byId = states.ToDictionary(x => x.KnowledgeUnitId);
        var evidence = eligible.Select(k => Passage(k, byId.GetValueOrDefault(k.Id), proofs.SingleOrDefault(p => p.KnowledgeUnitId == k.Id))).ToArray();
        await RecordAsync(org, user, season, attempt.CreatedAtUtc, MasteryHonorRules.Solo(evidence), ct);
    }

    private static HonorPassage Passage(KnowledgeUnit unit, MasteryState? state, MasteryPassageProof? proof) => new(unit.Id, unit.SourceUnit!.BookKey, unit.SourceUnit.Chapter, state?.ExactWordingScore ?? 0, state?.ReferenceScore ?? 0, state?.RecognitionScore ?? 0, state?.AlgorithmVersion ?? "unknown", proof);
}
