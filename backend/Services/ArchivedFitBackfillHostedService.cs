using FitMemory.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Services;

public sealed class ArchivedFitBackfillHostedService(
    IServiceScopeFactory scopeFactory,
    ILogger<ArchivedFitBackfillHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<FitMemoryDbContext>();
            var assessmentService =
                scope.ServiceProvider.GetRequiredService<ArchivedFitAssessmentService>();
            var productIdentityService =
                scope.ServiceProvider.GetRequiredService<ProductIdentityService>();
            var profiles = await db.UserProfiles
                .Include(profile => profile.Orders)
                .ToListAsync(stoppingToken);
            foreach (var profile in profiles)
            {
                foreach (var order in profile.Orders)
                {
                    order.ProductFamilyKey = productIdentityService.BuildFamilyKey(
                        order.Brand,
                        order.ProductName,
                        order.ProductUrl);
                    assessmentService.Apply(profile, order);
                }
            }

            await db.SaveChangesAsync(stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // shutdown
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Archived fit backfill failed after listen; API stays up.");
        }
    }
}
