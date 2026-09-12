namespace Erudoza.Application.Study;

public sealed record PbeResultReview(string Id, string Status, long Revision, Guid QuestionId, int QuestionVersion, int[]? PointsByPart);
public sealed record PbeResultOverlay(string Id, string Activity, string SessionId, Dictionary<string, PbeResultReview> Entries);
