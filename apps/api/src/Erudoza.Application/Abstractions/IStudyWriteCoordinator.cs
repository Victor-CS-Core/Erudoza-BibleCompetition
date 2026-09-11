namespace Erudoza.Application.Abstractions;

public interface IStudyWriteCoordinator
{
    Task<T> ExecuteAsync<T>(Guid sessionId, Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken);
}
