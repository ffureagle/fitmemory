using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class StyleBoardAnalysisService(
    HttpClient httpClient,
    IOptions<AiProviderOptions> providerOptions,
    IOptions<GeminiOptions> geminiOptions,
    IOptions<OpenAiOptions> openAiOptions,
    ILogger<StyleBoardAnalysisService> logger)
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    public async Task<StyleBoardAnalysisResponse> AnalyzeAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        string language,
        string userRequest,
        CancellationToken cancellationToken)
    {
        var local = BuildLocal(items);
        if (items.Count < 2)
        {
            return local;
        }

        try
        {
            AiStyleBoardResult? result = null;
            if (providerOptions.Value.IsGemini &&
                !string.IsNullOrWhiteSpace(geminiOptions.Value.ApiKey))
            {
                result = await AnalyzeWithGeminiAsync(
                    profile,
                    items,
                    local,
                    language,
                    userRequest,
                    cancellationToken);
            }
            else if (providerOptions.Value.IsOpenAi &&
                     !string.IsNullOrWhiteSpace(openAiOptions.Value.ApiKey))
            {
                result = await AnalyzeWithOpenAiAsync(
                    profile,
                    items,
                    local,
                    language,
                    userRequest,
                    cancellationToken);
            }

            return result is null ? local : Normalize(result);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Kombin Stüdyosu AI değerlendirmesi kullanılamadı; yerel stil eleştirisi korunuyor.");
            return local with
            {
                Notes = local.Notes
                    .Append("AI servisi o anda yanıt vermedi; bu sonuç yerel kesim ve mevsim kurallarıyla üretildi.")
                    .Take(4)
                    .ToArray()
            };
        }
    }

    private async Task<AiStyleBoardResult> AnalyzeWithGeminiAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string language,
        string userRequest,
        CancellationToken cancellationToken)
    {
        var settings = geminiOptions.Value;
        var payload = new
        {
            systemInstruction = new
            {
                parts = new[]
                {
                    new { text = SystemPrompt(language) }
                }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new[]
                    {
                        new { text = BuildEvidence(profile, items, local, userRequest) }
                    }
                }
            },
            generationConfig = new
            {
                temperature = 0.2,
                responseMimeType = "application/json",
                responseJsonSchema = ResponseSchema()
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            GeminiResponseReader.BuildGenerateContentEndpoint(settings))
        {
            Content = JsonContent(payload)
        };
        request.Headers.Add("x-goog-api-key", settings.ApiKey);
        using var response = await httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        response.EnsureSuccessStatusCode();
        return JsonSerializer.Deserialize<AiStyleBoardResult>(
                   StripCodeFence(GeminiResponseReader.ExtractText(body)),
                   JsonOptions)
               ?? throw new InvalidOperationException(
                   "Gemini boş bir kombin değerlendirmesi döndürdü.");
    }

    private async Task<AiStyleBoardResult> AnalyzeWithOpenAiAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string language,
        string userRequest,
        CancellationToken cancellationToken)
    {
        var settings = openAiOptions.Value;
        var payload = new
        {
            model = settings.Model,
            reasoning = new { effort = settings.ReasoningEffort },
            input = new object[]
            {
                new
                {
                    role = "system",
                    content = SystemPrompt(language)
                },
                new
                {
                    role = "user",
                    content = BuildEvidence(profile, items, local, userRequest)
                }
            },
            text = new
            {
                format = new
                {
                    type = "json_schema",
                    name = "style_board_analysis",
                    strict = true,
                    schema = ResponseSchema()
                }
            }
        };
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            settings.Endpoint)
        {
            Content = JsonContent(payload)
        };
        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", settings.ApiKey);
        using var response = await httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(body);
        var outputText = document.RootElement
            .GetProperty("output")
            .EnumerateArray()
            .SelectMany(output => output.GetProperty("content").EnumerateArray())
            .Where(content =>
                content.TryGetProperty("text", out var text) &&
                text.ValueKind == JsonValueKind.String)
            .Select(content => content.GetProperty("text").GetString())
            .FirstOrDefault(text => !string.IsNullOrWhiteSpace(text))
            ?? throw new InvalidOperationException(
                "OpenAI boş bir kombin değerlendirmesi döndürdü.");
        return JsonSerializer.Deserialize<AiStyleBoardResult>(
                   StripCodeFence(outputText),
                   JsonOptions)
               ?? throw new InvalidOperationException(
                   "OpenAI kombin değerlendirmesi okunamadı.");
    }

    private static StyleBoardAnalysisResponse BuildLocal(
        IReadOnlyList<StyleBoardItem> items)
    {
        var now = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3));
        var season = Season(now.Month);
        var text = string.Join(
            " ",
            items.Select(item =>
                $"{item.ProductName} {item.Category} {item.FitLabel} {item.Description}"))
            .ToLowerInvariant();
        var hasUpper = ContainsAny(text, "tişört", "tisort", "shirt", "gömlek", "gomlek", "bluz", "sweat", "kazak", "top");
        var hasBottom = ContainsAny(text, "pantolon", "jean", "etek", "skirt", "şort", "sort", "trouser");
        var hasTrench = ContainsAny(text, "trenç", "trenc", "trench");
        var hasMini = ContainsAny(text, "mini etek", "mini skirt");
        var hasShortSleeve = ContainsAny(text, "kısa kollu", "kisa kollu", "short sleeve");
        var volumes = items.Count(item =>
            ContainsAny(
                $"{item.FitLabel} {item.ProductName}".ToLowerInvariant(),
                "baggy", "oversize", "oversized", "boxy", "relaxed", "wide"));

        var notes = new List<string>();
        var score = 68;
        if (!hasUpper || !hasBottom)
        {
            score -= 20;
            notes.Add("Tam görünüm için bir üst ve bir alt parça seç.");
        }
        if (volumes >= 3)
        {
            score -= 16;
            notes.Add("Birden fazla hacimli kesim silueti ağırlaştırıyor; bir parçayı daha kontrollü kesimle değiştir.");
        }
        if (hasMini && hasTrench)
        {
            if (season.Kind == "Yaz")
            {
                score -= 24;
                notes.Add("Mini etek ve trençkot temmuz sıcağında varsayılan bir eşleşme değil; trençkotu çıkar veya yalnız serin akşama ayır.");
            }
            else
            {
                notes.Add("Mini etek–trençkot ancak ince trenç açık kullanıldığında ve etek boyu katman altında kaybolmadığında dengeli çalışır.");
            }
        }
        if (hasShortSleeve && hasTrench && season.Kind == "Yaz")
        {
            score -= 10;
            notes.Add("Kısa kollu üst ile trençkot katmanı bu ay için hava koşuluna bağlı; gündüz görünümü olarak zorlamayın.");
        }

        var verdict = score switch
        {
            >= 75 => "Güçlü",
            >= 52 => "Düzenle",
            _ => "Zayıf"
        };
        return new StyleBoardAnalysisResponse(
            verdict,
            Math.Clamp(score, 20, 88),
            verdict == "Güçlü"
                ? "Parçalar dengeli bir görünüm kuruyor."
                : verdict == "Düzenle"
                    ? "Fikir çalışıyor; bir denge ayarı gerekiyor."
                    : "Bu parçalar şu haliyle aynı hikâyeyi anlatmıyor.",
            "Değerlendirme; seçilen gerçek ürünlerin kategorisi, belirtilen kalıbı, katman oranı ve İstanbul mevsim bağlamı üzerinden yapıldı. Renk kanıtı ürün adında veya görselinde yoksa renk uyumu kesin kabul edilmedi.",
            notes.Take(4).ToArray(),
            $"{now:MMMM} · {season.Kind}",
            DateTimeOffset.UtcNow);
    }

    private static StyleBoardAnalysisResponse Normalize(
        AiStyleBoardResult result)
    {
        var verdict = result.Verdict.Trim() switch
        {
            "Güçlü" => "Güçlü",
            "Zayıf" => "Zayıf",
            "Strong" => "Strong",
            "Weak" => "Weak",
            "Adjust" => "Adjust",
            _ => "Düzenle"
        };
        return new StyleBoardAnalysisResponse(
            verdict,
            Math.Clamp(result.Score, 15, 95),
            Limit(result.Headline, 160),
            Limit(result.Explanation, 900),
            result.Notes
                .Where(note => !string.IsNullOrWhiteSpace(note))
                .Select(note => Limit(note, 220))
                .Take(4)
                .ToArray(),
            Limit(result.SeasonContext, 80),
            DateTimeOffset.UtcNow);
    }

    private static string SystemPrompt(string language)
    {
        var responseLanguage = language.Equals("en", StringComparison.OrdinalIgnoreCase)
            ? "English"
            : "Turkish";
        return $"""
            Sen FitMemory Kombin Stüdyosu'nun eleştirel kıdemli stilistisin. Kullanıcı henüz satın almadığı gerçek ürünleri seçti.
            Her seti otomatik olarak övme. Yalnız verilen ürün kanıtını kullan; renk, kumaş veya kalıp uydurma.
            Renk uyumu, siluet hacmi, üst-alt boy oranı, katman mantığı, yaş/kullanım bağlamı ve Türkiye'deki mevcut ayı birlikte değerlendir.
            Bütün hacimli kesimleri aynı anda onaylama. Boxy, relaxed, baggy, straight ve slim kesimleri eş anlamlı sayma.
            Mini kot etek + kısa kollu tişört + trençkot evrensel olarak doğru değildir: yazın trenç genellikle mevsim dışıdır; ilkbahar/sonbaharda ancak trenç hafif ve açık, boy oranı bilinçli ise çalışabilir.
            Üst ve alt parçanın birlikte çalışmasını değerlendir. Ayakkabı isteğe bağlıdır: seçilmişse kombine uyumunu yorumla; seçilmemişse ayakkabıdan, eksikliğinden veya görünümün tamamlanmadığından hiç söz etme ve puan düşürme.
            Sonuç kesin satış vaadi değildir. Write every user-facing field in {responseLanguage}; keep it concise and concrete. Yalnız şemaya uyan JSON döndür.
            """;
    }

    private static string BuildEvidence(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string userRequest)
    {
        var evidence = new
        {
            profile = new
            {
                profile.Age,
                fitPreference = profile.FitPreference.ToString()
            },
            currentLocalTime = DateTimeOffset.UtcNow.ToOffset(
                TimeSpan.FromHours(3)),
            localGuard = local,
            userRequest = userRequest.Trim(),
            selectedProducts = items.Select(item => new
            {
                item.Brand,
                item.ProductName,
                item.Category,
                item.Price,
                item.ProductUrl,
                item.ImageUrl,
                item.FitLabel,
                item.FitEvidence,
                item.Description,
                item.MaterialSummary,
                item.MaterialEvidence,
                item.RecommendedSize,
                item.RecommendationConfidence
            })
        };
        return JsonSerializer.Serialize(evidence, JsonOptions);
    }

    private static object ResponseSchema()
    {
        return new
        {
            type = "object",
            properties = new
            {
                verdict = new { type = "string" },
                score = new { type = "integer", minimum = 0, maximum = 95 },
                headline = new { type = "string" },
                explanation = new { type = "string" },
                notes = new
                {
                    type = "array",
                    items = new { type = "string" },
                    maxItems = 4
                },
                seasonContext = new { type = "string" }
            },
            required = new[]
            {
                "verdict",
                "score",
                "headline",
                "explanation",
                "notes",
                "seasonContext"
            },
            additionalProperties = false
        };
    }

    private static StringContent JsonContent(object payload)
    {
        return new StringContent(
            JsonSerializer.Serialize(payload, JsonOptions),
            Encoding.UTF8,
            "application/json");
    }

    private static string StripCodeFence(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }
        var firstLineEnd = trimmed.IndexOf('\n');
        var lastFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstLineEnd >= 0 && lastFence > firstLineEnd
            ? trimmed[(firstLineEnd + 1)..lastFence].Trim()
            : trimmed;
    }

    private static (string Kind, string Guidance) Season(int month)
    {
        return month switch
        {
            12 or 1 or 2 => ("Kış", "soğuk hava katmanı"),
            3 or 4 or 5 => ("İlkbahar", "geçiş mevsimi katmanı"),
            6 or 7 or 8 => ("Yaz", "hafif ve nefes alan katman"),
            _ => ("Sonbahar", "geçiş mevsimi katmanı")
        };
    }

    private static bool ContainsAny(string value, params string[] terms)
    {
        return terms.Any(term => value.Contains(
            term,
            StringComparison.OrdinalIgnoreCase));
    }

    private static string Limit(string value, int maxLength)
    {
        var normalized = value?.Trim() ?? "";
        return normalized.Length <= maxLength
            ? normalized
            : normalized[..maxLength];
    }

    private sealed record AiStyleBoardResult(
        string Verdict,
        int Score,
        string Headline,
        string Explanation,
        IReadOnlyList<string> Notes,
        string SeasonContext);
}
