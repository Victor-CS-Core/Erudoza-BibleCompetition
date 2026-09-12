using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Study;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Honors;

public sealed record MasteryHonorOption(string Key, string Title, string Requirement, string Category, string RuleVersion, DateTimeOffset? EarnedAtUtc);
public sealed record UserHonorProfile(Guid UserId, string DisplayName, string? AvatarHonorKey, IReadOnlyList<MasteryHonorOption> Honors);
public sealed record PublicHonorIdentity(Guid UserId, string? AvatarHonorKey);
public sealed class MasteryHonorLockedException(string message) : Exception(message);
public sealed record SaveHonorAvatar([property: System.Text.Json.Serialization.JsonRequired] string? HonorKey);

public sealed class MasteryHonorService(IErudozaDbContext db)
{
    public async Task<UserHonorProfile> ProfileAsync(Guid org, Guid user, CancellationToken ct)
    {
        var person = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == user && u.IsActive && db.OrganizationMembers.Any(m => m.OrganizationId == org && m.UserId == user), ct)
            ?? throw new DomainException("Profile was not found.");
        var unlocks = await db.MasteryHonorUnlocks.AsNoTracking().Where(x => x.OrganizationId == org && x.UserId == user && x.RuleVersion == MasteryHonorRules.Version).ToListAsync(ct);
        var selected = await db.ProfileAvatarSelections.AsNoTracking().SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user, ct);
        return new(user, person.DisplayName, Avatar(selected, unlocks), MasteryHonorRules.Catalog.Select(d => new MasteryHonorOption(d.Key, d.Title, d.Requirement, d.Category, MasteryHonorRules.Version, unlocks.SingleOrDefault(x => x.Key == d.Key)?.EarnedAtUtc)).ToArray());
    }

    public async Task<UserHonorProfile> SelectAsync(Guid org, Guid user, string? key, CancellationToken ct)
    {
        if (!await db.OrganizationMembers.AnyAsync(m => m.OrganizationId == org && m.UserId == user, ct)) throw new DomainException("Profile was not found.");
        MasteryHonorUnlock? unlock = null;
        if (key is not null)
        {
            if (!MasteryHonorRules.Catalog.Any(d => d.Key == key)) throw new DomainException("Choose an available mastery Honor.");
            unlock = await db.MasteryHonorUnlocks.SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user && x.Key == key && x.RuleVersion == MasteryHonorRules.Version, ct)
                ?? throw new MasteryHonorLockedException("Earn this mastery Honor before using it as your profile image.");
        }
        var selection = await db.ProfileAvatarSelections.SingleOrDefaultAsync(x => x.OrganizationId == org && x.UserId == user, ct);
        if (selection is null)
        {
            if (unlock is null) return await ProfileAsync(org, user, ct);
            selection = new() { OrganizationId = org, UserId = user };
            db.ProfileAvatarSelections.Add(selection);
        }
        selection.UnlockId = unlock?.Id; selection.HonorKey = unlock?.Key; selection.RuleVersion = unlock?.RuleVersion;
        await db.SaveChangesAsync(ct);
        return await ProfileAsync(org, user, ct);
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
        return users.Select(user => new PublicHonorIdentity(user, Avatar(selected.SingleOrDefault(x => x.UserId == user), unlocks))).ToArray();
    }

    private static string? Avatar(ProfileAvatarSelection? selected, IReadOnlyList<MasteryHonorUnlock> unlocks) => selected is not null && selected.RuleVersion == MasteryHonorRules.Version && MasteryHonorRules.Catalog.Any(d => d.Key == selected.HonorKey) && unlocks.Any(u => u.Id == selected.UnlockId && u.OrganizationId == selected.OrganizationId && u.UserId == selected.UserId && u.Key == selected.HonorKey && u.RuleVersion == selected.RuleVersion) ? selected.HonorKey : null;

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
