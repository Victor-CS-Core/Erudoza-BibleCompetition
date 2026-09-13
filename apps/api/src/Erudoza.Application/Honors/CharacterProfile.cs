using System.Text.Json;
using System.Text.Json.Serialization;
using Erudoza.Domain;
using Erudoza.Domain.Study;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Honors;

public sealed record CharacterAppearance(string BodyType, string Style, string HairColor, string Skin, string Eyes);
public sealed record CharacterConfig(
    [property: JsonRequired] string BodyType, [property: JsonRequired] string Style,
    [property: JsonRequired] string HairColor, [property: JsonRequired] string Skin, [property: JsonRequired] string Eyes,
    [property: JsonRequired] string Attire, [property: JsonRequired] string Background, [property: JsonRequired] string?[] Slots);
public sealed record CharacterShareOptions([property: JsonRequired] bool ShowName, [property: JsonRequired] bool ShowBrand, [property: JsonRequired] bool ShowQR);
public sealed record CharacterSharePlacement([property: JsonRequired] string Key, [property: JsonRequired] double X, [property: JsonRequired] double Y, [property: JsonRequired] double Size, [property: JsonRequired] double Rotation);
public sealed record SaveCharacterProfile(
    [property: JsonRequired] long Version, [property: JsonRequired] CharacterConfig Character,
    [property: JsonRequired] string AvatarKind, [property: JsonRequired] string? AvatarHonorKey,
    [property: JsonRequired] CharacterShareOptions ShareOptions, [property: JsonRequired] CharacterSharePlacement[] SharePatches);
public sealed record CharacterProfileState(Guid UserId, CharacterConfig Character, string AvatarKind, CharacterShareOptions ShareOptions, CharacterSharePlacement[] SharePatches);
public sealed class CharacterProfileConflictException() : Exception("Your profile changed elsewhere. Reload it before saving again.");

internal static class CharacterProfiles
{
    internal const string Kind = "profile-character";
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    static readonly HashSet<string> HonorKeys = MasteryHonorRules.Catalog.Concat(SimulationHonorRules.Catalog).Select(h => h.Key).ToHashSet(StringComparer.Ordinal);
    internal static CharacterConfig DefaultCharacter() => new("male", "curls", "brown", "medium", "brown", "student", "sunrise", [null, null, null]);
    internal static CharacterShareOptions DefaultOptions() => new(true, true, true);
    static bool In(string? value, params string[] choices) => value is not null && choices.Contains(value, StringComparer.Ordinal);
    internal static bool AppearanceValid(CharacterConfig? c) => c is not null
        && (c.BodyType == "male" && In(c.Style, "curls", "side-part", "quiff", "buzz", "waves", "locs") || c.BodyType == "female" && In(c.Style, "curly-bob", "straight-bob", "ponytail", "braids", "natural-curls", "low-bun"))
        && In(c.HairColor, "red", "black", "brown", "blond") && In(c.Skin, "light", "medium", "deep") && In(c.Eyes, "brown", "hazel", "blue");
    static bool ConfigValid(CharacterConfig? c) => AppearanceValid(c) && In(c!.Attire, "student", "coach") && In(c.Background, "sunrise", "basecamp", "starlight")
        && c.Slots is { Length: 3 } && c.Slots.All(k => k is null || HonorKeys.Contains(k)) && c.Slots.Where(k => k is not null).Distinct(StringComparer.Ordinal).Count() == c.Slots.Count(k => k is not null);
    static bool Bounded(double number, double min, double max) => double.IsFinite(number) && number >= min && number <= max;
    static bool PlacementValid(CharacterSharePlacement? p) => p is not null && HonorKeys.Contains(p.Key) && Bounded(p.X, 0, 1200) && Bounded(p.Y, 0, 1600) && Bounded(p.Size, 144, 336) && Bounded(p.Rotation, -180, 180);
    internal static void Validate(SaveCharacterProfile input, IReadOnlySet<string> earned, bool canUseMasterGuide)
    {
        if (input.Version < 0 || input.Version >= 9007199254740991 || !ConfigValid(input.Character) || input.ShareOptions is null || !In(input.AvatarKind, "initials", "honor", "character")
            || input.AvatarHonorKey is not null && !HonorKeys.Contains(input.AvatarHonorKey) || input.AvatarKind == "honor" && input.AvatarHonorKey is null
            || input.SharePatches is null || input.SharePatches.Length > HonorKeys.Count || !input.SharePatches.All(PlacementValid)
            || input.SharePatches.Select(p => p.Key).Distinct(StringComparer.Ordinal).Count() != input.SharePatches.Length)
            throw new DomainException("Choose valid character, avatar and sharing options.");
        if (input.Character.Attire == "coach" && !canUseMasterGuide) throw new MasteryHonorLockedException("Master Guide attire is available to coaches.");
        if (input.Character.Slots.Concat(input.SharePatches.Select(p => (string?)p.Key)).Append(input.AvatarHonorKey).Any(k => k is not null && !earned.Contains(k)))
            throw new MasteryHonorLockedException("Earn each Honor before using it in your profile.");
    }
    internal static CharacterProfileState? Read(PbeTrainingRecord? record, Guid user)
    {
        if (record?.OwnerId != user) return null;
        try { var saved = JsonSerializer.Deserialize<CharacterProfileState>(record.DataJson, Json); return saved?.UserId == user ? saved : null; }
        catch (JsonException) { return null; }
    }
    internal static CharacterProfileState Sanitize(CharacterProfileState? saved, Guid user, string? avatarHonorKey, IReadOnlySet<string> earned, bool canUseMasterGuide)
    {
        var config = ConfigValid(saved?.Character) ? saved!.Character : DefaultCharacter();
        config = config with { Attire = canUseMasterGuide ? config.Attire : "student", Slots = config.Slots.Select(k => k is not null && earned.Contains(k) ? k : null).ToArray() };
        var kind = In(saved?.AvatarKind, "initials", "honor", "character") ? saved!.AvatarKind : avatarHonorKey is null ? "initials" : "honor";
        if (kind == "honor" && avatarHonorKey is null) kind = "initials";
        var patches = (saved?.SharePatches ?? []).Take(HonorKeys.Count).Where(PlacementValid).Where(p => earned.Contains(p.Key)).DistinctBy(p => p.Key, StringComparer.Ordinal).ToArray();
        return new(user, config, kind, saved?.ShareOptions ?? DefaultOptions(), patches);
    }
    internal static (string Kind, CharacterAppearance? Head) Portrait(CharacterProfileState? saved, string? avatarHonorKey)
    {
        if (saved?.AvatarKind == "character" && AppearanceValid(saved.Character)) { var c = saved.Character; return ("character", new(c.BodyType, c.Style, c.HairColor, c.Skin, c.Eyes)); }
        return (saved?.AvatarKind == "initials" || avatarHonorKey is null ? "initials" : "honor", null);
    }
}

public sealed partial class MasteryHonorService
{
    public async Task<UserHonorProfile> SaveCharacterAsync(Guid org, Guid user, SaveCharacterProfile input, CancellationToken ct)
    {
        var current = await ProfileAsync(org, user, ct);
        CharacterProfiles.Validate(input, current.Honors.Where(h => h.EarnedAtUtc.HasValue).Select(h => h.Key).ToHashSet(StringComparer.Ordinal), current.CanUseMasterGuide);
        var id = user.ToString();
        var record = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == CharacterProfiles.Kind && r.Id == id, ct);
        if ((record?.Revision ?? 0) != input.Version || record is not null && record.OwnerId != user) throw new CharacterProfileConflictException();
        if (record is null) { record = new() { OrganizationId = org, Kind = CharacterProfiles.Kind, Id = id, OwnerId = user, Revision = 0 }; db.PbeTrainingRecords.Add(record); }
        record.DataJson = JsonSerializer.Serialize(new CharacterProfileState(user, input.Character, input.AvatarKind, input.ShareOptions, input.SharePatches), CharacterProfiles.Json);
        record.Revision++;
        await SetSelectionAsync(org, user, input.AvatarHonorKey, ct);
        await db.SaveChangesAsync(ct);
        return await ProfileAsync(org, user, ct);
    }
    async Task AdvanceLegacyCharacterAsync(Guid org, Guid user, string? key, CancellationToken ct)
    {
        var id = user.ToString();
        var record = await db.PbeTrainingRecords.SingleOrDefaultAsync(r => r.OrganizationId == org && r.Kind == CharacterProfiles.Kind && r.Id == id, ct);
        if (record is not null && record.OwnerId != user) throw new CharacterProfileConflictException();
        var state = CharacterProfiles.Read(record, user) ?? new(user, CharacterProfiles.DefaultCharacter(), "initials", CharacterProfiles.DefaultOptions(), []);
        if (record is null) { record = new() { OrganizationId = org, Kind = CharacterProfiles.Kind, Id = id, OwnerId = user, Revision = 0 }; db.PbeTrainingRecords.Add(record); }
        record.DataJson = JsonSerializer.Serialize(state with { AvatarKind = key is null ? "initials" : "honor" }, CharacterProfiles.Json);
        record.Revision++;
    }
}
