using System.Text.Json;
using Erudoza.Application.Abstractions;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Microsoft.EntityFrameworkCore;

namespace Erudoza.Application.Generation;

public sealed class QuestionReviewService(
    IErudozaDbContext db,
    ICompetitionScopeResolver scopeResolver,
    IGenerativeQuestionService generator,
    IQuestionCandidateValidator validator,
    IQuestionLifecycleService lifecycle,
    IClock clock)
{
    public const int DefaultCandidateCount = 3;

    public async Task<GenerationJobDto> RunJobAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var season = await db.Seasons.AsNoTracking().SingleOrDefaultAsync(
            item => item.Id == seasonId && item.OrganizationId == organizationId,
            cancellationToken) ?? throw new DomainException("Season was not found.");

        var allowed = await scopeResolver.ResolveAsync(organizationId, season.Id, cancellationToken);
        if (allowed.Count == 0)
        {
            throw new DomainException("Generation requires a resolved competition scope.");
        }

        var job = new GenerationJob
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            SeasonId = season.Id,
            Status = GenerationJobStatus.Running,
            PromptVersionKey = "scaffold-v1",
            CreatedAtUtc = clock.UtcNow
        };
        db.GenerationJobs.Add(job);
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            var units = await db.SourceUnits.AsNoTracking()
                .Where(item => item.OrganizationId == organizationId && allowed.Contains(item.Id))
                .OrderBy(item => item.Ordinal)
                .Take(DefaultCandidateCount)
                .ToListAsync(cancellationToken);

            foreach (var unit in units)
            {
                var generated = await generator.GenerateAsync(
                    new QuestionGenerationContext(organizationId, season.Id, [unit.Id]),
                    cancellationToken);
                var validation = await validator.ValidateAsync(
                    generated,
                    new QuestionValidationContext(organizationId, season.Id, allowed),
                    cancellationToken);

                var candidate = new QuestionCandidate
                {
                    Id = Guid.NewGuid(),
                    OrganizationId = organizationId,
                    SeasonId = season.Id,
                    SchemaVersion = generated.SchemaVersion,
                    QuestionType = generated.QuestionType,
                    Prompt = generated.Prompt,
                    AnswerMode = Enum.TryParse<AnswerMode>(generated.AnswerMode, true, out var mode) ? mode : AnswerMode.ShortFact,
                    CanonicalAnswer = generated.CanonicalAnswer,
                    AcceptedAnswersJson = JsonSerializer.Serialize(generated.AcceptedAnswers),
                    Difficulty = generated.Difficulty,
                    Explanation = validation.IsValid
                        ? generated.Explanation
                        : string.Join(" ", validation.Errors),
                    GeneratorVersion = generated.GeneratorVersion,
                    Status = validation.IsValid ? QuestionLifecycleStatus.Validated : QuestionLifecycleStatus.Rejected,
                    CreatedAtUtc = clock.UtcNow
                };
                db.QuestionCandidates.Add(candidate);
                foreach (var evidence in generated.SourceEvidence)
                {
                    db.QuestionEvidence.Add(new QuestionEvidence
                    {
                        Id = Guid.NewGuid(),
                        QuestionCandidateId = candidate.Id,
                        SourceUnitId = evidence.SourceUnitId,
                        EvidenceText = evidence.EvidenceText
                    });
                }
            }

            job.Status = GenerationJobStatus.Completed;
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            job.Status = GenerationJobStatus.Failed;
            job.Error = exception.Message;
            await db.SaveChangesAsync(cancellationToken);
            throw new DomainException("Question generation failed before review.");
        }

        return await ToJobDto(job, cancellationToken);
    }

    public async Task<IReadOnlyList<QuestionReviewDto>> ListAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var candidates = await db.QuestionCandidates.AsNoTracking()
            .Include(item => item.Evidence)
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .OrderByDescending(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var sourceIds = candidates.SelectMany(item => item.Evidence).Select(item => item.SourceUnitId).Distinct().ToList();
        var sources = await db.SourceUnits.AsNoTracking()
            .Where(item => sourceIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        return candidates.Select(item => new QuestionReviewDto(
            item.Id,
            item.SeasonId,
            item.Prompt,
            item.CanonicalAnswer,
            item.Status.ToString(),
            item.QuestionType,
            item.GeneratorVersion,
            item.Explanation,
            item.Evidence.Select(evidence => new QuestionEvidenceDto(
                evidence.SourceUnitId,
                sources.TryGetValue(evidence.SourceUnitId, out var unit) ? unit.CitationLabel : "Unknown",
                evidence.EvidenceText)).ToList())).ToList();
    }

    public Task<Guid> ApproveAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        lifecycle.ApproveStoredCandidateAsync(organizationId, candidateId, cancellationToken);

    public Task RejectAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
        lifecycle.RejectStoredCandidateAsync(organizationId, candidateId, cancellationToken);

    public async Task<IReadOnlyList<GenerationJobDto>> ListJobsAsync(
        Guid organizationId,
        Guid seasonId,
        CancellationToken cancellationToken)
    {
        var jobs = await db.GenerationJobs.AsNoTracking()
            .Where(item => item.OrganizationId == organizationId && item.SeasonId == seasonId)
            .OrderByDescending(item => item.CreatedAtUtc)
            .ToListAsync(cancellationToken);
        var result = new List<GenerationJobDto>();
        foreach (var job in jobs)
        {
            result.Add(await ToJobDto(job, cancellationToken));
        }

        return result;
    }

    private async Task<GenerationJobDto> ToJobDto(GenerationJob job, CancellationToken cancellationToken)
    {
        var count = await db.QuestionCandidates.CountAsync(
            item => item.OrganizationId == job.OrganizationId && item.SeasonId == job.SeasonId,
            cancellationToken);
        return new GenerationJobDto(job.Id, job.SeasonId, job.Status.ToString(), job.Error, job.CreatedAtUtc, count);
    }
}
