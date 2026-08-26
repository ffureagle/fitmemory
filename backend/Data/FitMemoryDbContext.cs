using FitMemory.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Data;

public sealed class FitMemoryDbContext(DbContextOptions<FitMemoryDbContext> options)
    : DbContext(options)
{
    public DbSet<UserAccount> UserAccounts => Set<UserAccount>();

    public DbSet<UserSession> UserSessions => Set<UserSession>();

    public DbSet<UserProfile> UserProfiles => Set<UserProfile>();

    public DbSet<OrderHistoryItem> OrderHistoryItems => Set<OrderHistoryItem>();

    public DbSet<FitRecommendation> FitRecommendations => Set<FitRecommendation>();

    public DbSet<StyleBoardItem> StyleBoardItems => Set<StyleBoardItem>();

    public DbSet<FavoriteOutfit> FavoriteOutfits => Set<FavoriteOutfit>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<UserAccount>(entity =>
        {
            entity.HasIndex(account => account.PublicId).IsUnique();
            entity.HasIndex(account => account.NormalizedEmail).IsUnique();
            entity.Property(account => account.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.Property(account => account.UpdatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.HasIndex(session => session.TokenHash).IsUnique();
            entity.HasIndex(session => session.ExpiresAt);
            entity.Property(session => session.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.Property(session => session.ExpiresAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity
                .HasOne(session => session.UserAccount)
                .WithMany(account => account.Sessions)
                .HasForeignKey(session => session.UserAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserProfile>(entity =>
        {
            entity.HasIndex(profile => profile.UserId).IsUnique();
            entity.HasIndex(profile => profile.UserAccountId).IsUnique();
            entity.Property(profile => profile.FitPreference).HasConversion<string>();
            entity.Property(profile => profile.HeightCm).HasPrecision(6, 2);
            entity.Property(profile => profile.WeightKg).HasPrecision(6, 2);
            entity.Property(profile => profile.ShoulderWidthCm).HasPrecision(6, 2);
            entity.Property(profile => profile.WaistCircumferenceCm).HasPrecision(6, 2);
            entity.Property(profile => profile.HipCircumferenceCm).HasPrecision(6, 2);
            entity.Property(profile => profile.FrontWaistCm).HasPrecision(5, 2);
            entity.Property(profile => profile.InseamCm).HasPrecision(6, 2);
            entity.Property(profile => profile.BackWaistCm).HasPrecision(5, 2);
            entity.Property(profile => profile.FootLengthCm).HasPrecision(5, 2);
            entity.Property(profile => profile.UsualShoeSizeEu).HasPrecision(4, 1);
            entity.Property(profile => profile.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.Property(profile => profile.UpdatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity
                .HasOne(profile => profile.UserAccount)
                .WithOne(account => account.Profile)
                .HasForeignKey<UserProfile>(profile => profile.UserAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<StyleBoardItem>(entity =>
        {
            entity.HasIndex(item => new
            {
                item.UserProfileId,
                item.ProductUrl
            }).IsUnique();
            entity.Property(item => item.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.Property(item => item.UpdatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity
                .HasOne(item => item.UserProfile)
                .WithMany(profile => profile.StyleBoardItems)
                .HasForeignKey(item => item.UserProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<FavoriteOutfit>(entity =>
        {
            entity.HasIndex(item => new { item.UserProfileId, item.CreatedAt });
            entity.Property(item => item.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity
                .HasOne(item => item.UserProfile)
                .WithMany(profile => profile.FavoriteOutfits)
                .HasForeignKey(item => item.UserProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<OrderHistoryItem>(entity =>
        {
            entity.HasIndex(order => new { order.UserProfileId, order.ImportFingerprint })
                .IsUnique();
            entity.HasIndex(order => order.ProductFamilyKey);
            entity.Property(order => order.Outcome).HasConversion<string>();
            entity.Property(order => order.ChestWidthCm).HasPrecision(6, 2);
            entity.Property(order => order.ShoulderWidthCm).HasPrecision(6, 2);
            entity.Property(order => order.WaistWidthCm).HasPrecision(6, 2);
            entity.Property(order => order.LengthCm).HasPrecision(6, 2);
            entity.Property(order => order.SleeveLengthCm).HasPrecision(6, 2);
            entity.Property(order => order.InseamCm).HasPrecision(6, 2);
            entity.Property(order => order.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.Property(order => order.UpdatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity
                .HasOne(order => order.UserProfile)
                .WithMany(profile => profile.Orders)
                .HasForeignKey(order => order.UserProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<FitRecommendation>(entity =>
        {
            entity.Property(recommendation => recommendation.CreatedAt).HasConversion(
                value => value.UtcTicks,
                value => new DateTimeOffset(value, TimeSpan.Zero));
            entity.HasIndex(recommendation => new
            {
                recommendation.UserProfileId,
                recommendation.ProductUrl,
                recommendation.CreatedAt
            });
            entity
                .HasOne(recommendation => recommendation.UserProfile)
                .WithMany(profile => profile.Recommendations)
                .HasForeignKey(recommendation => recommendation.UserProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}
