using Erudoza.Application.Study;

namespace Erudoza.Api.Practice;

public sealed class PbeSoloExpiryTicker(IServiceScopeFactory factory, ILogger<PbeSoloExpiryTicker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        string? afterId = null;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                using var scope = factory.CreateScope();
                afterId = await scope.ServiceProvider.GetRequiredService<PbeSoloExpiryProcessor>().RunOnceAsync(afterId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { logger.LogError(error, "PBE solo expiry delivery failed"); }
        }
    }
}
