using Erudoza.Domain;
using Erudoza.Domain.Study;
namespace Erudoza.UnitTests;

public sealed class MasteryHonorRulesTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-09-11T12:00:00Z");
    private static HonorPassage Passage(int n) => new(Guid.Parse($"10000000-0000-4000-8000-{n:000000000000}"), "DAN", 1, 90, 90, 80, "v2-skill-evidence", null);
    private static string[] Solo(params HonorPassage[] passages) => MasteryHonorRules.Solo(passages).Select(x => x.Key).ToArray();
    [Theory]
    [InlineData(null, true)]
    [InlineData("memory-honor-v2", true)]
    [InlineData("memory-cued-v3", false)]
    public void Saved_profile_controls_advanced_typed_proof(string? profile, bool expected)
    {
        var proof = new MasteryPassageProof { FirstMasteredAtUtc = Now.AddHours(-48) };
        var attempt = new HonorAttempt(Guid.NewGuid(), Now, true, false, false, AnswerMode.ExactText, "MissingWords", 5, true, profile);
        MasteryHonorRules.ObserveProof(proof, Passage(1), attempt);
        Assert.Equal(expected, proof.RetainedAttemptId.HasValue);
        Assert.Equal(expected, proof.ReviewedAttemptId.HasValue);
    }
    [Fact]
    public void Solo_thresholds_require_breadth_current_evidence_and_mastery()
    {
        var passages = Enumerable.Range(1, 30).Select(Passage).ToArray();
        Assert.DoesNotContain("solo:exact-recall", Solo(passages.Take(11).ToArray()));
        Assert.Contains("solo:exact-recall", Solo(passages.Take(12).ToArray()));
        Assert.DoesNotContain("solo:reference-ready", Solo(passages.Take(19).ToArray()));
        Assert.Contains("solo:reference-ready", Solo(passages.Take(20).ToArray()));
        Assert.DoesNotContain("solo:chapter-strong", Solo(passages.Take(9).ToArray()));
        Assert.Contains("solo:chapter-strong", Solo(passages.Take(10).ToArray()));
        Assert.DoesNotContain("solo:full-coverage", Solo(passages.Take(29).ToArray()));
        Assert.Contains("solo:full-coverage", Solo(passages));
        Assert.Empty(Solo(Enumerable.Repeat(Passage(1), 100).ToArray()));
        Assert.Empty(Solo(passages.Select(p => p with { AlgorithmVersion = "legacy" }).ToArray()));
        Assert.DoesNotContain("solo:chapter-strong", Solo(passages.Select(p => p with { Recognition = 79 }).ToArray()));
        Assert.DoesNotContain("solo:exact-recall", Solo(passages.Select(p => p with { ExactWording = 89 }).ToArray()));
        Assert.DoesNotContain("solo:reference-ready", Solo(passages.Select(p => p with { Reference = 89 }).ToArray()));
    }
    [Theory]
    [InlineData(true, false, false, AnswerMode.ExactText, "MissingWords", 5, true)]
    [InlineData(false, false, false, AnswerMode.ExactText, "MissingWords", 5, false)]
    [InlineData(true, true, false, AnswerMode.ExactText, "MissingWords", 5, false)]
    [InlineData(true, false, true, AnswerMode.ExactText, "MissingWords", 5, false)]
    [InlineData(true, false, false, AnswerMode.SelectedChoice, "MissingWords", 5, false)]
    [InlineData(true, false, false, AnswerMode.ExactText, "MissingWords", 3, false)]
    [InlineData(true, false, false, AnswerMode.ExactText, "ReferenceMatch", 5, false)]
    [InlineData(true, false, false, AnswerMode.ExactText, "WhatComesNext", 5, true)]
    public void Retention_and_review_require_unaided_advanced_typed_proof(bool correct, bool hints, bool duplicate, AnswerMode mode, string activity, int difficulty, bool expected)
    {
        var proof = new MasteryPassageProof { FirstMasteredAtUtc = Now.AddHours(-48) };
        var attempt = new HonorAttempt(Guid.NewGuid(), Now, correct, hints, duplicate, mode, activity, difficulty, true);
        MasteryHonorRules.ObserveProof(proof, Passage(1), attempt);
        Assert.Equal(expected, proof.RetainedAttemptId.HasValue); Assert.Equal(expected, proof.ReviewedAttemptId.HasValue);
        if (expected) { Assert.Contains(attempt.Id.ToString(), proof.RetainedEvidenceJson!); Assert.Contains("90", proof.ReviewedEvidenceJson!); }
    }
    [Fact]
    public void Proof_needs_48_hours_and_first_due_attempt_and_freezes_first_certificate()
    {
        var proof = new MasteryPassageProof { FirstMasteredAtUtc = Now.AddHours(-47) };
        var attempt = new HonorAttempt(Guid.NewGuid(), Now, true, false, false, AnswerMode.ExactText, "MissingWords", 5, false);
        MasteryHonorRules.ObserveProof(proof, Passage(1), attempt);
        Assert.Null(proof.RetainedAttemptId); Assert.Null(proof.ReviewedAttemptId);
        MasteryHonorRules.ObserveProof(proof, Passage(1), attempt with { AtUtc = Now.AddHours(1), FirstDueReviewAttempt = true });
        var frozen = proof.ReviewedEvidenceJson;
        MasteryHonorRules.ObserveProof(proof, Passage(1), attempt with { Id = Guid.NewGuid(), AtUtc = Now.AddDays(5), FirstDueReviewAttempt = true });
        Assert.Equal(attempt.Id, proof.RetainedAttemptId); Assert.Equal(frozen, proof.ReviewedEvidenceJson);
        var passages = Enumerable.Range(1, 20).Select(n => Passage(n) with { Proof = new MasteryPassageProof { KnowledgeUnitId = Passage(n).KnowledgeUnitId, FirstMasteredAtUtc = proof.FirstMasteredAtUtc, RetainedAttemptId = proof.RetainedAttemptId, RetainedAtUtc = proof.RetainedAtUtc, ReviewedAttemptId = proof.ReviewedAttemptId, ReviewedAtUtc = proof.ReviewedAtUtc } }).ToArray();
        Assert.Contains("solo:steady-study", Solo(passages));
        Assert.DoesNotContain("solo:steady-study", Solo(passages.Take(19).ToArray()));
        Assert.Contains("solo:review-complete", Solo(passages.Take(8).ToArray()));
        Assert.DoesNotContain("solo:review-complete", Solo(passages.Take(7).ToArray()));
    }
    private static HonorMatch Match(Guid user, int count = 10, int accuracy = 90, bool manual = true, int start = 1)
    {
        var scores = Enumerable.Range(start, count).Select(n => new HonorScoredQuestion(Passage(n).KnowledgeUnitId, Passage(n % 15 + 100).KnowledgeUnitId, 1, user, manual, accuracy, 100)).ToArray();
        return new(Guid.NewGuid(), Guid.NewGuid(), 3, Now, true, true, false, count, [new(user, 1)], scores);
    }
    private static string[] Team(Guid user, params HonorMatch[] matches) => MasteryHonorRules.Team(matches, user).Select(x => x.Key).ToArray();
    [Fact]
    public void Team_honors_need_personal_manual_accuracy_and_distinct_questions()
    {
        var user = Guid.NewGuid(); var match = Match(user);
        Assert.Contains("team:first-fellowship", Team(user, match));
        Assert.Empty(Team(user, Match(user, 9))); Assert.Empty(Team(user, Match(user, accuracy: 89)));
        Assert.Empty(Team(user, Match(user, manual: false)));
        Assert.Empty(Team(user, match with { Scores = match.Scores.Select(s => s with { ScribeId = Guid.NewGuid() }).ToArray() }));
        Assert.Empty(Team(user, match with { Resolved = false })); Assert.Empty(Team(user, match with { Completed = false }));
        Assert.DoesNotContain("team:shared-scribe", Team(user, Match(user, 30, 94)));
        Assert.Contains("team:shared-scribe", Team(user, Match(user, 30, 95)));
        Assert.DoesNotContain("team:team-precision", Team(user, Match(user, 49, 95)));
        Assert.Contains("team:team-precision", Team(user, Match(user, 50, 95)));
        Assert.Contains("team:rehearsal-complete", Team(user, Match(user, 90) with { Coached = true }));
        Assert.DoesNotContain("team:rehearsal-complete", Team(user, Match(user, 90, 89) with { Coached = true }));
        Assert.Contains("team:team-steady", Team(user, Match(user), Match(user, start: 11), Match(user, start: 21)));
        Assert.DoesNotContain("team:team-steady", Team(user, Match(user), Match(user), Match(user)));
    }
    [Fact]
    public void Latest_question_evidence_is_deterministic_and_never_double_counts()
    {
        var user = Guid.NewGuid(); var old = Match(user); var latest = Match(user, accuracy: 0) with { CompletedAtUtc = Now.AddDays(1) };
        Assert.Empty(Team(user, old, latest)); Assert.Empty(Team(user, latest, old));
        Assert.DoesNotContain("team:shared-scribe", Team(user, old, old with { Id = Guid.NewGuid() }, old with { Id = Guid.NewGuid() }));
        var deadline = latest with { Scores = latest.Scores.Select(s => s with { Manual = false }).ToArray() };
        Assert.Contains("team:first-fellowship", Team(user, old, deadline));
    }
}
