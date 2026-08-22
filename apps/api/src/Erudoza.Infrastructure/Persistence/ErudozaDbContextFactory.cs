using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Erudoza.Infrastructure.Persistence;

public sealed class ErudozaDbContextFactory : IDesignTimeDbContextFactory<ErudozaDbContext>
{
    public ErudozaDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<ErudozaDbContext>()
            .UseSqlite("Data Source=erudoza.design.db")
            .Options;
        return new ErudozaDbContext(options);
    }
}
