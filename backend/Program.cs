using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Security;
using FitMemory.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
    {
        if (context.Exception is null)
        {
            return;
        }

        context.ProblemDetails.Status = StatusCodes.Status500InternalServerError;
        context.ProblemDetails.Title = "Tarama işlenirken sunucu hatası oluştu";
        context.ProblemDetails.Detail =
            "Tarama verileri kaydedilmedi. Sayfayı yenileyip yeniden deneyin. " +
            $"Sorun sürerse destek için takip kodu: {context.HttpContext.TraceIdentifier}";
        context.ProblemDetails.Extensions["traceId"] =
            context.HttpContext.TraceIdentifier;
    };
});
var configuredOrigins = (
        builder.Configuration["APP_ORIGINS"] ??
        builder.Configuration["Cors:Origins"] ??
        "")
    .Split(
        ',',
        StringSplitOptions.RemoveEmptyEntries |
        StringSplitOptions.TrimEntries)
    .Select(origin => origin.TrimEnd('/'))
    .ToHashSet(StringComparer.OrdinalIgnoreCase);
builder.Services.AddCors(options =>
{
    options.AddPolicy("FitMemoryClients", policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                {
                    return false;
                }

                return uri.Scheme == "chrome-extension" ||
                       uri.Host is "localhost" or "127.0.0.1" ||
                       configuredOrigins.Contains(origin.TrimEnd('/'));
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});
builder.Services
    .AddAuthentication(SessionAuthenticationDefaults.Scheme)
    .AddScheme<AuthenticationSchemeOptions, SessionAuthenticationHandler>(
        SessionAuthenticationDefaults.Scheme,
        _ => { });
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("auth", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "local",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 12,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

var configuredPostgresHost = builder.Configuration["POSTGRES_HOST"]?.Trim();
var configuredPostgresPassword = builder.Configuration["POSTGRES_PASSWORD"];
var connectionString = builder.Configuration.GetConnectionString("FitMemory")
    ?? "Data Source=fitmemory.db";
if (!string.IsNullOrWhiteSpace(configuredPostgresHost))
{
    if (string.IsNullOrWhiteSpace(configuredPostgresPassword))
    {
        throw new InvalidOperationException(
            "POSTGRES_HOST tanımlıyken POSTGRES_PASSWORD da tanımlanmalıdır.");
    }

    var postgresConnection = new NpgsqlConnectionStringBuilder
    {
        Host = configuredPostgresHost,
        Port = int.TryParse(
            builder.Configuration["POSTGRES_PORT"],
            out var postgresPort)
                ? postgresPort
                : 5432,
        Database = builder.Configuration["POSTGRES_DATABASE"]?.Trim()
            ?? "postgres",
        Username = builder.Configuration["POSTGRES_USERNAME"]?.Trim()
            ?? "postgres",
        Password = configuredPostgresPassword,
        SslMode = SslMode.Require,
        IncludeErrorDetail = false
    };
    postgresConnection["GSS Encryption Mode"] = "Disable";
    connectionString = postgresConnection.ConnectionString;
}
var configuredDatabaseProvider = (
        builder.Configuration["DB_PROVIDER"] ??
        builder.Configuration["Database:Provider"] ??
        "")
    .Trim();
var usePostgreSql =
    configuredDatabaseProvider.Equals(
        "postgres",
        StringComparison.OrdinalIgnoreCase) ||
    configuredDatabaseProvider.Equals(
        "postgresql",
        StringComparison.OrdinalIgnoreCase) ||
    (
        string.IsNullOrWhiteSpace(configuredDatabaseProvider) &&
        connectionString.Contains(
            "Host=",
            StringComparison.OrdinalIgnoreCase)
    );
builder.Services.AddDbContext<FitMemoryDbContext>(options =>
{
    if (usePostgreSql)
    {
        options.UseNpgsql(
            connectionString,
            npgsql => npgsql.EnableRetryOnFailure(
                maxRetryCount: 5,
                maxRetryDelay: TimeSpan.FromSeconds(5),
                errorCodesToAdd: null));
        return;
    }

    options.UseSqlite(connectionString);
});

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders =
        ForwardedHeaders.XForwardedFor |
        ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services
    .AddOptions<AiProviderOptions>()
    .Bind(builder.Configuration.GetSection(AiProviderOptions.SectionName))
    .PostConfigure(options =>
    {
        options.Provider =
            builder.Configuration["AI_PROVIDER"] ?? options.Provider;
    });

builder.Services
    .AddOptions<OpenAiOptions>()
    .Bind(builder.Configuration.GetSection(OpenAiOptions.SectionName))
    .PostConfigure(options =>
    {
        options.ApiKey = builder.Configuration["OPENAI_API_KEY"] ?? options.ApiKey;
        options.Model = builder.Configuration["OPENAI_MODEL"] ?? options.Model;
    });

builder.Services
    .AddOptions<GeminiOptions>()
    .Bind(builder.Configuration.GetSection(GeminiOptions.SectionName))
    .PostConfigure(options =>
    {
        options.ApiKey = builder.Configuration["GEMINI_API_KEY"] ?? options.ApiKey;
        options.Model = builder.Configuration["GEMINI_MODEL"] ?? options.Model;
    });

builder.Services.AddHttpClient<OpenAiRecommendationClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddHttpClient<OpenAiOrderImportClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(180);
});
builder.Services.AddHttpClient<GeminiRecommendationClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddHttpClient<GeminiOrderImportClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(180);
});
builder.Services.AddHttpClient<GeminiProductScanClient>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
});
builder.Services.AddHttpClient<StyleBoardAnalysisService>(client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
});
builder.Services.AddSingleton<ProductIdentityService>();
builder.Services.AddSingleton<ProductCategoryService>();
builder.Services.AddSingleton<ProductFitTaxonomyService>();
builder.Services.AddSingleton<RegionalFitFeedbackService>();
builder.Services.AddSingleton<WardrobeStylistService>();
builder.Services.AddSingleton<LocalFitRecommendationEngine>();
builder.Services.AddSingleton<ArchivedFitAssessmentService>();
builder.Services.AddScoped<AccountSessionService>();
builder.Services.AddScoped<PasswordResetEmailService>();
builder.Services
    .AddOptions<EmailOptions>()
    .Bind(builder.Configuration.GetSection(EmailOptions.SectionName))
    .PostConfigure(options =>
    {
        options.Host = builder.Configuration["SMTP_HOST"] ?? options.Host;
        options.Port = int.TryParse(builder.Configuration["SMTP_PORT"], out var port) ? port : options.Port;
        options.Username = builder.Configuration["SMTP_USERNAME"] ?? options.Username;
        options.Password = builder.Configuration["SMTP_PASSWORD"] ?? options.Password;
        options.FromAddress = builder.Configuration["SMTP_FROM_ADDRESS"] ?? options.FromAddress;
        options.FromName = builder.Configuration["SMTP_FROM_NAME"] ?? options.FromName;
    });
builder.Services.AddScoped<
    IPasswordHasher<UserAccount>,
    PasswordHasher<UserAccount>>();
builder.Services.AddScoped<AiOrderImportService>();
builder.Services.AddScoped<ISizeRecommendationService, SizeRecommendationService>();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseExceptionHandler();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseCors("FitMemoryClients");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapGet("/", () => Results.Content(
    """
    <!doctype html>
    <html lang="tr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
      <title>FitMemory API</title>
      <style>
        *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f3ef;color:#111;font-family:Inter,system-ui,sans-serif}
        main{width:min(720px,calc(100% - 32px));padding:38px;border:1px solid #deddd8;border-radius:4px;background:#fff;box-shadow:0 22px 70px #1112}
        .brand{display:flex;align-items:center;gap:13px}.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:2px;background:#111;color:#fff;font-weight:950}
        .status{display:inline-flex;align-items:center;gap:8px;margin-top:28px;padding:8px 12px;border:1px solid #deddd8;border-radius:999px;background:#f8f7f4;color:#31312f;font-size:12px;font-weight:800}
        .dot{width:8px;height:8px;border-radius:50%;background:#25a65a;box-shadow:0 0 0 3px #25a65a1f}
        h1{margin:28px 0 10px;font-size:clamp(30px,6vw,54px);letter-spacing:-.055em;line-height:1}p{color:#73736d;line-height:1.7}
        ol{margin:25px 0 0;padding:0;list-style:none;counter-reset:step;display:grid;gap:12px}li{counter-increment:step;padding:14px 16px;border:1px solid #deddd8;border-radius:2px;background:#f8f7f4;color:#3e3e3a}
        li:before{content:"0" counter(step);margin-right:12px;color:#315cf4;font-size:11px;font-weight:900;letter-spacing:.12em}a{color:#315cf4}code{color:#111}
      </style>
    </head>
    <body>
      <main>
        <div class="brand"><span class="mark">FM</span><strong>FITMEMORY</strong></div>
        <div class="status"><span class="dot"></span>API ÇALIŞIYOR</div>
        <h1>Backend hazır.</h1>
        <p>Bu adres uygulamanın API sunucusudur; asıl kullanıcı arayüzü Chrome uzantısının açılır penceresindedir.</p>
        <ol>
          <li><code>chrome://extensions</code> sayfasını açın.</li>
          <li>Geliştirici modunu açıp <strong>extension</strong> klasörünü paketlenmemiş olarak yükleyin.</li>
          <li>FitMemory simgesini sabitleyin, profilinizi kaydedin ve sipariş geçmişinizi tarayın.</li>
        </ol>
        <p>Servis kontrolü: <a href="/health">/health</a></p>
      </main>
    </body>
    </html>
    """,
    "text/html; charset=utf-8"));
app.MapGet(
    "/health",
    async (
        FitMemoryDbContext db,
        Microsoft.Extensions.Options.IOptions<AiProviderOptions> providerOptions,
        Microsoft.Extensions.Options.IOptions<GeminiOptions> geminiOptions,
        Microsoft.Extensions.Options.IOptions<OpenAiOptions> openAiOptions,
        CancellationToken cancellationToken) =>
    {
        var provider = providerOptions.Value;
        var configured = provider.IsGemini
            ? !string.IsNullOrWhiteSpace(geminiOptions.Value.ApiKey)
            : provider.IsOpenAi &&
              !string.IsNullOrWhiteSpace(openAiOptions.Value.ApiKey);
        var model = provider.IsGemini
            ? geminiOptions.Value.Model
            : provider.IsOpenAi
                ? openAiOptions.Value.Model
                : "";
        var databaseHealthy = await db.Database.CanConnectAsync(
            cancellationToken);
        return Results.Ok(new
        {
            status = databaseHealthy ? "healthy" : "degraded",
            service = "FitMemory.Api",
            database = db.Database.ProviderName,
            databaseHealthy,
            aiProvider = provider.Provider,
            aiConfigured = configured,
            aiModel = model,
            utcTime = DateTimeOffset.UtcNow
        });
    });

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<FitMemoryDbContext>();
    await DatabaseInitializer.InitializeAsync(db);
    await DatabaseSeeder.SeedAsync(db, builder.Configuration);
    var assessmentService =
        scope.ServiceProvider.GetRequiredService<ArchivedFitAssessmentService>();
    var productIdentityService =
        scope.ServiceProvider.GetRequiredService<ProductIdentityService>();
    var profiles = await db.UserProfiles
        .Include(profile => profile.Orders)
        .ToListAsync();
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
    await db.SaveChangesAsync();
}

await app.RunAsync();

public partial class Program;
