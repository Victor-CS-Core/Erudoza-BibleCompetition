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

    public static AssignmentDto ToAssignmentDto(Assignment assignment, ApplicationUser? student = null)
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
            scope.EndVerse,
            student?.DisplayName,
            student?.UserName);
    }

    public static ChallengeCardDto ToChallengeCardDto(
        ChallengeCard card,
        SourceUnit source,
        int total,
        bool exposeDebug,
        bool showCitation = true)
    {
        var payload = ActivitySerialization.ReadPayload(card.PayloadJson);
        var answer = exposeDebug ? ActivitySerialization.ReadAnswerKey(card.AnswerKeyJson).CanonicalAnswer : null;
        var prompt = card.ActivityType == ReferenceMatchGenerator.ActivityType
            ? source.CanonicalText
            : payload.Prompt;
        if (card.ActivityType == WhatComesNextGenerator.ActivityType)
        {
            prompt = $"{payload.Prompt} {source.CanonicalText}";
        }

        return new ChallengeCardDto(
            card.Id,
            card.SessionId,
            card.ActivityType,
            showCitation ? source.CitationLabel : "Assigned passage",
            prompt,
            payload.Tokens.Select(token => new ChallengeTokenDto(token.Hidden ? "____" : token.Text, token.Hidden, token.Index)).ToList(),
            card.Sequence,
            total,
            answer,
            payload.Choices is { Count: > 0 } ? payload.Choices : null);
    }
}
