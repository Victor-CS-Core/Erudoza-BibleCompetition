using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class VerseBuilderActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => VerseBuilderGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request)
    {
        var wordCount = request.SourceUnit.CanonicalText.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        return wordCount >= 4
            && request.KnowledgeUnit.Kind == KnowledgeUnitKind.ExactVerseText
            && request.RuleProfile.AllowsActivity(request.Context.Mode, ActivityType, isMultipleChoice: false);
    }

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var seed = MissingWordsGenerator.StableSeed(request.SourceUnit.Id, request.Context.SessionId, request.Sequence);
        var generated = VerseBuilderGenerator.Create(request.SourceUnit, seed, request.Difficulty, request.RuleProfile.GeneratorVersion, request.RuleProfile.EvidenceProfile);
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
            ProviderType = VerseBuilderGenerator.ProviderType,
            AnswerMode = AnswerMode.OrderedSequence,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = ActivitySerialization.Payload(generated.Payload),
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
