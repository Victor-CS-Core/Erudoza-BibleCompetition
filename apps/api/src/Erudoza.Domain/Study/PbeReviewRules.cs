using Erudoza.Domain.Practice;
namespace Erudoza.Domain.Study;

public sealed record PbeTargetReview(Guid TargetId, int IntervalIndex, long DueAtMs, bool Unresolved, Guid? LastAttemptId, Guid? LastQuestionId, long? LastSuccessfulAtMs);
public sealed record PbeRecallEvidence(Guid AttemptId, Guid TargetId, Guid QuestionId, long AtMs, int EarnedPoints, int AvailablePoints, bool Unaided, bool Recall);
public static class PbeReviewRules
{
    public static PbeTargetReview Initial(Guid target) => new(target, -1, 0, false, null, null, null);
    public static PbeTargetReview Advance(PbeTargetReview state, PbeRecallEvidence e)
    {
        if (state.LastAttemptId == e.AttemptId || !e.Recall) return state;
        var full = e.EarnedPoints == e.AvailablePoints && e.AvailablePoints > 0;
        if (full && !e.Unaided) return state with { LastAttemptId = e.AttemptId };
        if (full && !state.Unresolved && state.IntervalIndex >= 0 && e.AtMs < state.DueAtMs) return state with { LastAttemptId = e.AttemptId, LastQuestionId = e.QuestionId, LastSuccessfulAtMs = e.AtMs };
        var index = full ? Math.Min(3, state.IntervalIndex + 1) : -1;
        return state with { IntervalIndex = index, Unresolved = !full, DueAtMs = e.AtMs + (full ? new[] { 1, 3, 7, 14 }[index] * 86400000L : 0), LastAttemptId = e.AttemptId, LastQuestionId = e.QuestionId, LastSuccessfulAtMs = full ? e.AtMs : state.LastSuccessfulAtMs };
    }
    public static IReadOnlyList<PbeRecallEvidence> Group(PbeQuestion question, IReadOnlyList<PbeTarget> targets, IReadOnlyList<string> answers, Guid attemptId, long atMs, bool unaided)
    {
        PbeRubric.Validate(question, targets); var grade = PbeRubric.Grade(question, answers);
        return grade.Parts.GroupBy(p => p.TargetId).OrderBy(g => g.Key.ToString(), StringComparer.Ordinal).Select(g => new PbeRecallEvidence(attemptId, g.Key, question.Id, atMs, g.Sum(p => p.EarnedPoints), g.Sum(p => p.AvailablePoints), unaided, question.Kind != PbeQuestionKind.TrueFalse && (targets.Single(t => t.Id == g.Key).Skill != RecallSkill.ExactWords || question.Kind == PbeQuestionKind.ExactWords))).ToList();
    }
}
