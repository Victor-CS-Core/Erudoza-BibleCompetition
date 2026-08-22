using System.Text.Json;
using Erudoza.Application.Contracts;
using Erudoza.Domain;
using Erudoza.Domain.Study;

namespace Erudoza.Application.Mapping;

public static class DtoMapper
{
    public static SeasonDto ToSeasonDto(
        CompetitionSeason season,
        RuleProfile profile,
        int scopeUnitCount,
        int assignmentCount) =>
        new(
            season.Id,
            season.OrganizationId,
            season.Name,
            season.YearLabel,
            season.Status.ToString(),
            profile.Key,
            profile.Version,
            season.StartDate,
            season.TargetCompetitionDate,
            scopeUnitCount,
            assignmentCount);

    public static StudentDto ToStudentDto(ApplicationUser user) =>
        new(user.Id, user.UserName, user.DisplayName, user.Email);

    public static AssignmentDto ToAssignmentDto(Assignment assignment)
    {
        var scope = assignment.Scopes.First();
        return new AssignmentDto(
            assignment.Id,
            assignment.StudentUserId,
            assignment.Type.ToString(),
            scope.BookKey,
            scope.StartChapter,
            scope.StartVerse,
            scope.EndChapter,
            scope.EndVerse);
    }

    public static ChallengeCardDto ToChallengeCardDto(ChallengeCard card, SourceUnit source, int total, bool exposeDebug)
    {
        var payload = JsonSerializer.Deserialize<MissingWordsPayload>(card.PayloadJson)
            ?? throw new DomainException("Challenge payload is invalid.");
        var answer = exposeDebug
            ? JsonSerializer.Deserialize<MissingWordsAnswerKey>(card.AnswerKeyJson)?.CanonicalAnswer
            : null;

        return new ChallengeCardDto(
            card.Id,
            card.SessionId,
            card.ActivityType,
            source.CitationLabel,
            payload.Prompt,
            payload.Tokens.Select(token => new ChallengeTokenDto(token.Hidden ? "____" : token.Text, token.Hidden, token.Index)).ToList(),
            card.Sequence,
            total,
            answer);
    }
}
