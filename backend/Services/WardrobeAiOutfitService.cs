using System.Text.Json;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed record WardrobeAiOutfitResult(
    bool IsValidRequest,
    string Message,
    StyleBoardAnalysisResponse? Analysis,
    IReadOnlyList<OrderHistoryItem> Pieces);

public sealed class WardrobeAiOutfitService(
    HttpClient httpClient,
    IOptions<GeminiOptions> geminiOptions,
    ProductCategoryService categoryService,
    ILogger<WardrobeAiOutfitService> logger)
{
    private const int MaxImages = 10;
    private const int MaxImageBytes = 1_500_000;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<WardrobeAiOutfitResult?> CreateAsync(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        string userPrompt,
        string language,
        CancellationToken cancellationToken)
    {
        var settings = geminiOptions.Value;
        if (string.IsNullOrWhiteSpace(settings.ApiKey)) return null;

        var prompt = userPrompt.Trim();
        if (!LooksMeaningful(prompt))
        {
            return new WardrobeAiOutfitResult(
                false,
                language.Equals("en", StringComparison.OrdinalIgnoreCase)
                    ? "Describe an occasion, style or how you want to look."
                    : "Bir ortam, tarz veya nasıl görünmek istediğini anlaşılır biçimde yaz.",
                null,
                []);
        }

        var candidates = wardrobe
            .Where(item => item.Outcome.IsInCloset() && !item.ReturnConfirmedByUser)
            .OrderByDescending(item => !string.IsNullOrWhiteSpace(item.ImageUrl))
            .ThenByDescending(item => item.FitScore ?? 50)
            .ThenByDescending(item => item.UpdatedAt)
            .Take(18)
            .ToArray();
        if (candidates.Length < 2)
        {
            return new WardrobeAiOutfitResult(
                false,
                language.Equals("en", StringComparison.OrdinalIgnoreCase)
                    ? "Add at least two kept items from different clothing categories to your closet."
                    : "Dolabına farklı giyim kategorilerinden en az iki tutulmuş ürün ekle.",
                null,
                []);
        }

        var parts = new List<object>();
        var visualIds = new HashSet<int>();
        foreach (var item in candidates)
        {
            parts.Add(new
            {
                text = $"PARÇA #{item.Id}: {item.Brand} | {item.ProductName} | kategori={item.Category} | beden={item.PurchasedSize} | kalıp={item.FitLabel} | materyal={item.MaterialSummary} | uyumNotu={item.UserFitNotes ?? item.FitNotes}"
            });
            if (visualIds.Count >= MaxImages) continue;
            var image = await TryReadImageAsync(item.ImageUrl, cancellationToken);
            if (image is null) continue;
            visualIds.Add(item.Id);
            parts.Add(new
            {
                inlineData = new { mimeType = image.Value.MimeType, data = image.Value.Base64 }
            });
        }

        var now = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3));
        parts.Add(new { text = BuildPrompt(profile, candidates, visualIds, prompt, language, now) });
        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = SystemPrompt(language) } } },
            contents = new[] { new { role = "user", parts = parts.ToArray() } },
            generationConfig = new
            {
                temperature = 0.18,
                responseMimeType = "application/json",
                responseJsonSchema = ResponseSchema()
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            GeminiResponseReader.BuildGenerateContentEndpoint(settings))
        {
            Content = System.Net.Http.Json.JsonContent.Create(payload)
        };
        request.Headers.Add("x-goog-api-key", settings.ApiKey);
        using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = JsonSerializer.Deserialize<AiWardrobeOutfit>(
            GeminiResponseReader.ExtractText(body), JsonOptions)
            ?? throw new InvalidOperationException("AI stilist boş yanıt döndürdü.");

        if (!result.IsValidRequest)
        {
            return new WardrobeAiOutfitResult(false, Limit(result.Message, 240), null, []);
        }

        var allowed = candidates.ToDictionary(item => item.Id);
        var chosen = result.SelectedOrderIds
            .Where(allowed.ContainsKey)
            .Distinct()
            .Take(4)
            .Select(id => allowed[id])
            .ToArray();
        var slots = chosen.Select(item => categoryService.GetGroup(item)).Distinct().Count();
        if (chosen.Length < 2 || slots < 2)
        {
            logger.LogWarning("AI stilist geçersiz parça seti seçti. Selected={SelectedIds}", string.Join(',', result.SelectedOrderIds));
            return new WardrobeAiOutfitResult(
                false,
                language.Equals("en", StringComparison.OrdinalIgnoreCase)
                    ? "Your closet does not contain enough visually compatible pieces for this request."
                    : "Bu istek için dolabında görsel olarak uyumlu, farklı kategorilerde yeterli parça bulunamadı.",
                null,
                []);
        }

        var score = Math.Clamp(result.Score, 20, 95);
        var analysis = new StyleBoardAnalysisResponse(
            score >= 75 ? "Güçlü" : score >= 52 ? "Düzenle" : "Zayıf",
            score,
            Limit(result.Headline, 160),
            Limit(result.Explanation, 900),
            result.Notes.Where(note => !string.IsNullOrWhiteSpace(note)).Select(note => Limit(note, 220)).Take(4).ToArray(),
            $"{TurkishMonth(now.Month)} · AI görsel stil analizi",
            DateTimeOffset.UtcNow);
        return new WardrobeAiOutfitResult(true, Limit(result.Message, 240), analysis, chosen);
    }

    private async Task<(string MimeType, string Base64)?> TryReadImageAsync(string? value, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            if (value.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase))
            {
                var parsed = GeminiResponseReader.ParseImageDataUrl(value);
                return (parsed.Data.Length * 3L) / 4L <= MaxImageBytes ? (parsed.MimeType, parsed.Data) : null;
            }
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps || !IsTrustedImageHost(uri.Host)) return null;
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode) return null;
            var mimeType = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (mimeType is not ("image/jpeg" or "image/png" or "image/webp")) return null;
            if (response.Content.Headers.ContentLength is > MaxImageBytes) return null;
            await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var output = new MemoryStream();
            var buffer = new byte[32_768];
            while (true)
            {
                var read = await input.ReadAsync(buffer, cancellationToken);
                if (read == 0) break;
                if (output.Length + read > MaxImageBytes) return null;
                output.Write(buffer, 0, read);
            }
            return output.Length == 0 ? null : (mimeType, Convert.ToBase64String(output.ToArray()));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogDebug(exception, "Dolap görseli AI isteğine eklenemedi.");
            return null;
        }
    }

    private static bool IsTrustedImageHost(string host)
    {
        var normalized = host.Trim('.').ToLowerInvariant();
        string[] suffixes =
        [
            "zara.com", "zara.net", "pullandbear.com", "pullandbear.net", "bershka.com", "bershka.net",
            "inditex.com", "cloudinary.com", "googleusercontent.com", "supabase.co"
        ];
        return suffixes.Any(suffix => normalized == suffix || normalized.EndsWith($".{suffix}", StringComparison.Ordinal));
    }

    private static bool LooksMeaningful(string prompt)
    {
        if (prompt.Length < 3 || prompt.Distinct().Count() < 3 || prompt.Count(char.IsLetterOrDigit) < 3) return false;
        var letters = new string(prompt.Where(char.IsLetter).ToArray()).ToLowerInvariant();
        return letters.Length < 3 || letters.Distinct().Count() > 2;
    }

    private static string BuildPrompt(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> candidates,
        IReadOnlySet<int> visualIds,
        string prompt,
        string language,
        DateTimeOffset now) => JsonSerializer.Serialize(new
        {
            task = "Kullanıcının isteğini anla; yalnız dolaptaki parçalardan gerçek bir kombin seç.",
            userRequest = prompt,
            responseLanguage = language,
            currentDate = now.ToString("yyyy-MM-dd"),
            profile = new { profile.Age, profile.FitPreference },
            rules = new[]
            {
                "Anlamsız/rastgele metinse isValidRequest=false ve hiçbir parça seçme.",
                "Görseli verilen parçaların renk, desen, oran ve siluetini gerçekten incele.",
                "hasAttachedImage=true olan parçaları önceliklendir; görseli olmayan parçayı ancak metadatası isteğe açıkça uyuyorsa seç.",
                "Yalnız listedeki orderId değerlerini seç; en az iki farklı giyim kategorisi seç.",
                "Ayakkabı zorunlu değildir. Mevsime veya isteğe uymayan kombin üretmek yerine reddet.",
                "Uydurma renk, kumaş, marka veya ürün ekleme."
            },
            wardrobe = candidates.Select(item => new
            {
                orderId = item.Id, item.Brand, item.ProductName, item.Category, item.PurchasedSize,
                item.FitLabel, item.MaterialSummary, fitNote = item.UserFitNotes ?? item.FitNotes,
                hasAttachedImage = visualIds.Contains(item.Id)
            })
        }, JsonOptions);

    private static string SystemPrompt(string language) => language.Equals("en", StringComparison.OrdinalIgnoreCase)
        ? "You are FitMemory's visual personal stylist. Inspect the attached wardrobe photos. Reject gibberish and unsuitable requests. Return only schema-valid JSON."
        : "Sen FitMemory'nin görsel kişisel stilistisin. Ekli dolap fotoğraflarını gerçekten incele. Anlamsız metni ve uygun olmayan kombinleri reddet. Yalnız şemaya uyan JSON döndür.";

    private static object ResponseSchema() => new
    {
        type = "object",
        properties = new
        {
            isValidRequest = new { type = "boolean" },
            message = new { type = "string" },
            selectedOrderIds = new { type = "array", items = new { type = "integer" } },
            score = new { type = "integer" },
            headline = new { type = "string" },
            explanation = new { type = "string" },
            notes = new { type = "array", items = new { type = "string" } }
        },
        required = new[] { "isValidRequest", "message", "selectedOrderIds", "score", "headline", "explanation", "notes" }
    };

    private static string Limit(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        var trimmed = value.Trim();
        return trimmed[..Math.Min(trimmed.Length, max)];
    }

    private static string TurkishMonth(int month) => month switch
    {
        1 => "Ocak", 2 => "Şubat", 3 => "Mart", 4 => "Nisan", 5 => "Mayıs", 6 => "Haziran",
        7 => "Temmuz", 8 => "Ağustos", 9 => "Eylül", 10 => "Ekim", 11 => "Kasım", _ => "Aralık"
    };

    private sealed class AiWardrobeOutfit
    {
        public bool IsValidRequest { get; init; }
        public string Message { get; init; } = "";
        public int[] SelectedOrderIds { get; init; } = [];
        public int Score { get; init; }
        public string Headline { get; init; } = "";
        public string Explanation { get; init; } = "";
        public string[] Notes { get; init; } = [];
    }
}
