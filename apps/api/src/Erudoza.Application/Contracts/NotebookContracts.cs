using System.Text.Json.Serialization;

namespace Erudoza.Application.Contracts;

[JsonConverter(typeof(JsonStringEnumConverter<NotebookKind>))]
public enum NotebookKind
{
    [JsonStringEnumMemberName("highlight")] Highlight,
    [JsonStringEnumMemberName("note")] Note,
    [JsonStringEnumMemberName("bookmark")] Bookmark
}
[JsonConverter(typeof(JsonStringEnumConverter<HighlightColor>))]
public enum HighlightColor { Promises, People, Review }

public sealed record NotebookEntryInput(
    NotebookKind Kind,
    Guid ContentPackId,
    int Chapter,
    Guid? SourceUnitId,
    int? StartOffset,
    int? EndOffset,
    HighlightColor? Color,
    string? Note);

public sealed record NotebookEntryDto(
    Guid Id,
    NotebookKind Kind,
    Guid ContentPackId,
    int Chapter,
    Guid? SourceUnitId,
    int? StartOffset,
    int? EndOffset,
    HighlightColor? Color,
    string? Note,
    string BookName,
    string Citation,
    string Quote,
    DateTimeOffset UpdatedAtUtc);

public sealed record StudyNotebookDto(long Version, IReadOnlyList<NotebookEntryDto> Entries);
