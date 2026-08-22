using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class TrueFalseActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => TrueFalseGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request)
    {
        if (request.KnowledgeUnit.Kind != KnowledgeUnitKind.ExactVerseText)
        {
            return false;
        }

        var used = request.UsedActivityTypes?.Count(item => item == ActivityType) ?? 0;
        return request.RuleProfile.AllowsAnotherTrueFalse(request.Context.Mode, used, request.TargetCardCount);
    }

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var seed = MissingWordsGenerator.StableSeed(request.SourceUnit.Id, request.Context.SessionId, request.Sequence);
        var generated = TrueFalseGenerator.Create(request.SourceUnit, request.AlternateSourceUnit, seed);
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
            ProviderType = TrueFalseGenerator.ProviderType,
            AnswerMode = AnswerMode.ShortFact,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = ActivitySerialization.Payload(generated.Payload),
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
