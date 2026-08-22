using Erudoza.Application.Abstractions;

namespace Erudoza.Infrastructure.Storage;

public sealed class DisabledBlobStorage : IBlobStorage
{
    public string ProviderName => "Disabled";

    public Task<bool> IsHealthyAsync(CancellationToken cancellationToken) => Task.FromResult(true);
}
