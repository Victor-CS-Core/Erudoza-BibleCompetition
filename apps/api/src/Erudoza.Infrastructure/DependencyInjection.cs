using Erudoza.Application.Abstractions;
using Erudoza.Application.Assignments;
using Erudoza.Application.Competitions;
using Erudoza.Application.Content;
using Erudoza.Application.Generation;
using Erudoza.Application.Identity;
using Erudoza.Application.Progress;
using Erudoza.Application.Study;
using Erudoza.Infrastructure.Content;
using Erudoza.Infrastructure.Generation;
using Erudoza.Infrastructure.Persistence;
using Erudoza.Infrastructure.Security;
using Erudoza.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Erudoza.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddErudozaInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var provider = configuration["Database:Provider"] ?? "Sqlite";
        var connectionString = configuration["Database:ConnectionString"] ?? "Data Source=erudoza.dev.db";

        services.AddDbContext<ErudozaDbContext>(options =>
        {
            if (string.Equals(provider, "SqlServer", StringComparison.OrdinalIgnoreCase))
            {
                options.UseSqlServer(connectionString);
            }
            else
            {
                options.UseSqlite(connectionString);
            }
        });
        services.AddScoped<IErudozaDbContext>(sp => sp.GetRequiredService<ErudozaDbContext>());
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IPasswordHasher, Pbkdf2PasswordHasher>();
        services.AddSingleton<IBlobStorage, DisabledBlobStorage>();
        services.AddScoped<IAuditService, AuditService>();
        services.AddScoped<DevelopmentSeeder>();
        services.AddScoped<ICompetitionScopeResolver, CompetitionScopeResolver>();
        services.AddScoped<IStudentStudyScopeService, StudentStudyScopeService>();
        services.AddScoped<ContentImportService>();
        services.AddScoped<SeasonWorkflowService>();
        services.AddScoped<SeasonCoverageService>();
        services.AddScoped<ProgressQueryService>();
        services.AddScoped<StudentDirectoryService>();
        services.AddScoped<IActivityProvider, MissingWordsActivityProvider>();
        services.AddScoped<IActivityProvider, VerseBuilderActivityProvider>();
        services.AddScoped<IActivityProvider, ReferenceMatchActivityProvider>();
        services.AddScoped<IActivityProvider, WhatComesNextActivityProvider>();
        services.AddScoped<IActivityProvider, PlayableShortAnswerActivityProvider>();
        services.AddScoped<IActivityProvider, TrueFalseActivityProvider>();
        services.AddScoped<IStudyEngine>(sp => new StudyEngine(
            sp.GetRequiredService<IErudozaDbContext>(),
            sp.GetRequiredService<IStudentStudyScopeService>(),
            sp.GetServices<IActivityProvider>().ToList()));
        services.AddScoped<IMasteryService, MasteryService>();
        services.AddScoped<StudySessionService>();
        services.AddHttpClient("openai");
        services.AddHttpClient("bible-api", client =>
        {
            client.BaseAddress = new Uri("https://bible-api.com/");
            client.Timeout = TimeSpan.FromSeconds(30);
        });
        services.AddScoped<IBibleTextClient, BibleApiTextClient>();
        services.AddScoped<ScriptureCatalogService>();
        services.AddScoped<FakeGenerativeQuestionService>();
        services.AddScoped<IGenerativeQuestionService, OpenAiGenerativeQuestionService>();
        services.AddScoped<IQuestionCandidateValidator, QuestionCandidateValidator>();
        services.AddScoped<IQuestionLifecycleService, QuestionLifecycleService>();
        services.AddScoped<QuestionReviewService>();
        return services;
    }
}
