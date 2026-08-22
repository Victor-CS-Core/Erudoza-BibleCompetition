using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class ReferenceMatchActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => ReferenceMatchGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request) =>
        request.KnowledgeUnit.Kind == KnowledgeUnitKind.ExactVerseText
        && request.RuleProfile.AllowsActivity(
            request.Context.Mode,
            ActivityType,
            isMultipleChoice: request.Context.Mode == StudyMode.Practice);

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var seed = MissingWordsGenerator.StableSeed(request.SourceUnit.Id, request.Context.SessionId, request.Sequence);
        var allowChoices = request.Context.Mode == StudyMode.Practice && request.RuleProfile.StudyAllowMultipleChoice;
        var generated = ReferenceMatchGenerator.Create(
            request.SourceUnit,
            request.DistractorCitations ?? [],
            seed,
            allowChoices);
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
            ProviderType = ReferenceMatchGenerator.ProviderType,
            AnswerMode = allowChoices ? AnswerMode.SelectedChoice : AnswerMode.ShortFact,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = ActivitySerialization.Payload(generated.Payload),
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
