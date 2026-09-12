namespace Erudoza.Domain;

public sealed class PbeTrainingRecord
{
    public Guid OrganizationId { get; set; }
    public string Kind { get; set; } = "";
    public string Id { get; set; } = "";
    public Guid SeasonId { get; set; }
    public Guid? OwnerId { get; set; }
    public string DataJson { get; set; } = "{}";
    public long Revision { get; set; } = 1;
}
