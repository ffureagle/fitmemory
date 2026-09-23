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
    private const int MaxImages = 6;
    private const int MaxImageBytes = 1_500_000;
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
            var result = await AnalyzeProviderWithRetryAsync(
                profile,
                items,
                local,
                language,
                userRequest,
                cancellationToken);
            return result is null
                ? MissingEvidence(items, language)
                : Normalize(result, local);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(
                exception,
                "Kombin Stüdyosu AI değerlendirmesi kullanılamadı; sabit puan yerine kanıt eksik sonucu dönülüyor.");
            return MissingEvidence(items, language);
        }
    }

    private async Task<AiStyleBoardResult?> AnalyzeProviderWithRetryAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string language,
        string userRequest,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<ProductInlineImage> images = providerOptions.Value.IsGemini
            ? await DownloadInditexImagesAsync(items, cancellationToken)
            : Array.Empty<ProductInlineImage>();
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            try
            {
                if (providerOptions.Value.IsGemini &&
                    !string.IsNullOrWhiteSpace(geminiOptions.Value.ApiKey))
                {
                    return await AnalyzeWithGeminiAsync(
                        profile,
                        items,
                        local,
                        language,
                        userRequest,
                        images,
                        cancellationToken);
                }

                if (providerOptions.Value.IsOpenAi &&
                    !string.IsNullOrWhiteSpace(openAiOptions.Value.ApiKey))
                {
                    return await AnalyzeWithOpenAiAsync(
                        profile,
                        items,
                        local,
                        language,
                        userRequest,
                        cancellationToken);
                }

                return null;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                logger.LogWarning(
                    exception,
                    "Kombin Stüdyosu AI isteği başarısız oldu (deneme {Attempt}/2).",
                    attempt);
                if (attempt == 2)
                {
                    return null;
                }
            }
        }

        return null;
    }

    private async Task<AiStyleBoardResult> AnalyzeWithGeminiAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string language,
        string userRequest,
        IReadOnlyList<ProductInlineImage> images,
        CancellationToken cancellationToken)
    {
        var settings = geminiOptions.Value;
        var parts = new List<object>
        {
            new { text = BuildEvidence(profile, items, local, userRequest) }
        };
        foreach (var image in images)
        {
            parts.Add(new { text = $"Ürün görseli: {image.Name}" });
            parts.Add(new
            {
                inlineData = new
                {
                    mimeType = image.MimeType,
                    data = image.Base64
                }
            });
        }
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
                    parts = parts.ToArray()
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
        if (!response.IsSuccessStatusCode)
        {
            var error = GeminiResponseReader.ExtractApiError(body);
            throw new GeminiApiException(
                response.StatusCode,
                error.Code,
                error.Message);
        }
        return JsonSerializer.Deserialize<AiStyleBoardResult>(
                   StripCodeFence(GeminiResponseReader.ExtractText(body)),
                   JsonOptions)
               ?? throw new InvalidOperationException(
                   "Gemini boş bir kombin değerlendirmesi döndürdü.");
    }

    private async Task<List<object>> BuildGeminiPartsAsync(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string language,
        string userRequest,
        CancellationToken cancellationToken)
    {
        var parts = new List<object>();
        var visualProductIds = new HashSet<int>();
        foreach (var item in items)
        {
            parts.Add(new
            {
                text =
                    $"SEÇİLİ PARÇA #{item.Id}: {item.Brand} | {item.ProductName} | " +
                    $"kategori={item.Category} | kalıp={item.FitLabel} | " +
                    $"materyal={item.MaterialSummary}"
            });
            if (visualProductIds.Count >= MaxImages)
            {
                continue;
            }

            var image = await TryReadImageAsync(
                item.ImageUrl,
                cancellationToken);
            if (image is null)
            {
                continue;
            }

            visualProductIds.Add(item.Id);
            parts.Add(new
            {
                inlineData = new
                {
                    mimeType = image.Value.MimeType,
                    data = image.Value.Base64
                }
            });
        }

        parts.Add(new
        {
            text = BuildEvidence(
                profile,
                items,
                local,
                userRequest,
                visualProductIds)
        });
        return parts;
    }

    private async Task<(string MimeType, string Base64)?> TryReadImageAsync(
        string? value,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        try
        {
            if (value.StartsWith(
                    "data:image/",
                    StringComparison.OrdinalIgnoreCase))
            {
                var parsed = GeminiResponseReader.ParseImageDataUrl(value);
                return (parsed.Data.Length * 3L) / 4L <= MaxImageBytes
                    ? (parsed.MimeType, parsed.Data)
                    : null;
            }

            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps ||
                !IsTrustedImageHost(uri.Host))
            {
                return null;
            }

            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            using var response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var mimeType = response.Content.Headers.ContentType?.MediaType
                ?.ToLowerInvariant();
            if (mimeType is not (
                    "image/jpeg" or
                    "image/png" or
                    "image/webp") ||
                response.Content.Headers.ContentLength is > MaxImageBytes)
            {
                return null;
            }

            await using var input = await response.Content
                .ReadAsStreamAsync(cancellationToken);
            using var output = new MemoryStream();
            var buffer = new byte[32_768];
            while (true)
            {
                var read = await input.ReadAsync(buffer, cancellationToken);
                if (read == 0)
                {
                    break;
                }
                if (output.Length + read > MaxImageBytes)
                {
                    return null;
                }
                output.Write(buffer, 0, read);
            }

            return output.Length == 0
                ? null
                : (mimeType, Convert.ToBase64String(output.ToArray()));
        }
        catch (Exception exception)
            when (exception is not OperationCanceledException)
        {
            logger.LogDebug(
                exception,
                "Stüdyo ürün görseli AI isteğine eklenemedi.");
            return null;
        }
    }

    private static bool IsTrustedImageHost(string host)
    {
        var normalized = host.Trim('.').ToLowerInvariant();
        string[] suffixes =
        [
            "zara.com",
            "zara.net",
            "pullandbear.com",
            "pullandbear.net",
            "bershka.com",
            "bershka.net",
            "inditex.com",
            "cloudinary.com",
            "googleusercontent.com",
            "supabase.co"
        ];
        return suffixes.Any(suffix =>
            normalized == suffix ||
            normalized.EndsWith(
                $".{suffix}",
                StringComparison.Ordinal));
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

    private async Task<IReadOnlyList<ProductInlineImage>> DownloadInditexImagesAsync(
        IReadOnlyList<StyleBoardItem> items,
        CancellationToken cancellationToken)
    {
        var images = new List<ProductInlineImage>();
        foreach (var item in items)
        {
            if (images.Count >= 8)
            {
                break;
            }

            var image = await TryReadInditexImageAsync(item, cancellationToken);
            if (image is not null)
            {
                images.Add(image);
            }
        }

        return images;
    }

    private async Task<ProductInlineImage?> TryReadInditexImageAsync(
        StyleBoardItem item,
        CancellationToken cancellationToken)
    {
        var value = item.ImageUrl?.Trim();
        if (string.IsNullOrWhiteSpace(value) ||
            !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !IsTrustedInditexImageHost(uri.Host))
        {
            return null;
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(12));
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation(
                "User-Agent",
                "Mozilla/5.0 (compatible; FitMemory/1.0)");
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("image/jpeg"));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("image/png"));
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("image/webp"));
            using var response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                timeout.Token);
            var finalUri = response.RequestMessage?.RequestUri ?? uri;
            if (!response.IsSuccessStatusCode ||
                finalUri.Scheme != Uri.UriSchemeHttps ||
                !IsTrustedInditexImageHost(finalUri.Host))
            {
                return null;
            }

            var mimeType = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
            if (mimeType is not ("image/jpeg" or "image/png" or "image/webp"))
            {
                return null;
            }

            if (response.Content.Headers.ContentLength is > MaxImageBytes)
            {
                return null;
            }

            await using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var output = new MemoryStream();
            var buffer = new byte[32_768];
            while (true)
            {
                var read = await input.ReadAsync(buffer, timeout.Token);
                if (read == 0)
                {
                    break;
                }

                if (output.Length + read > MaxImageBytes)
                {
                    return null;
                }

                output.Write(buffer, 0, read);
            }

            if (output.Length == 0)
            {
                return null;
            }

            var name = string.Join(" ", new[] { item.Brand, item.ProductName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part.Trim()));
            return new ProductInlineImage(
                string.IsNullOrWhiteSpace(name) ? "Seçili ürün" : name,
                mimeType,
                Convert.ToBase64String(output.ToArray()));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            logger.LogDebug(exception, "Inditex ürün görseli AI isteğine eklenemedi.");
            return null;
        }
    }

    private static bool IsTrustedInditexImageHost(string host)
    {
        var normalized = host.Trim().Trim('.').ToLowerInvariant();
        string[] suffixes =
        [
            "zara.com", "zara.net",
            "pullandbear.com", "pullandbear.net",
            "bershka.com", "bershka.net",
            "massimodutti.com", "massimodutti.net",
            "stradivarius.com", "stradivarius.net", "e-stradivarius.net",
            "oysho.com", "oysho.net",
            "lefties.com",
            "inditex.com", "inditex.net"
        ];
        return suffixes.Any(suffix =>
            normalized == suffix ||
            normalized.EndsWith($".{suffix}", StringComparison.Ordinal));
    }

    private static StyleBoardAnalysisResponse MissingEvidence(
        IReadOnlyList<StyleBoardItem> items,
        string language)
    {
        var names = items
            .Select(item => string.Join(" ", new[] { item.Brand, item.ProductName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part.Trim())))
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToArray();
        var listed = names.Length == 0 ? "seçili ürünler" : string.Join(", ", names);
        var english = language.Equals("en", StringComparison.OrdinalIgnoreCase);
        var now = DateTimeOffset.UtcNow.ToOffset(TimeSpan.FromHours(3));
        return new StyleBoardAnalysisResponse(
            english ? "Evidence missing" : "Kanıt eksik",
            0,
            english
                ? "Visual evidence for the selected products is incomplete."
                : "Seçili ürünler için görsel kanıt tamamlanamadı.",
            english
                ? $"Evidence missing: {listed}. Product photos could not be read from a trusted Inditex address or the AI request failed, so no fixed outfit score was produced."
                : $"Kanıt eksik: {listed}. Ürün görselleri güvenilir bir Inditex adresinden okunamadı veya AI isteği başarısız oldu; sabit bir kombin puanı üretilmedi.",
            names.Length == 0
                ? ["Kanıt eksik"]
                : names,
            $"{TurkishMonth(now.Month)} · {(english ? "Evidence missing" : "Kanıt eksik")}",
            DateTimeOffset.UtcNow);
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
        var hasOnePiece = ContainsAny(text, "elbise", "dress", "tulum", "jumpsuit");
        var hasOuterwear = ContainsAny(text, "ceket", "jacket", "mont", "coat", "kaban", "parka", "trenç", "trenc", "trench", "outerwear");
        var hasTrench = ContainsAny(text, "trenç", "trenc", "trench");
        var hasHeavyLayer = ContainsAny(text, "kaban", "puffer", "parka", "yün", "yun", "wool", "kalın", "thick", "termal", "thermal");
        var hasKnitwear = ContainsAny(text, "kazak", "triko", "knit", "sweater", "hırka", "hirka", "cardigan");
        var hasMini = ContainsAny(text, "mini etek", "mini skirt");
        var hasShortSleeve = ContainsAny(text, "kısa kollu", "kisa kollu", "short sleeve");
        var notes = new List<string>();
        var score = 78;
        if (!hasOnePiece && (!hasUpper || !hasBottom))
        {
            score -= 20;
            notes.Add("Tam görünüm için bir üst ve bir alt parça seç.");
        }
        // Hacimli kesim sayısı tek başına kusur değildir. AI; boy, kumaş,
        // oran ve kullanım bağlamını birlikte değerlendirmeden puan düşüremez.
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
        if (season.Kind == "Yaz" && hasOuterwear)
        {
            score -= hasHeavyLayer ? 30 : 18;
            notes.Add(hasHeavyLayer
                ? "Kalın dış giyim yaz koşullarına uygun değil; kombinden çıkar."
                : "Dış katman yaz gündüzü için gereksiz olabilir; yalnız serin akşam ve hafif kumaş kanıtı varsa koru.");
        }
        if (season.Kind == "Yaz" && hasKnitwear)
        {
            score -= 18;
            notes.Add("Triko katmanı yaz mevsiminde ancak ince ve nefes alan kumaş açıkça doğrulanıyorsa kullanılmalı.");
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
            $"{TurkishMonth(now.Month)} · {season.Kind}",
            DateTimeOffset.UtcNow);
    }

    private static StyleBoardAnalysisResponse BuildAiUnavailableFallback(
        StyleBoardAnalysisResponse local,
        IReadOnlyList<StyleBoardItem> items)
    {
        var pieceSummary = string.Join(
            " · ",
            items.Select(item =>
                $"{item.ProductName} ({item.Category}, " +
                $"{(string.IsNullOrWhiteSpace(item.FitLabel) ? "kalıp belirsiz" : item.FitLabel)})"));
        var evidenceGaps = items
            .Where(item =>
                string.IsNullOrWhiteSpace(item.MaterialSummary) &&
                string.IsNullOrWhiteSpace(item.MaterialEvidence))
            .Select(item => item.ProductName)
            .Take(2)
            .ToArray();
        var notes = local.Notes.ToList();
        if (evidenceGaps.Length > 0)
        {
            notes.Add(
                $"Kumaş kanıtı eksik: {string.Join(", ", evidenceGaps)}.");
        }
        notes.Add(
            "Görsel AI yanıt vermediği için renk, desen ve parçaların gerçek oranı doğrulanamadı.");

        var score = Math.Min(local.Score, 58);
        return local with
        {
            Verdict = "Kanıt eksik",
            Score = score,
            Headline = "Kesim fikri okunuyor; görsel uyum henüz doğrulanmadı.",
            Explanation =
                $"Seçilen parçalar: {pieceSummary}. " +
                "Kategori ve metin bilgisi temel bir katman sırası kuruyor; " +
                "ancak renk, desen, kumaş ağırlığı ve üst-alt boy oranı " +
                "görseller incelenmeden güçlü kabul edilemez.",
            Notes = notes
                .Where(note => !string.IsNullOrWhiteSpace(note))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(4)
                .ToArray(),
            CreatedAt = DateTimeOffset.UtcNow
        };
    }

    private static StyleBoardAnalysisResponse Normalize(
        AiStyleBoardResult result,
        StyleBoardAnalysisResponse local)
    {
        var guardedScore = local.Score < 60
            ? Math.Min(result.Score, local.Score + 10)
            : result.Score;
        if (local.Notes.Count == 0)
        {
            guardedScore = Math.Max(guardedScore, 72);
        }
        guardedScore = Math.Clamp(guardedScore, 15, 95);
        var verdict = guardedScore switch
        {
            >= 75 => result.Verdict.Trim() == "Strong" ? "Strong" : "Güçlü",
            >= 52 => result.Verdict.Trim() == "Adjust" ? "Adjust" : "Düzenle",
            _ => result.Verdict.Trim() == "Weak" ? "Weak" : "Zayıf"
        };
        var notes = local.Notes
            .Concat(result.Notes)
            .Where(note => !string.IsNullOrWhiteSpace(note))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(note => Limit(note, 220))
            .Take(4)
            .ToArray();
        return new StyleBoardAnalysisResponse(
            verdict,
            guardedScore,
            Limit(result.Headline, 160),
            Limit(result.Explanation, 900),
            notes,
            local.SeasonContext,
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
            Ekli inline görseller seçili ürünlerin fotoğraflarıdır. Renk, desen ve silueti yalnız o görsellerde gerçekten gördüğün kanıttan yaz.
            Renk uyumu, siluet hacmi, üst-alt boy oranı, katman mantığı, yaş/kullanım bağlamı ve Türkiye'deki mevcut ayı birlikte değerlendir.
            currentLocalTime ve localGuard mevsim konusunda bağlayıcıdır. Yazın kalın dış giyim, kaban, yoğun triko ve gereksiz çok katman; kışın korumasız ince yaz parçaları önerme. Kullanıcı açıkça farklı bir şehir, seyahat veya hava koşulu yazmadıkça Türkiye'nin mevcut mevsimini esas al.
            Mevsimsel renkleri katı moda kuralı gibi dayatma; yazın açık/nötr/doğal veya kontrollü canlı tonları, sonbaharda toprak ve derin nötrleri, kışın doygun koyu/nötrleri, ilkbaharda daha ferah ve yumuşak kontrastları önceliklendir. Yalnız ürün adında ya da kanıtta gerçekten görülen renkler hakkında konuş.
            Kumaş ağırlığını ve nefes alabilirliği MaterialSummary/MaterialEvidence ile kontrol et. Materyal kanıtı yoksa uygunmuş gibi varsayma.
            localGuard mevsim veya katman sorunu bulduysa bunu görmezden gelme; sorun çözülmedikçe puanı localGuard.score değerinin en fazla 10 puan üzerine çıkar ve somut değişikliği yaz.
            Bütün hacimli kesimleri aynı anda onaylama. Boxy, relaxed, baggy, straight ve slim kesimleri eş anlamlı sayma.
            Baggy, wide-leg ve relaxed kesimler güncel modada başlı başına kusur değildir. Bunlara otomatik olarak hantal, ağır veya orantısız deme. Hacmi ancak ürün boyu, üst-alt oranı, kumaş dökümü, ayakkabı ölçeği ve kullanıcının istediği görünümle birlikte değerlendir. Geniş altı daha kısa/düzenli üstle dengelemek güvenli bir seçenektir; fakat bilinçli baştan ayağa hacimli streetwear silueti de uygun bağlam ve iyi boy oranıyla geçerli olabilir.
            Kullanıcının istediği ortam/mevsim için seçilen parçaları sonradan eleştireceksen o kombini hiç üretme; uygun kombin bulunamadığını açıkça söyle. Kombin yapmak zorunlu değildir.
            Mini kot etek + kısa kollu tişört + trençkot evrensel olarak doğru değildir: yazın trenç genellikle mevsim dışıdır; ilkbahar/sonbaharda ancak trenç hafif ve açık, boy oranı bilinçli ise çalışabilir.
            Üst ve alt parçanın birlikte çalışmasını değerlendir. Ayakkabı isteğe bağlıdır: seçilmişse kombine uyumunu yorumla; seçilmemişse ayakkabıdan, eksikliğinden veya görünümün tamamlanmadığından hiç söz etme ve puan düşürme.
            Sonuç kesin satış vaadi değildir. Write every user-facing field in {responseLanguage}; keep it concise and concrete. Yalnız şemaya uyan JSON döndür.
            """;
    }

    private static string TurkishMonth(int month) => month switch
    {
        1 => "Ocak", 2 => "Şubat", 3 => "Mart", 4 => "Nisan",
        5 => "Mayıs", 6 => "Haziran", 7 => "Temmuz", 8 => "Ağustos",
        9 => "Eylül", 10 => "Ekim", 11 => "Kasım", _ => "Aralık"
    };

    private static string BuildEvidence(
        UserProfile profile,
        IReadOnlyList<StyleBoardItem> items,
        StyleBoardAnalysisResponse local,
        string userRequest,
        IReadOnlySet<int>? visualProductIds = null)
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
                item.RecommendationConfidence,
                hasAttachedImage = visualProductIds?.Contains(item.Id) == true
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

    private const int MaxImageBytes = 1_500_000;

    private sealed record ProductInlineImage(string Name, string MimeType, string Base64);

    private sealed record AiStyleBoardResult(
        string Verdict,
        int Score,
        string Headline,
        string Explanation,
        IReadOnlyList<string> Notes,
        string SeasonContext);
}
