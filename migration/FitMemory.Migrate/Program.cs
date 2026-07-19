using FitMemory.Api.Data;
using FitMemory.Api.Models;
using Microsoft.EntityFrameworkCore;

var options = MigrationOptions.Parse(args);
var sqlitePath = Path.GetFullPath(options.SqlitePath);
if (!File.Exists(sqlitePath))
{
    throw new FileNotFoundException(
        "Kaynak SQLite veritabanı bulunamadı.",
        sqlitePath);
}

var sourceOptions = new DbContextOptionsBuilder<FitMemoryDbContext>()
    .UseSqlite($"Data Source={sqlitePath};Mode=ReadOnly")
    .Options;
var destinationOptions = new DbContextOptionsBuilder<FitMemoryDbContext>()
    .UseNpgsql(
        options.PostgresConnectionString,
        npgsql => npgsql.EnableRetryOnFailure(5))
    .Options;

await using var source = new FitMemoryDbContext(sourceOptions);
await using var destination = new FitMemoryDbContext(destinationOptions);

if (!await source.Database.CanConnectAsync())
{
    throw new InvalidOperationException(
        "Kaynak SQLite veritabanına bağlanılamadı.");
}

await destination.Database.EnsureCreatedAsync();
if (!await destination.Database.CanConnectAsync())
{
    throw new InvalidOperationException(
        "Hedef PostgreSQL veritabanına bağlanılamadı.");
}

var destinationHasData =
    await destination.UserAccounts.AnyAsync() ||
    await destination.UserProfiles.AnyAsync() ||
    await destination.OrderHistoryItems.AnyAsync() ||
    await destination.FitRecommendations.AnyAsync() ||
    await destination.StyleBoardItems.AnyAsync();
if (destinationHasData && !options.ReplaceDestination)
{
    throw new InvalidOperationException(
        "Hedef PostgreSQL veritabanı boş değil. " +
        "Mevcut hedef veriyi bilinçli olarak silmek için --replace kullanın.");
}

await using var transaction =
    await destination.Database.BeginTransactionAsync();
if (destinationHasData)
{
    await destination.StyleBoardItems.ExecuteDeleteAsync();
    await destination.FitRecommendations.ExecuteDeleteAsync();
    await destination.OrderHistoryItems.ExecuteDeleteAsync();
    await destination.UserSessions.ExecuteDeleteAsync();
    await destination.UserProfiles.ExecuteDeleteAsync();
    await destination.UserAccounts.ExecuteDeleteAsync();
}

var sourceAccounts = await source.UserAccounts
    .AsNoTracking()
    .OrderBy(account => account.Id)
    .ToListAsync();
var accountMap = new Dictionary<int, UserAccount>();
foreach (var account in sourceAccounts)
{
    var copy = new UserAccount
    {
        PublicId = account.PublicId,
        Email = account.Email,
        NormalizedEmail = account.NormalizedEmail,
        DisplayName = account.DisplayName,
        PasswordHash = account.PasswordHash,
        CreatedAt = account.CreatedAt,
        UpdatedAt = account.UpdatedAt
    };
    destination.UserAccounts.Add(copy);
    accountMap.Add(account.Id, copy);
}
await destination.SaveChangesAsync();

var sourceProfiles = await source.UserProfiles
    .AsNoTracking()
    .OrderBy(profile => profile.Id)
    .ToListAsync();
var profileMap = new Dictionary<int, UserProfile>();
foreach (var profile in sourceProfiles)
{
    var linkedAccount =
        profile.UserAccountId is int accountId &&
        accountMap.TryGetValue(accountId, out var account)
            ? account
            : null;
    var copy = new UserProfile
    {
        UserAccountId = linkedAccount?.Id,
        UserAccount = linkedAccount,
        UserId = profile.UserId,
        Age = profile.Age,
        HeightCm = profile.HeightCm,
        WeightKg = profile.WeightKg,
        ShoulderWidthCm = profile.ShoulderWidthCm,
        ChestCircumferenceCm = profile.ChestCircumferenceCm,
        WaistCircumferenceCm = profile.WaistCircumferenceCm,
        FootLengthCm = profile.FootLengthCm,
        UsualShoeSizeEu = profile.UsualShoeSizeEu,
        FitPreference = profile.FitPreference,
        CreatedAt = profile.CreatedAt,
        UpdatedAt = profile.UpdatedAt
    };
    destination.UserProfiles.Add(copy);
    profileMap.Add(profile.Id, copy);
}
await destination.SaveChangesAsync();

var activeSessions = await source.UserSessions
    .AsNoTracking()
    .Where(session => session.ExpiresAt > DateTimeOffset.UtcNow)
    .OrderBy(session => session.Id)
    .ToListAsync();
foreach (var session in activeSessions)
{
    if (!accountMap.TryGetValue(
            session.UserAccountId,
            out var linkedAccount))
    {
        continue;
    }

    destination.UserSessions.Add(new UserSession
    {
        UserAccountId = linkedAccount.Id,
        UserAccount = linkedAccount,
        TokenHash = session.TokenHash,
        CreatedAt = session.CreatedAt,
        ExpiresAt = session.ExpiresAt
    });
}

var sourceOrders = await source.OrderHistoryItems
    .AsNoTracking()
    .OrderBy(order => order.Id)
    .ToListAsync();
foreach (var order in sourceOrders)
{
    if (!profileMap.TryGetValue(
            order.UserProfileId,
            out var linkedProfile))
    {
        continue;
    }

    destination.OrderHistoryItems.Add(new OrderHistoryItem
    {
        UserProfileId = linkedProfile.Id,
        UserProfile = linkedProfile,
        Brand = order.Brand,
        ProductName = order.ProductName,
        Category = order.Category,
        PurchasedSize = order.PurchasedSize,
        Outcome = order.Outcome,
        ReturnConfirmedByUser = order.ReturnConfirmedByUser,
        FitNotes = order.FitNotes,
        UserFitNotes = order.UserFitNotes,
        ChestWidthCm = order.ChestWidthCm,
        ShoulderWidthCm = order.ShoulderWidthCm,
        WaistWidthCm = order.WaistWidthCm,
        LengthCm = order.LengthCm,
        SleeveLengthCm = order.SleeveLengthCm,
        InseamCm = order.InseamCm,
        ProductUrl = order.ProductUrl,
        ImageUrl = order.ImageUrl,
        ProductFamilyKey = order.ProductFamilyKey,
        ResearchSourceUrl = order.ResearchSourceUrl,
        FitLabel = order.FitLabel,
        SizeEvidence = order.SizeEvidence,
        ResearchConfidence = order.ResearchConfidence,
        FitScore = order.FitScore,
        FitAssessment = order.FitAssessment,
        FitAssessmentConfidence = order.FitAssessmentConfidence,
        CreatedAt = order.CreatedAt,
        UpdatedAt = order.UpdatedAt
    });
}

var sourceRecommendations = await source.FitRecommendations
    .AsNoTracking()
    .OrderBy(recommendation => recommendation.Id)
    .ToListAsync();
foreach (var recommendation in sourceRecommendations)
{
    if (!profileMap.TryGetValue(
            recommendation.UserProfileId,
            out var linkedProfile))
    {
        continue;
    }

    destination.FitRecommendations.Add(new FitRecommendation
    {
        UserProfileId = linkedProfile.Id,
        UserProfile = linkedProfile,
        ProductUrl = recommendation.ProductUrl,
        Brand = recommendation.Brand,
        ProductName = recommendation.ProductName,
        RecommendedSize = recommendation.RecommendedSize,
        Confidence = recommendation.Confidence,
        Verdict = recommendation.Verdict,
        Explanation = recommendation.Explanation,
        EvidenceSummary = recommendation.EvidenceSummary,
        DataSource = recommendation.DataSource,
        ComparisonsJson = recommendation.ComparisonsJson,
        FitNotesJson = recommendation.FitNotesJson,
        StyleJson = recommendation.StyleJson,
        CreatedAt = recommendation.CreatedAt
    });
}

var sourceStyleItems = await source.StyleBoardItems
    .AsNoTracking()
    .OrderBy(item => item.Id)
    .ToListAsync();
foreach (var item in sourceStyleItems)
{
    if (!profileMap.TryGetValue(
            item.UserProfileId,
            out var linkedProfile))
    {
        continue;
    }

    destination.StyleBoardItems.Add(new StyleBoardItem
    {
        UserProfileId = linkedProfile.Id,
        UserProfile = linkedProfile,
        ProductUrl = item.ProductUrl,
        Brand = item.Brand,
        ProductName = item.ProductName,
        Category = item.Category,
        Price = item.Price,
        ImageUrl = item.ImageUrl,
        ProductReference = item.ProductReference,
        FitLabel = item.FitLabel,
        FitEvidence = item.FitEvidence,
        Description = item.Description,
        RecommendedSize = item.RecommendedSize,
        RecommendationConfidence = item.RecommendationConfidence,
        IsSelected = item.IsSelected,
        CreatedAt = item.CreatedAt,
        UpdatedAt = item.UpdatedAt
    });
}

await destination.SaveChangesAsync();
await transaction.CommitAsync();

var result = new
{
    Accounts = await destination.UserAccounts.CountAsync(),
    Profiles = await destination.UserProfiles.CountAsync(),
    ActiveSessions = await destination.UserSessions.CountAsync(),
    Orders = await destination.OrderHistoryItems.CountAsync(),
    Recommendations = await destination.FitRecommendations.CountAsync(),
    StyleBoardItems = await destination.StyleBoardItems.CountAsync()
};

Console.WriteLine("FitMemory SQLite → PostgreSQL taşıması tamamlandı.");
Console.WriteLine(
    $"Hesap: {result.Accounts}, profil: {result.Profiles}, " +
    $"aktif oturum: {result.ActiveSessions}, dolap: {result.Orders}, " +
    $"öneri: {result.Recommendations}, stüdyo: {result.StyleBoardItems}");

internal sealed record MigrationOptions(
    string SqlitePath,
    string PostgresConnectionString,
    bool ReplaceDestination)
{
    public static MigrationOptions Parse(string[] arguments)
    {
        string? sqlitePath = null;
        string? postgres = null;
        var replace = false;
        for (var index = 0; index < arguments.Length; index++)
        {
            switch (arguments[index])
            {
                case "--sqlite" when index + 1 < arguments.Length:
                    sqlitePath = arguments[++index];
                    break;
                case "--postgres" when index + 1 < arguments.Length:
                    postgres = arguments[++index];
                    break;
                case "--replace":
                    replace = true;
                    break;
                default:
                    throw new ArgumentException(
                        $"Bilinmeyen veya eksik argüman: {arguments[index]}");
            }
        }

        sqlitePath ??=
            Environment.GetEnvironmentVariable("SQLITE_PATH") ??
            Path.Combine("backend", "fitmemory.db");
        postgres ??=
            Environment.GetEnvironmentVariable(
                "POSTGRES_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(postgres))
        {
            throw new ArgumentException(
                "Hedef PostgreSQL bağlantısını --postgres veya " +
                "POSTGRES_CONNECTION_STRING ile verin.");
        }

        return new MigrationOptions(sqlitePath, postgres, replace);
    }
}
