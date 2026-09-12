namespace Erudoza.Application.Contracts;

public sealed record PbeQuestionView(
    Guid Id,
    int Version,
    string Prompt,
    string Reference,
    string Kind,
    IReadOnlyList<int> PartPoints,
    int Points,
    int DurationSeconds);
