using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class MissingWordsActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => MissingWordsGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request)
    {
        if (request.KnowledgeUnit.Kind != KnowledgeUnitKind.ExactVerseText)
        {
            return false;
        }

        return request.RuleProfile.AllowsActivity(request.Context.Mode, ActivityType, isMultipleChoice: false);
    }

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var seed = MissingWordsGenerator.StableSeed(
            request.SourceUnit.Id,
            request.Context.SessionId,
            request.Sequence);
        var generated = MissingWordsGenerator.Create(request.SourceUnit, request.Difficulty, seed, request.RuleProfile.GeneratorVersion, request.RuleProfile.EvidenceProfile);

        var card = new ChallengeCard
        {
            Id = Guid.NewGuid(),
            OrganizationId = request.Context.OrganizationId,
            SessionId = request.Context.SessionId,
            StudentUserId = request.Context.StudentId,
            SeasonId = request.Context.SeasonId,
            KnowledgeUnitId = request.KnowledgeUnit.Id,
            SourceUnitId = request.SourceUnit.Id,
            ActivityType = ActivityType,
            ProviderType = MissingWordsGenerator.ProviderType,
            AnswerMode = AnswerMode.ExactText,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = generated.PayloadJson,
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        };

        return Task.FromResult(card);
    }
}
