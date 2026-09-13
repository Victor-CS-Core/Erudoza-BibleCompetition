using Erudoza.Domain;
using Microsoft.AspNetCore.Mvc;

namespace Erudoza.Api.Auth;

public sealed class ExceptionMappingMiddleware(RequestDelegate next, IHostEnvironment environment, ILogger<ExceptionMappingMiddleware> logger)
{
    public async Task Invoke(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Erudoza.Application.Study.TrainingConflictException exception)
        {
            await WriteProblem(context, StatusCodes.Status409Conflict, exception.Message, exception);
        }
        catch (Erudoza.Application.Study.ScriptureNotebookConflictException exception)
        {
            await WriteProblem(context, StatusCodes.Status409Conflict, exception.Message, exception);
        }
        catch (Erudoza.Application.Study.ScriptureNotebookEntryNotFoundException exception)
        {
            await WriteProblem(context, StatusCodes.Status404NotFound, exception.Message, exception);
        }
        catch (DomainException exception)
        {
            await WriteProblem(context, StatusCodes.Status400BadRequest, exception.Message, exception);
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Unhandled exception for {Path}", context.Request.Path);
            var detail = environment.IsProduction()
                ? "An unexpected error occurred."
                : exception.Message;
            await WriteProblem(context, StatusCodes.Status500InternalServerError, detail, exception, includeStack: !environment.IsProduction());
        }
    }

    private static async Task WriteProblem(
        HttpContext context,
        int status,
        string detail,
        Exception exception,
        bool includeStack = false)
    {
        context.Response.StatusCode = status;
        var problem = new ProblemDetails
        {
            Status = status,
            Title = status == 400 ? "Request cannot be completed." : "Server error",
            Detail = detail,
            Type = "https://httpstatuses.io/" + status
        };
        problem.Extensions["correlationId"] = context.Items[CorrelationMiddleware.ItemKey];
        if (includeStack)
        {
            problem.Extensions["exception"] = exception.GetType().Name;
        }

        await context.Response.WriteAsJsonAsync(problem);
    }
}
