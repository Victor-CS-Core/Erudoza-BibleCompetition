using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class PlayableShortAnswerActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => ShortAnswerGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request) =>
        request.PlayableQuestion?.QuestionCandidate is not null
        && request.KnowledgeUnit.Kind == KnowledgeUnitKind.ExactVerseText
        && request.RuleProfile.AllowsActivity(request.Context.Mode, ActivityType, isMultipleChoice: false);

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var question = request.PlayableQuestion!.QuestionCandidate!;
        var generated = ShortAnswerGenerator.Create(question, request.SourceUnit);
        return Task.FromResult(new ChallengeCard
        {
            Id = Guid.NewGuid(),
            OrganizationId = request.Context.OrganizationId,
            SessionId = request.Context.SessionId,
            StudentUserId = request.Context.StudentId,
            SeasonId = request.Context.SeasonId,
            KnowledgeUnitId = request.KnowledgeUnit.Id,
            SourceUnitId = request.SourceUnit.Id,
            ActivityType = ActivityType,
            ProviderType = ShortAnswerGenerator.ProviderType,
            AnswerMode = AnswerMode.ShortFact,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = ActivitySerialization.Payload(generated.Payload),
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
