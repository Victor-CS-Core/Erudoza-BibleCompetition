using System.Text.Json;

namespace Erudoza.Domain.Study;

public sealed record MasteryHonorDefinition(string Key, string Title, string Requirement, string Category);
public sealed record MasteryQualification(string Key, string EvidenceJson);
public sealed record HonorPassage(Guid KnowledgeUnitId, string BookKey, int Chapter, int ExactWording, int Reference, int Recognition, string AlgorithmVersion, MasteryPassageProof? Proof);
public sealed record HonorAttempt(Guid Id, DateTimeOffset AtUtc, bool IsCorrect, bool HintsUsed, bool IsLegacyDuplicate, AnswerMode AnswerMode, string ActivityType, int Difficulty, bool FirstDueReviewAttempt);
public sealed record HonorTeamMember(Guid UserId, int Team);
public sealed record HonorScoredQuestion(Guid QuestionId, Guid SourceUnitId, int Team, Guid ScribeId, bool Manual, int AccuracyHundredths, int AvailableHundredths);
public sealed record HonorMatch(Guid Id, Guid SeasonId, long Revision, DateTimeOffset CompletedAtUtc, bool Completed, bool Resolved, bool Coached, int QuestionCount, IReadOnlyList<HonorTeamMember> Members, IReadOnlyList<HonorScoredQuestion> Scores);

public static class MasteryHonorRules
{
    public const string Version = "mastery-v1";
    public static readonly IReadOnlyList<MasteryHonorDefinition> Catalog = [
        new("solo:exact-recall", "Exact Recall", "Reach 90 in exact wording on 12 distinct assigned passages.", "Scripture"),
        new("solo:reference-ready", "Reference Ready", "Reach 90 in reference recall on 20 distinct assigned passages.", "Scripture"),
        new("solo:chapter-strong", "Chapter Strong", "Master every assigned passage in one chapter, with at least 10 passages: exact wording 90, reference 80, recognition 80.", "Scripture"),
        new("solo:full-coverage", "Full Coverage", "Master every assigned passage in a scope of at least 30 passages: exact wording 90, reference 80, recognition 80.", "Scripture"),
        new("solo:steady-study", "Steady Study", "Retain mastery on 20 distinct passages and pass an unaided advanced typed retest at least 48 hours after first mastering each.", "Scripture"),
        new("solo:review-complete", "Review Complete", "Correctly answer 8 distinct due passages on the first accepted advanced typed review attempt, without hints, while meeting the mastery standard.", "Scripture"),
        new("team:first-fellowship", "First Fellowship", "Reach 90% personal accuracy across 10 distinct manually submitted questions as scribe.", "Team Practice"),
        new("team:team-steady", "Team Steady", "Complete 3 matches with at least 90% team accuracy and reach 90% personal accuracy across 30 distinct manual questions.", "Team Practice"),
        new("team:shared-scribe", "Shared Scribe", "Reach 95% personal accuracy across 30 distinct manual questions from at least 10 passages.", "Team Practice"),
        new("team:team-precision", "Team Precision", "Reach 95% team accuracy across 50 distinct questions from 15 passages, plus 90% personal accuracy across 10 distinct manual questions.", "Team Practice"),
        new("team:rehearsal-complete", "Rehearsal Complete", "Complete a resolved coached 90-question rehearsal with 90% team accuracy, plus 90% personal accuracy across 10 distinct manual questions.", "Team Practice")
    ];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static bool MeetsStandard(HonorPassage p) => p.AlgorithmVersion == ScaffoldMasteryRules.AlgorithmVersion && p.ExactWording >= 90 && p.Reference >= 80 && p.Recognition >= 80;

    public static void ObserveProof(MasteryPassageProof proof, HonorPassage passage, HonorAttempt attempt)
    {
        if (attempt.IsLegacyDuplicate || !MeetsStandard(passage)) return;
        var evidence = JsonSerializer.Serialize(new { attempt, passage = passage with { Proof = null } }, Json);
        if (proof.FirstMasteredAtUtc is null)
        {
            proof.FirstMasteredAtUtc = attempt.AtUtc; proof.FirstMasteredAttemptId = attempt.Id; proof.FirstMasteredEvidenceJson = evidence;
        }
        var typed = attempt.IsCorrect && !attempt.HintsUsed && attempt.AnswerMode == AnswerMode.ExactText && attempt.Difficulty >= 5 && attempt.ActivityType is "MissingWords" or "WhatComesNext";
        if (typed && attempt.AtUtc >= proof.FirstMasteredAtUtc.Value.AddHours(48) && proof.RetainedAttemptId is null)
        { proof.RetainedAttemptId = attempt.Id; proof.RetainedAtUtc = attempt.AtUtc; proof.RetainedEvidenceJson = evidence; }
        if (typed && attempt.FirstDueReviewAttempt && proof.ReviewedAttemptId is null)
        { proof.ReviewedAttemptId = attempt.Id; proof.ReviewedAtUtc = attempt.AtUtc; proof.ReviewedEvidenceJson = evidence; }
    }

    public static IReadOnlyList<MasteryQualification> Solo(IEnumerable<HonorPassage> eligible)
    {
        var all = eligible.DistinctBy(p => p.KnowledgeUnitId).OrderBy(p => p.KnowledgeUnitId).ToArray();
        var current = all.Where(p => p.AlgorithmVersion == ScaffoldMasteryRules.AlgorithmVersion).ToArray();
        var result = new List<MasteryQualification>();
        void Qualify(string key, IEnumerable<HonorPassage> passages) => result.Add(new(key, JsonSerializer.Serialize(new { ruleVersion = Version, passages }, Json)));
        var exact = current.Where(p => p.ExactWording >= 90).Take(12).ToArray();
        if (exact.Length == 12) Qualify("solo:exact-recall", exact);
        var reference = current.Where(p => p.Reference >= 90).Take(20).ToArray();
        if (reference.Length == 20) Qualify("solo:reference-ready", reference);
        var chapter = all.GroupBy(p => (p.BookKey, p.Chapter)).FirstOrDefault(g => g.Count() >= 10 && g.All(MeetsStandard));
        if (chapter is not null) Qualify("solo:chapter-strong", chapter);
        if (all.Length >= 30 && all.All(MeetsStandard)) Qualify("solo:full-coverage", all);
        var retained = current.Where(p => MeetsStandard(p) && p.Proof is { FirstMasteredAtUtc: not null, RetainedAtUtc: not null, RetainedAttemptId: not null } proof && proof.KnowledgeUnitId == p.KnowledgeUnitId && proof.RuleVersion == Version && proof.RetainedAtUtc >= proof.FirstMasteredAtUtc.Value.AddHours(48)).Take(20).ToArray();
        if (retained.Length == 20) Qualify("solo:steady-study", retained);
        // Review certificates freeze the mastery demonstrated on that first attempt.
        var reviewed = all.Where(p => p.Proof is { ReviewedAtUtc: not null, ReviewedAttemptId: not null } proof && proof.KnowledgeUnitId == p.KnowledgeUnitId && proof.RuleVersion == Version).Take(8).ToArray();
        if (reviewed.Length == 8) Qualify("solo:review-complete", reviewed);
        return result;
    }

    public static IReadOnlyList<MasteryQualification> Team(IEnumerable<HonorMatch> source, Guid user)
    {
        var matches = source.Where(m => m.Completed && m.Resolved && m.Members.Any(x => x.UserId == user))
            .OrderByDescending(m => m.CompletedAtUtc).ThenByDescending(m => m.Id.ToString(), StringComparer.Ordinal).DistinctBy(m => m.Id).ToArray();
        var scored = matches.SelectMany(m => m.Scores.Where(s => s.Team == m.Members.Single(x => x.UserId == user).Team && s.AvailableHundredths > 0)
            .Select(s => new { matchId = m.Id, matchRevision = m.Revision, completedAtUtc = m.CompletedAtUtc, score = s })).ToArray();
        var team = scored.DistinctBy(s => s.score.QuestionId).ToArray();
        var personal = scored.Where(s => s.score.Manual && s.score.ScribeId == user).DistinctBy(s => s.score.QuestionId).ToArray();
        static bool Accuracy(IEnumerable<HonorScoredQuestion> scores, int minimum, int percent)
        {
            var s = scores.ToArray();
            return s.Length >= minimum && s.All(x => x.AccuracyHundredths >= 0 && x.AccuracyHundredths <= x.AvailableHundredths) && s.Sum(x => (long)x.AccuracyHundredths) * 100 >= s.Sum(x => (long)x.AvailableHundredths) * percent;
        }
        bool Personal(int minimum, int percent) => Accuracy(personal.Select(s => s.score), minimum, percent);
        var goodMatches = matches.Where(m => Accuracy(m.Scores.Where(s => s.Team == m.Members.Single(x => x.UserId == user).Team).DistinctBy(s => s.QuestionId), m.QuestionCount, 90)).ToArray();
        var keys = new List<string>();
        if (Personal(10, 90)) keys.Add("team:first-fellowship");
        if (goodMatches.Length >= 3 && Personal(30, 90)) keys.Add("team:team-steady");
        if (Personal(30, 95) && personal.Select(s => s.score.SourceUnitId).Distinct().Count() >= 10) keys.Add("team:shared-scribe");
        if (Accuracy(team.Select(s => s.score), 50, 95) && team.Select(s => s.score.SourceUnitId).Distinct().Count() >= 15 && Personal(10, 90)) keys.Add("team:team-precision");
        if (goodMatches.Any(m => m.Coached && m.QuestionCount == 90) && Personal(10, 90)) keys.Add("team:rehearsal-complete");
        var evidence = JsonSerializer.Serialize(new { ruleVersion = Version, userId = user, personalQuestions = personal, teamQuestions = team, qualifyingMatchIds = goodMatches.Select(m => m.Id) }, Json);
        return keys.Select(key => new MasteryQualification(key, evidence)).ToArray();
    }
}
