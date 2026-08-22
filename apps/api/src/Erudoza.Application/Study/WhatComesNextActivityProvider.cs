using Erudoza.Application.Abstractions;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Study;

public sealed class WhatComesNextActivityProvider(IClock clock) : IActivityProvider
{
    public string ActivityType => WhatComesNextGenerator.ActivityType;

    public bool CanHandle(ActivityRequest request) =>
        request.NextSourceUnit is not null
        && request.KnowledgeUnit.Kind == KnowledgeUnitKind.ExactVerseText
        && request.RuleProfile.AllowsActivity(request.Context.Mode, ActivityType, isMultipleChoice: false);

    public Task<ChallengeCard> CreateAsync(ActivityRequest request, CancellationToken cancellationToken)
    {
        var generated = WhatComesNextGenerator.Create(request.SourceUnit, request.NextSourceUnit!);
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
            ProviderType = WhatComesNextGenerator.ProviderType,
            AnswerMode = AnswerMode.ExactText,
            EvaluatorVersion = ExactTextEvaluator.Version,
            PayloadJson = ActivitySerialization.Payload(generated.Payload),
            AnswerKeyJson = generated.AnswerKeyJson,
            Sequence = request.Sequence,
            CreatedAtUtc = clock.UtcNow
        });
    }
}
