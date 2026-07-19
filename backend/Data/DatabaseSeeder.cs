using FitMemory.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Data;

public static class DatabaseSeeder
{
    public static async Task SeedAsync(FitMemoryDbContext db, IConfiguration configuration)
    {
        if (!configuration.GetValue<bool>("SeedDemoData") ||
            await db.UserProfiles.AnyAsync(profile => profile.UserId == "demo-user"))
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        var profile = new UserProfile
        {
            UserId = "demo-user",
            Age = 26,
            HeightCm = 181,
            WeightKg = 78,
            ShoulderWidthCm = 48,
            ChestCircumferenceCm = 102,
            WaistCircumferenceCm = 84,
            FitPreference = FitPreference.Oversized,
            CreatedAt = now,
            UpdatedAt = now
        };
        profile.Orders.Add(new OrderHistoryItem
        {
            UserProfile = profile,
            Brand = "Pull&Bear",
            ProductName = "Heavyweight Oversized T-Shirt",
            Category = "Tops",
            PurchasedSize = "L",
            Outcome = OrderOutcome.KeptGoodFit,
            FitNotes = "Ideal drop shoulder and roomy chest.",
            ChestWidthCm = 60,
            ShoulderWidthCm = 53,
            LengthCm = 73,
            SleeveLengthCm = 25,
            CreatedAt = now,
            UpdatedAt = now
        });
        profile.Orders.Add(new OrderHistoryItem
        {
            UserProfile = profile,
            Brand = "Zara",
            ProductName = "Relaxed Fit T-Shirt",
            Category = "Tops",
            PurchasedSize = "XL",
            Outcome = OrderOutcome.ReturnedTooBaggy,
            ReturnConfirmedByUser = true,
            FitNotes = "Too wide through the body.",
            ChestWidthCm = 65,
            ShoulderWidthCm = 57,
            LengthCm = 76,
            SleeveLengthCm = 27,
            CreatedAt = now,
            UpdatedAt = now
        });

        db.UserProfiles.Add(profile);
        await db.SaveChangesAsync();
    }
}
