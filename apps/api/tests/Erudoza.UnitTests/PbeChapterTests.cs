using Erudoza.Domain.Practice;
using Erudoza.Domain.Study;

namespace Erudoza.UnitTests;

public sealed class PbeChapterTests
{
    [Fact]
    public void Canonical_scope_codec_matches_the_native_Unicode_tuple_fixture()
    {
        const string tuple = """
        ["pbe-chapter-v1","pbe-passage-groups-v1","cccccccc-0000-0000-0000-000000000001","dddddddd-0000-0000-0000-000000000001",[["aaaaaaaa-0000-0000-0000-000000000002","aaaaaaaa-0000-0000-0000-000000000001","Scripture","GEN",1,1,1,"Génesis 1:1","e6aa8a788864940461c28e56b25c94fd93986035972ae44dab237a9e99858bb7"]],[["bbbbbbbb-0000-0000-0000-000000000001",["aaaaaaaa-0000-0000-0000-000000000002"],"FactualRecall"]],[["bbbbbbbb-0000-0000-0000-000000000100",1,["aaaaaaaa-0000-0000-0000-000000000002"],"ShortAnswer",false,[["bbbbbbbb-0000-0000-0000-000000000001",1]]]],[["assignment","assignment","aaaaaaaa-0000-0000-0000-000000000001","GEN",1,1,1,1]]]
        """;
        var type = typeof(Erudoza.Application.Study.PbeChapterProgressService);
        var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static;
        var serialized = (string)type.GetMethod("Serialize", flags)!.MakeGenericMethod(typeof(System.Text.Json.JsonElement)).Invoke(null, [System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(tuple)])!;
        var hash = (string)type.GetMethod("Hash", flags)!.Invoke(null, [serialized])!;
        Assert.Equal("2c5297378628f8bc69c4aaa06d75eb80d5ea9967d475583c7c39fb605f0a5566", hash);
    }

    private const long Delay = 172_800_000;
    private static Guid Id(int value) => Guid.Parse($"00000000-0000-0000-0000-{value:000000000000}");
    private static PbeTargetProof Proof(int target = 1, int question = 1, int attempt = 1, long atMs = 0, long sequence = 1)
        => new(Id(target), Id(100 + question), 1, Id(200 + attempt), atMs, sequence, true, true, true, true, "Solo");

    private static PbeTargetProof[] Pair(int target = 1)
        => [Proof(target), Proof(target, question: 2, attempt: 2, atMs: Delay, sequence: 2)];

    private static PbeTarget Target(int id = 1, IReadOnlyList<Guid>? sources = null, RecallSkill skill = RecallSkill.FactualRecall)
        => new() { Id = Id(id), SourceUnitIds = sources?.ToList() ?? [Id(301)], Skill = skill, Label = "Declared recall target" };

    private static PbeQuestion Question(int id, PbeTarget target, PbeQuestionKind? kind = null, int version = 1, bool ordered = true, PbeSourceKind sourceKind = PbeSourceKind.Scripture)
        => new()
        {
            SchemaVersion = 2,
            Id = Id(100 + id),
            Version = version,
            ContentPackId = Id(400),
            SourceUnitId = target.SourceUnitIds[0],
            SourceUnitIds = [.. target.SourceUnitIds],
            SourceKind = sourceKind,
            Reference = "Genesis 1:1",
            Evidence = "In the beginning",
            Prompt = "What words begin the passage?",
            Kind = kind ?? (target.Skill == RecallSkill.ExactWords ? PbeQuestionKind.ExactWords : PbeQuestionKind.ShortAnswer),
            Ordered = ordered,
            Parts = [new() { TargetId = target.Id, AcceptedAnswers = [kind == PbeQuestionKind.TrueFalse ? "True" : "In the beginning"], Points = 1 }]
        };

    private static PbeTargetReview Review(int target = 1)
        => new(Id(target), 0, Delay, false, Id(201), Id(101), 0);

    private static PbeChapterScope Chapter => new("genesis:1", "scope-v1", [Id(301)], [Id(301)]);
    private static PbeChapterContext Context => new(Delay);

    [Fact]
    public void Retention_requires_a_different_question_after_a_delay()
    {
        var first = Proof();
        var repeated = first with { AttemptId = Id(202), AtMs = Delay, AcceptedSequence = 2 };
        Assert.Empty(PbeChapterRules.RetainedTargets([first, repeated], [Id(1)]));
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([first, repeated with { QuestionId = Id(102) }], [Id(1)]));
    }

    [Fact]
    public void Original_response_lock_times_prevent_delayed_outbox_delivery_from_manufacturing_retention()
    {
        var first = Proof();
        // The second response was locked one second later; its outbox is delivered after day two.
        var projectedLate = Proof(question: 2, attempt: 2, atMs: 1_000, sequence: 2);
        Assert.Empty(PbeChapterRules.RetainedTargets([first, projectedLate], [Id(1)]));
        var trulyDelayed = Proof(question: 3, attempt: 3, atMs: Delay, sequence: 3);
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([first, projectedLate, trulyDelayed], [Id(1)]));
    }

    [Fact]
    public void Out_of_order_delivery_uses_absolute_original_response_separation()
    {
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([
            Proof(atMs: Delay), Proof(question: 2, attempt: 2, atMs: 0, sequence: 2)], [Id(1)]));
        Assert.Empty(PbeChapterRules.RetainedTargets([
            Proof(atMs: Delay - 1), Proof(question: 2, attempt: 2, atMs: 0, sequence: 2)], [Id(1)]));
    }

    [Fact]
    public void Later_repeat_extreme_is_preserved_for_a_subsequently_delivered_early_response()
    {
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([
            Proof(atMs: 10), Proof(atMs: Delay + 10, attempt: 2, sequence: 2),
            Proof(question: 2, attempt: 3, atMs: 0, sequence: 3)], [Id(1)]));
    }

    [Fact]
    public void Fold_page_splits_preserve_first_witness_bounded_extremes_and_pending_barriers()
    {
        var events = Enumerable.Range(1, 100).Select(n => Proof(question: n % 7 + 1, attempt: n, atMs: n * Delay, sequence: n)).ToArray();
        var state = PbeChapterRules.InitialRetention();
        foreach (var page in events.Chunk(32))
        {
            foreach (var proof in page) state = PbeChapterRules.AdvanceRetention(state, proof);
            Assert.InRange(state.Earliest.Count, 0, 2); Assert.InRange(state.Latest.Count, 0, 2);
        }
        Assert.Equal(System.Text.Json.JsonSerializer.Serialize(PbeChapterRules.ReplayTargets(events, [Id(1)])[Id(1)]), System.Text.Json.JsonSerializer.Serialize(state));
        Assert.Equal([Id(201), Id(202)], state.Witness!.Select(c => c.AttemptId));
        state = PbeChapterRules.AdvanceRetention(state, Proof(attempt: 101, sequence: 101) with { Final = false });
        state = PbeChapterRules.AdvanceRetention(state, Proof(attempt: 102, sequence: 102) with { FullCredit = false });
        state = PbeChapterRules.AdvanceRetention(state, Proof(attempt: 103, sequence: 103));
        state = PbeChapterRules.AdvanceRetention(state, Proof(attempt: 104, question: 2, atMs: Delay, sequence: 104));
        Assert.False(PbeChapterRules.IsRetained(state)); Assert.Equal(1, state.PendingCount);
    }

    [Theory]
    [InlineData("millisecond-short")]
    [InlineData("same-question-version")]
    [InlineData("partial")]
    [InlineData("aided")]
    [InlineData("recognition")]
    [InlineData("team")]
    [InlineData("provisional")]
    public void Nonqualifying_second_answers_cannot_establish_retention(string exclusion)
    {
        var second = Proof(question: 2, attempt: 2, atMs: Delay, sequence: 2);
        second = exclusion switch
        {
            "millisecond-short" => second with { AtMs = Delay - 1 },
            "same-question-version" => second with { QuestionId = Id(101), QuestionVersion = 2 },
            "partial" => second with { FullCredit = false },
            "aided" => second with { Unaided = false },
            "recognition" => second with { Recall = false },
            "team" => second with { Activity = "Team" },
            "provisional" => second with { Final = false },
            _ => throw new ArgumentOutOfRangeException(nameof(exclusion))
        };
        Assert.Empty(PbeChapterRules.RetainedTargets([Proof(), second], [Id(1)]));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Last_failure_requires_two_new_successes_even_when_the_failure_is_aided(bool aided)
    {
        var failed = Proof(question: 3, attempt: 3, atMs: Delay + 1, sequence: 3) with { FullCredit = false, Unaided = !aided };
        var once = Proof(question: 4, attempt: 4, atMs: Delay * 2, sequence: 4);
        var aidedSuccess = Proof(question: 5, attempt: 5, atMs: Delay * 3, sequence: 5) with { Unaided = false };
        var twice = Proof(question: 6, attempt: 6, atMs: Delay * 3, sequence: 6);
        Assert.Empty(PbeChapterRules.RetainedTargets([.. Pair(), failed], [Id(1)]));
        Assert.Empty(PbeChapterRules.RetainedTargets([.. Pair(), failed, once, aidedSuccess], [Id(1)]));
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([.. Pair(), failed, once, aidedSuccess, twice], [Id(1)]));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Equal_time_failure_and_success_replay_by_the_original_accepted_order(bool failureFirst)
    {
        var failure = Proof(question: 2, attempt: 2, atMs: Delay, sequence: failureFirst ? 2 : 3) with { FullCredit = false };
        var success = Proof(question: 3, attempt: 3, atMs: Delay, sequence: failureFirst ? 3 : 2);
        var later = Proof(question: 4, attempt: 4, atMs: Delay * 2, sequence: 4);
        Guid[] expected = failureFirst ? [Id(1)] : [];
        Assert.Equal(expected, PbeChapterRules.RetainedTargets([later, success, Proof(), failure], [Id(1)]));
        Assert.Equal(expected, PbeChapterRules.RetainedTargets([failure, Proof(), success, later], [Id(1)]));
    }

    [Fact]
    public void A_later_accepted_response_locked_earlier_still_follows_accepted_sequence()
    {
        var delayedSuccess = Proof(question: 2, attempt: 2, atMs: Delay, sequence: 2);
        var laterAcceptedFailure = Proof(question: 3, attempt: 3, atMs: 1_000, sequence: 3) with { FullCredit = false };
        Assert.Empty(PbeChapterRules.RetainedTargets([Proof(), laterAcceptedFailure, delayedSuccess], [Id(1)]));
    }

    [Fact]
    public void A_late_corrected_grade_replays_at_its_original_sequence()
    {
        var first = Proof();
        var second = Proof(question: 2, attempt: 2, atMs: Delay, sequence: 2);
        var third = Proof(question: 3, attempt: 3, atMs: Delay * 2, sequence: 3);
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([first, second, third], [Id(1)]));
        Assert.Empty(PbeChapterRules.RetainedTargets([third, first, second with { FullCredit = false }], [Id(1)]));
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([third, first, second with { FullCredit = false }, Proof(question: 4, attempt: 4, atMs: Delay * 3, sequence: 4)], [Id(1)]));
    }

    [Fact]
    public void Pending_recall_cannot_be_omitted_to_revive_older_successes()
    {
        var pending = Proof(question: 3, attempt: 3, atMs: Delay * 2, sequence: 3) with { FullCredit = false, Final = false };
        Assert.Empty(PbeChapterRules.RetainedTargets([.. Pair(), pending], [Id(1)]));
        Assert.Empty(PbeChapterRules.RetainedTargets([pending, .. Pair(), Proof(question: 4, attempt: 4, atMs: Delay * 3, sequence: 4)], [Id(1)]));
    }

    [Theory]
    [InlineData("recognition")]
    [InlineData("team")]
    public void A_wrong_recognition_or_team_answer_does_not_reset_individual_recall(string exclusion)
    {
        var failure = Proof(question: 3, attempt: 3, atMs: Delay * 2, sequence: 3) with { FullCredit = false };
        failure = exclusion == "team" ? failure with { Activity = "Team" } : failure with { Recall = false };
        Assert.Equal([Id(1)], PbeChapterRules.RetainedTargets([.. Pair(), failure], [Id(1)]));
    }

    [Fact]
    public void Proofs_group_by_eligible_target_and_keep_input_order_unchanged()
    {
        var other = Proof(target: 2, question: 2, attempt: 2, atMs: Delay, sequence: 2);
        var proofs = new[] { other, Proof() };
        var original = proofs.ToArray();
        Assert.Empty(PbeChapterRules.RetainedTargets(proofs, [Id(1)]));
        Assert.Empty(PbeChapterRules.RetainedTargets(proofs, []));
        Assert.Equal(original, proofs);
    }

    [Fact]
    public void Empty_assigned_scope_has_no_target_readiness()
    {
        var target = Target();
        var result = PbeChapterRules.ProjectChapter(Chapter with { AssignedSourceUnitIds = [] }, [target], [Review()], Pair(), [Question(1, target), Question(2, target)], Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 0, 0, 0, 0, 0, 0, 0, 0, null), result);
    }

    [Fact]
    public void An_assigned_passage_without_targets_has_no_invented_question_coverage()
    {
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 0, 0, 0, 0, 0, 0, 0, null),
            PbeChapterRules.ProjectChapter(Chapter, [], [], [], [], Context));
    }

    [Fact]
    public void A_one_verse_assignment_can_have_complete_bank_readiness_without_a_fabricated_earned_date()
    {
        var target = Target();
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 1, 1, 1, 1, 1, 0, null),
            PbeChapterRules.ProjectChapter(Chapter, [target], [Review()], Pair(), [Question(1, target), Question(2, target)], Context));
    }

    [Fact]
    public void Every_declared_target_is_counted_including_zero_question_targets()
    {
        var target = Target();
        var result = PbeChapterRules.ProjectChapter(Chapter, [target, Target(2)], [], Pair(), [Question(1, target), Question(2, target)], Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 2, 1, 1, 1, 0, 1, null), result);
    }

    [Fact]
    public void Retained_declared_targets_cannot_hide_incomplete_assigned_passage_coverage()
    {
        var target = Target();
        var scope = Chapter with { AssignedSourceUnitIds = [Id(301), Id(302)], EligibleAssignmentSourceUnitIds = [Id(301), Id(302)] };
        var result = PbeChapterRules.ProjectChapter(scope, [target], [], Pair(), [Question(1, target), Question(2, target)], Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 2, 1, 1, 1, 1, 1, 0, 0, null), result);
    }

    [Fact]
    public void Partial_chapter_counts_exclude_unassigned_verses_and_spanning_questions()
    {
        var target = Target(); var excluded = Target(2, [Id(302)]); var spanning = Target(3, [Id(301), Id(302)]);
        var scope = Chapter with { AssignedSourceUnitIds = [Id(301), Id(303), Id(301)], EligibleAssignmentSourceUnitIds = [Id(301), Id(303)] };
        var result = PbeChapterRules.ProjectChapter(scope, [target, excluded, spanning], [Review(2)], [.. Pair(), .. Pair(2), .. Pair(3)],
            [Question(1, target), Question(2, target), Question(3, excluded), Question(4, spanning)], Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 2, 1, 1, 1, 1, 1, 0, 0, null), result);
    }

    [Fact]
    public void Fully_assigned_cross_chapter_targets_contribute_to_each_intersected_chapter()
    {
        var spanning = Target(2, [Id(301), Id(302)]); var neighbor = Target(3, [Id(302)]);
        var questions = new[] { Question(1, spanning), Question(2, spanning) };
        var scope = Chapter with { EligibleAssignmentSourceUnitIds = [Id(301), Id(302)] };
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 1, 1, 1, 1, 0, 0, null),
            PbeChapterRules.ProjectChapter(scope, [spanning, neighbor], [], Pair(2), questions, Context));
        Assert.Equal(new PbeChapterProgress("genesis:2", "scope-v1", 1, 1, 2, 1, 1, 1, 0, 1, null),
            PbeChapterRules.ProjectChapter(scope with { ChapterKey = "genesis:2", AssignedSourceUnitIds = [Id(302)] }, [spanning, neighbor], [], Pair(2), questions, Context));
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 0, 0, 0, 0, 0, 0, 0, null),
            PbeChapterRules.ProjectChapter(Chapter, [spanning, neighbor], [], Pair(2), questions, Context));
    }

    [Fact]
    public void Same_numbered_chapters_in_different_books_use_their_supplied_source_groups()
    {
        var genesis = Target(); var exodus = Target(2, [Id(302)]);
        var questions = new[] { Question(1, genesis), Question(2, genesis), Question(3, exodus), Question(4, exodus) };
        var scope = Chapter with { EligibleAssignmentSourceUnitIds = [Id(301), Id(302)] };
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 1, 1, 1, 1, 1, 0, null),
            PbeChapterRules.ProjectChapter(scope, [genesis, exodus], [Review(), Review(2)], Pair(), questions, Context));
        Assert.Equal(new PbeChapterProgress("exodus:1", "scope-v1", 1, 1, 1, 0, 0, 0, 1, 0, null),
            PbeChapterRules.ProjectChapter(scope with { ChapterKey = "exodus:1", AssignedSourceUnitIds = [Id(302)] }, [genesis, exodus], [Review(), Review(2)], Pair(), questions, Context));
    }

    [Fact]
    public void Scope_expansion_recomputes_coverage_without_reusing_an_earned_date()
    {
        var old = Target(); var added = Target(2, [Id(302)]);
        var questions = new[] { Question(1, old), Question(2, old) };
        var before = PbeChapterRules.ProjectChapter(Chapter, [old, added], [], Pair(), questions, Context);
        var expanded = Chapter with { ScopeVersion = "scope-v2", AssignedSourceUnitIds = [Id(301), Id(302)], EligibleAssignmentSourceUnitIds = [Id(301), Id(302)] };
        var after = PbeChapterRules.ProjectChapter(expanded, [old, added], [], Pair(), questions, Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 1, 1, 1, 1, 0, 0, null), before);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v2", 2, 1, 2, 1, 1, 1, 0, 1, null), after);
    }

    [Fact]
    public void Recognition_counts_practice_and_passage_coverage_but_not_recall_or_recall_variants()
    {
        var target = Target();
        var questions = new[] { Question(1, target, PbeQuestionKind.TrueFalse), Question(2, target, PbeQuestionKind.TrueFalse) };
        var result = PbeChapterRules.ProjectChapter(Chapter, [target], [], Pair().Select(p => p with { Recall = false }).ToArray(), questions, Context);
        Assert.Equal(new PbeChapterProgress("genesis:1", "scope-v1", 1, 1, 1, 1, 0, 0, 0, 1, null), result);
    }

    [Theory]
    [InlineData("aided", 1)]
    [InlineData("provisional", 1)]
    [InlineData("team", 0)]
    public void Aided_provisional_and_team_answers_cannot_supply_individual_chapter_recall(string exclusion, int practiced)
    {
        var target = Target();
        var proofs = Pair().Select(p => exclusion switch
        {
            "aided" => p with { Unaided = false },
            "provisional" => p with { Final = false },
            "team" => p with { Activity = "Team" },
            _ => throw new ArgumentOutOfRangeException(nameof(exclusion))
        }).ToArray();
        var result = PbeChapterRules.ProjectChapter(Chapter, [target], [], proofs, [Question(1, target), Question(2, target)], Context);
        Assert.Equal((practiced, 0, 0), (result.PracticedTargets, result.RecalledTargets, result.RetainedTargets));
    }

    [Fact]
    public void Current_recalled_and_retained_counts_recompute_after_failure_or_pending_correction()
    {
        var target = Target(); var questions = new[] { Question(1, target), Question(2, target) };
        var wrong = Proof(question: 3, attempt: 3, atMs: Delay + 1, sequence: 3) with { FullCredit = false };
        var failed = PbeChapterRules.ProjectChapter(Chapter, [target], [], [.. Pair(), wrong], questions, Context);
        var pending = PbeChapterRules.ProjectChapter(Chapter, [target], [], [.. Pair(), wrong with { Final = false }], questions, Context);
        Assert.Equal((1, 0, 0), (failed.PracticedTargets, failed.RecalledTargets, failed.RetainedTargets));
        Assert.Equal((1, 0, 0), (pending.PracticedTargets, pending.RecalledTargets, pending.RetainedTargets));
    }

    [Fact]
    public void Variants_count_distinct_question_IDs_not_versions_or_repeated_target_parts()
    {
        var target = Target(); var question = Question(1, target);
        question.Parts = [new() { TargetId = target.Id, AcceptedAnswers = ["In"], Points = 1 }, new() { TargetId = target.Id, AcceptedAnswers = ["the beginning"], Points = 1 }];
        var repeated = PbeChapterRules.ProjectChapter(Chapter, [target], [], Pair(), [question, Question(1, target, version: 2)], Context);
        Assert.Equal((1, 1, 0, 1), (repeated.QuestionCoveredPassages, repeated.RecalledTargets, repeated.RetainedTargets, repeated.MissingVariantTargets));
        var distinct = PbeChapterRules.ProjectChapter(Chapter, [target], [], Pair(), [question, Question(2, target)], Context);
        Assert.Equal((1, 0), (distinct.RetainedTargets, distinct.MissingVariantTargets));
    }

    [Fact]
    public void ExactWords_variants_require_the_kind_and_preserve_its_existing_ordered_grading_semantics()
    {
        var exact = Target(skill: RecallSkill.ExactWords);
        var wrongKinds = PbeChapterRules.ProjectChapter(Chapter, [exact], [], Pair(), [Question(1, exact, PbeQuestionKind.ShortAnswer), Question(2, exact, PbeQuestionKind.List)], Context);
        Assert.Equal((1, 0, 1), (wrongKinds.RecalledTargets, wrongKinds.RetainedTargets, wrongKinds.MissingVariantTargets));
        var exactKinds = PbeChapterRules.ProjectChapter(Chapter, [exact], [], Pair(), [Question(1, exact), Question(2, exact, ordered: false)], Context);
        Assert.Equal((1, 1, 0), (exactKinds.RecalledTargets, exactKinds.RetainedTargets, exactKinds.MissingVariantTargets));
    }

    [Fact]
    public void Frozen_recall_applicability_is_not_regraded_from_current_question_heads()
    {
        var exact = Target(skill: RecallSkill.ExactWords);
        var questions = new[] { Question(1, exact, version: 2), Question(2, exact, version: 2) };
        var nonRecall = PbeChapterRules.ProjectChapter(Chapter, [exact], [], Pair().Select(p => p with { Recall = false }).ToArray(), questions, Context);
        Assert.Equal((1, 0, 0, 0), (nonRecall.PracticedTargets, nonRecall.RecalledTargets, nonRecall.RetainedTargets, nonRecall.MissingVariantTargets));
        var historical = new[] { Proof(question: 3), Proof(question: 4, attempt: 2, atMs: Delay, sequence: 2) };
        var retained = PbeChapterRules.ProjectChapter(Chapter, [exact], [], historical, questions, Context);
        Assert.Equal((1, 1, 0), (retained.RecalledTargets, retained.RetainedTargets, retained.MissingVariantTargets));
    }

    [Fact]
    public void Approved_introductions_use_opaque_group_and_source_IDs_without_invented_coordinates()
    {
        var target = Target(2, [Id(305)]);
        var scope = new PbeChapterScope("intro:pack", "intro-v1", [Id(305)], [Id(305)]);
        var result = PbeChapterRules.ProjectChapter(scope, [target], [], Pair(2), [Question(1, target, sourceKind: PbeSourceKind.Commentary), Question(2, target, sourceKind: PbeSourceKind.Commentary)], Context);
        Assert.Equal(new PbeChapterProgress("intro:pack", "intro-v1", 1, 1, 1, 1, 1, 1, 0, 0, null), result);
    }

    [Fact]
    public void Due_counts_use_the_explicit_as_of_boundary_and_exclude_initial_and_outside_reviews()
    {
        var targets = Enumerable.Range(1, 6).Select(i => Target(i)).ToArray();
        var reviews = new[] { Review() with { DueAtMs = Delay - 1 }, Review(2), Review(3) with { DueAtMs = Delay + 1 },
            Review(4) with { Unresolved = true, IntervalIndex = -1, DueAtMs = Delay + 1 }, PbeReviewRules.Initial(Id(5)), Review(7) };
        var now = PbeChapterRules.ProjectChapter(Chapter, targets, reviews, [], [], Context);
        Assert.Equal((6, 3), (now.TotalTargets, now.DueTargets));
        Assert.Equal(4, PbeChapterRules.ProjectChapter(Chapter, targets, reviews, [], [], new(Delay + 1)).DueTargets);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Nonfinite_as_of_times_are_rejected(double asOfMs)
    {
        Assert.Throws<ArgumentException>(() => PbeChapterRules.ProjectChapter(Chapter, [], [], [], [], new(asOfMs)));
    }

    [Fact]
    public void Group_sources_outside_the_complete_eligible_assignment_are_rejected()
    {
        Assert.Throws<ArgumentException>(() => PbeChapterRules.ProjectChapter(Chapter with { AssignedSourceUnitIds = [Id(399)] }, [], [], [], [], Context));
    }
}
