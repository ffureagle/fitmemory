using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class GeminiOrderImportClient(
    HttpClient httpClient,
    IOptions<GeminiOptions> options,
    ILogger<GeminiOrderImportClient> logger)
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web)
        {
            NumberHandling = JsonNumberHandling.AllowReadingFromString
        };

    public async Task<OrderImportAnalysis> AnalyzeAsync(
        AnalyzeOrderHistoryRequest request,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            throw new InvalidOperationException(
                "Gemini API anahtarı yapılandırılmamış. Backend User Secrets ayarını kontrol edin.");
        }

        var image = GeminiResponseReader.ParseImageDataUrl(
            request.ScreenshotDataUrl ?? "");
        var officialProductUrls = GetOfficialProductUrls(request);
        var officialHosts = officialProductUrls
            .Select(url => new Uri(url).Host)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var googleSearchUsed = settings.UseGoogleSearch;
        var urlContextUsed =
            settings.UseUrlContext &&
            officialProductUrls.Count > 0;
        string researchBody;
        try
        {
            var researchPayload = CreateResearchPayload(
                request,
                image,
                googleSearchUsed,
                urlContextUsed,
                officialProductUrls);
            researchBody = await SendAsync(
                settings,
                researchPayload,
                cancellationToken);
        }
        catch (GeminiApiException exception)
            when ((googleSearchUsed || urlContextUsed) &&
                  settings.FallbackWithoutWebTools &&
                  CanRetryWithoutWebTools(exception))
        {
            googleSearchUsed = false;
            urlContextUsed = false;
            logger.LogWarning(
                "Gemini web aracı kullanılamadı ({StatusCode}, {ApiCode}); " +
                "sipariş taraması görsel ve DOM kanıtıyla sürdürülecek.",
                (int)exception.StatusCode,
                exception.ApiCode);
            var fallbackPayload = CreateResearchPayload(
                request,
                image,
                useGoogleSearch: false,
                useUrlContext: false,
                officialProductUrls);
            researchBody = await SendAsync(
                settings,
                fallbackPayload,
                cancellationToken);
        }

        var researchText = GeminiResponseReader.ExtractText(researchBody);
        var formattingPayload = CreateFormattingPayload(
            researchText,
            googleSearchUsed,
            urlContextUsed,
            request.Language);
        var formattingBody = await SendAsync(
            settings,
            formattingPayload,
            cancellationToken);
        var outputText = GeminiResponseReader.ExtractText(formattingBody);
        var result = JsonSerializer.Deserialize<AiOrderImportResult>(
            NormalizeJson(outputText),
            JsonOptions)
            ?? throw new InvalidOperationException(
                "Gemini boş bir sipariş analizi döndürdü.");
        var items = (result.Items ?? [])
            .Take(25)
            .Select(item => ToResearchedOrder(
                item,
                officialHosts,
                request.ProductPageResearch))
            .ToArray();
        var summary = Limit(NormalizeText(result.Summary), 400);
        if (!googleSearchUsed && !urlContextUsed)
        {
            summary = Limit(
                $"{summary} Web aracı kullanılamadığı için ürünler ekran görüntüsü " +
                "ve sayfa verisiyle çözümlendi.",
                400);
        }

        return new OrderImportAnalysis(
            items,
            summary,
            googleSearchUsed
                ? "gemini-google-search"
                : urlContextUsed
                    ? "gemini-url-context"
                    : "gemini-vision-dom");
    }

    private static object CreateResearchPayload(
        AnalyzeOrderHistoryRequest request,
        (string MimeType, string Data) image,
        bool useGoogleSearch,
        bool useUrlContext,
        IReadOnlyList<string> officialProductUrls)
    {
        var officialUrlSet = officialProductUrls.ToHashSet(
            StringComparer.OrdinalIgnoreCase);
        var pageEvidence = new
        {
            request.PageTitle,
            request.Retailer,
            request.SanitizedText,
            officialProductUrls,
            officialPageResearch = request.ProductPageResearch.Select(research => new
            {
                research.Product,
                research.SizeChart,
                research.FitLabel,
                research.PageText
            }),
            orderCards = request.OrderCards.Take(12).Select(card => new
            {
                card.Text,
                card.Brand,
                card.ProductName,
                card.PurchasedSize,
                productLinks = card.ProductLinks
                    .Where(officialUrlSet.Contains)
                    .Take(3),
                card.ImageAlt,
                imageAlts = card.Images
                    .Select(image => image.Alt)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Take(12)
            })
        };
        var researchInstruction = useGoogleSearch
            ? """
              Google Search kullanarak ürünün aynısını araştır. Yalnızca aynı ürünün satın alınan
              bedenine ait doğrulanabilir giysi ölçülerini yaz; bulunamayan her ölçüyü null bırak.
              Genel marka tablosunu kesin ürün ölçüsü gibi sunma. Ölçü kaynağının doğrudan URL'sini
              researchSourceUrl alanına koy ve kanıt kalitesini 0-100 puanla.
              """
            : useUrlContext
                ? """
                  Ürün kartlarındaki doğrudan ürün bağlantılarını URL Context ile aç ve içeriklerini
                  incele. Ekran görüntüsündeki ürün görselini, kart metnini ve resmi ürün sayfasını
                  eşleştir. Ürün sayfasında “boxy fit”, “relaxed fit”, “regular fit”, “oversized”, “slim fit”
                  veya eşdeğer kalıp ifadesini ara ve fitLabel alanına aynen yaz. Satın alınan
                  bedeni sayfadaki ürün ölçüleri/beden tablosunda bul. Yalnızca o bedene açıkça
                  bağlanan giysi ölçülerini kullan; bulunamayan ölçüleri null bırak.
                  Boxy etiketini loose veya oversized olarak yeniden adlandırma; resmi sayfadaki
                  ifadeyi koru.

                  productUrl resmi ürün sayfası, researchSourceUrl ölçünün görüldüğü resmi ürün
                  veya beden rehberi sayfası olsun. sizeEvidence alanında kaynakta gerçekten yazan
                  beden ve ölçüleri kısa biçimde özetle. Genel marka beden tablosunu, modele ait
                  ürün ölçüsü gibi sunma. Sayfaya veya beden tablosuna erişilemediyse
                  officialSourceVerified=false yap; internet araştırması yapılmış gibi davranma.
                  """
                : """
                  Yalnızca ekran görüntüsü, temizlenmiş sayfa metni ve ürün kartlarındaki
                  bağlantıları kanıt kabul et. İnternette araştırma yaptığını iddia etme; görünmeyen
                  giysi ölçülerini null bırak ve researchSourceUrl alanını boş bırak. Kanıt güvenini
                  en fazla 60 olarak değerlendir.
                  """;
        var prompt = $"""
            Bu, kullanıcının perakendeci hesabındaki sipariş geçmişi sayfasından alınan ve
            kişisel bilgileri tarayıcıda filtrelenmiş kanıttır:

            {JsonSerializer.Serialize(pageEvidence, JsonOptions)}

            Görseli ve DOM kanıtını birlikte incele. Her gerçek giyim ürünü için marka, tam ürün
            adı ve satın alınan bedeni çıkar. Aynı karttaki görsel, metin ve ürün URL'sinin aynı
            kıyafete ait olduğunu doğrulamadan ölçü atama.

            orderCards içindeki Brand, ProductName ve PurchasedSize alanları tarayıcının aynı
            ürün kartındaki görünür metin düğümlerinden çıkardığı yapılandırılmış DOM kanıtıdır.
            Özellikle Bershka online-order-detail sayfasında ürün adının altındaki tek başına
            görünen 40, 42, S veya M değeri satın alınan bedendir; sipariş numarası, tarih veya
            fiyat değildir. Bu yapılandırılmış alanlar doluysa ekran görüntüsüyle doğrulayıp koru.

            officialPageResearch içinde tarayıcı oturumundan okunmuş resmi ürün sayfası kanıtı
            varsa URL Context sonucundan önce onu kullan. Satın alınan beden satırını
            SizeChart.Headers ve SizeChart.Rows içinde beden etiketiyle eşleştir. FitLabel alanını
            resmi sayfadaki kalıp sinyali olarak koru.

            {researchInstruction}

            Taranan her ürünün outcome alanını PurchasedUnknownFit yap. Sipariş sayfasında iade,
            teslim veya iptal yazması uygulamadaki kullanıcı onayı değildir. KeptGoodFit,
            KeptTooBaggy, KeptTooTight, ReturnedTooBaggy veya ReturnedTooTight üretme;
            uyum ve iade durumunu yalnız kullanıcı arşiv kartından belirler.
            Görüntüde olmayan ürün, beden veya ölçüyü uydurma.
            researchConfidence için şu kalibrasyonu uygula: yalnız ekran görüntüsü/DOM 0-45;
            resmi ürün eşleşmesi fakat ölçü yok 46-62; resmi kalıp veya kısmi beden kanıtı 63-76;
            aynı ürünün satın alınan bedenine ait açık resmi ölçüler 77-88. Asla 88'i aşma.
            """;
        var tools = new List<object>();
        if (useGoogleSearch)
        {
            tools.Add(new Dictionary<string, object>
            {
                ["google_search"] = new { }
            });
        }
        if (useUrlContext)
        {
            tools.Add(new Dictionary<string, object>
            {
                ["url_context"] = new { }
            });
        }
        var systemText = useGoogleSearch
            ? """
              Sen FitMemory'nin Türkçe konuşan sipariş geçmişi araştırmacısısın. Görseli ve
              temizlenmiş DOM kanıtını birlikte incele; ürünleri Google Search ile tek tek
              doğrula. Kullanıcının kimliğini, adresini, ödeme bilgisini veya başka hassas
              özelliğini çıkarmaya çalışma. Sonuç metinlerinin tamamı Türkçe olsun. Kanıt yoksa
              belirsizliği koru.
              """
            : useUrlContext
                ? """
                  Sen FitMemory'nin Türkçe konuşan sipariş geçmişi araştırmacısısın. Görseli ve
                  temizlenmiş DOM kanıtını birlikte incele; verilen doğrudan ürün bağlantılarını
                  URL Context ile doğrula. Erişilemeyen sayfalardan bilgi uydurma. Kullanıcının
                  kimliğini, adresini, ödeme bilgisini veya başka hassas özelliğini çıkarmaya
                  çalışma. Tüm sonuçlar Türkçe olsun ve kanıt yoksa belirsizliği koru.
                  """
                : """
                  Sen FitMemory'nin Türkçe konuşan sipariş geçmişi çözümleyicisisin. Yalnızca
                  görseli, temizlenmiş DOM kanıtını ve verilen ürün bağlantılarını kullan. İnternet
                  araştırması yaptığını iddia etme. Kullanıcının kimliğini, adresini, ödeme
                  bilgisini veya başka hassas özelliğini çıkarmaya çalışma. Tüm sonuçlar Türkçe
                  olsun ve kanıt yoksa belirsizliği koru.
                  """;
        var responseLanguage = request.Language.Equals("en", StringComparison.OrdinalIgnoreCase)
            ? "English"
            : "Turkish";
        systemText += $"\nWrite every user-facing field in {responseLanguage}.";

        return new
        {
            systemInstruction = new
            {
                parts = new[]
                {
                    new
                    {
                        text = systemText
                    }
                }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new object[]
                    {
                        new { text = prompt },
                        new
                        {
                            inlineData = new
                            {
                                mimeType = image.MimeType,
                                data = image.Data
                            }
                        }
                    }
                }
            },
            tools,
            generationConfig = new
            {
                temperature = 0.1,
                maxOutputTokens = 6_000
            }
        };
    }

    private static object CreateFormattingPayload(
        string researchText,
        bool googleSearchUsed,
        bool urlContextUsed,
        string language)
    {
        var boundedResearch = researchText.Length <= 60_000
            ? researchText
            : researchText[..60_000];
        var evidenceMode = googleSearchUsed
            ? """
              Google Search kullanıldı. Yalnızca doğrudan kaynak URL'si bulunan ve aynı ürüne
              ait olduğu doğrulanan ölçüleri koru.
              """
            : urlContextUsed
                ? """
                  URL Context kullanıldı. Yalnızca aracın erişebildiğini açıkça belirttiği doğrudan
                  ürün URL'lerinden doğrulanan ölçüleri koru. Erişilemeyen sayfalara kaynak URL
                  atama ve bu sayfalardan ölçü çıkarma.
                  """
                : """
                  Web aracı kullanılmadı. researchSourceUrl alanını boş bırak, görünmeyen tüm
                  ölçüleri null yap ve researchConfidence değerini en fazla 60 tut.
                  """;
        var responseLanguage = language.Equals("en", StringComparison.OrdinalIgnoreCase)
            ? "English"
            : "Turkish";
        var prompt = $"""
            Aşağıdaki Gemini görsel ve sayfa analizi bulgularını verilen JSON şemasına dönüştür.
            Bulgularda bulunmayan ürün, beden, iade nedeni, ölçü veya URL ekleme. Kaynakla
            doğrulanmayan ölçüleri null bırak. Write every user-facing field in {responseLanguage}.

            KANIT MODU:
            {evidenceMode}

            ÇIKTI SÖZLEŞMESİ:
            Aşağıdaki alan adlarıyla tek bir JSON nesnesi üret. summary bir metin, items bir dizi
            olmalıdır. Her items elemanı şu alanların tamamını içermelidir:
            isApparel (boolean), brand (string), productName (string), category (string),
            purchasedSize (string), outcome (string), evidence (string), fitLabel (string),
            sizeEvidence (string), officialSourceVerified (boolean), chestWidthCm
            (number veya null), shoulderWidthCm (number veya null), waistWidthCm
            (number veya null), lengthCm (number veya null), sleeveLengthCm (number veya null),
            inseamCm (number veya null), productUrl (string), researchSourceUrl (string),
            researchConfidence (0-100 integer).
            category yalnızca Tops, Shirts, Outerwear, Knitwear, Bottoms, Denim, Dresses veya
            Other olabilir. outcome her zaman PurchasedUnknownFit olmalıdır. Sayfadaki teslim,
            iade veya iptal metninden uygulama uyum sonucu çıkarma.

            ARAŞTIRMA BULGULARI:
            {boundedResearch}
            """;

        return new
        {
            systemInstruction = new
            {
                parts = new[]
                {
                    new
                    {
                        text = """
                            Sen FitMemory araştırma bulgularını kayıpsız ve uydurma yapmadan
                            doğrulanmış sipariş arşivi JSON'una dönüştüren veri uzmanısın.
                            """
                    }
                }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new[] { new { text = prompt } }
                }
            },
            generationConfig = new
            {
                temperature = 0.0,
                maxOutputTokens = 6_000,
                responseMimeType = "application/json"
            }
        };
    }

    private static bool CanRetryWithoutWebTools(
        GeminiApiException exception)
    {
        return exception.StatusCode is
            HttpStatusCode.BadRequest or
            HttpStatusCode.Forbidden or
            HttpStatusCode.TooManyRequests or
            HttpStatusCode.InternalServerError or
            HttpStatusCode.BadGateway or
            HttpStatusCode.ServiceUnavailable or
            HttpStatusCode.GatewayTimeout;
    }

    private async Task<string> SendAsync(
        GeminiOptions settings,
        object payload,
        CancellationToken cancellationToken)
    {
        var endpoint = GeminiResponseReader.BuildGenerateContentEndpoint(settings);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        httpRequest.Headers.Add("x-goog-api-key", settings.ApiKey);
        httpRequest.Headers.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = GeminiResponseReader.ExtractApiError(responseBody);
            throw new GeminiApiException(
                response.StatusCode,
                error.Code,
                error.Message);
        }

        return responseBody;
    }

    private static ResearchedOrder ToResearchedOrder(
        AiOrderItem item,
        IReadOnlySet<string> officialHosts,
        IReadOnlyList<ProductPageResearchDto> browserResearch)
    {
        const OrderOutcome outcome =
            OrderOutcome.PurchasedUnknownFit;

        var productUrl = NormalizeOfficialUrl(item.ProductUrl, officialHosts);
        var matchingResearch = FindBrowserResearch(
            productUrl,
            item.ProductName,
            browserResearch);
        if (matchingResearch is not null)
        {
            productUrl = NormalizeOfficialUrl(
                matchingResearch.Product.Url,
                officialHosts);
        }
        var researchSourceUrl = NormalizeOfficialUrl(
            item.ResearchSourceUrl,
            officialHosts);
        var browserFitLabel =
            NormalizeText(matchingResearch?.Product.FitLabel).Length > 0
                ? NormalizeText(matchingResearch?.Product.FitLabel)
                : NormalizeText(matchingResearch?.FitLabel);
        if (matchingResearch is not null &&
            researchSourceUrl.Length == 0)
        {
            researchSourceUrl = productUrl;
        }
        var officialSourceVerified =
            ((item.OfficialSourceVerified ?? false) ||
             matchingResearch is not null) &&
            researchSourceUrl.Length > 0 &&
            productUrl.Length > 0;
        var measurements = new decimal?[]
        {
            item.ChestWidthCm,
            item.ShoulderWidthCm,
            item.WaistWidthCm,
            item.LengthCm,
            item.SleeveLengthCm,
            item.InseamCm
        };
        var measurementCount = measurements.Count(value => value is not null);
        var sizeEvidence = officialSourceVerified
            ? Limit(NormalizeText(item.SizeEvidence), 500)
            : "";
        var confidenceCap = officialSourceVerified switch
        {
            true when measurementCount > 0 && sizeEvidence.Length > 0 => 88,
            true when browserFitLabel.Length > 0 ||
                      !string.IsNullOrWhiteSpace(item.FitLabel) => 76,
            true => 62,
            false => 45
        };
        var browserConfidence = matchingResearch is null
            ? 0
            : browserFitLabel.Length > 0
                ? 72
                : 55;

        return new ResearchedOrder(
            item.IsApparel ?? false,
            Limit(NormalizeText(item.Brand), 100),
            Limit(NormalizeText(item.ProductName), 160),
            Limit(NormalizeText(item.Category), 60),
            Limit(NormalizeText(item.PurchasedSize).ToUpperInvariant(), 30),
            outcome,
            Limit(NormalizeText(item.Evidence), 240),
            NormalizeMeasurement(item.ChestWidthCm, 20, 150),
            NormalizeMeasurement(item.ShoulderWidthCm, 20, 100),
            NormalizeMeasurement(item.WaistWidthCm, 20, 130),
            NormalizeMeasurement(item.LengthCm, 20, 180),
            NormalizeMeasurement(item.SleeveLengthCm, 10, 120),
            NormalizeMeasurement(item.InseamCm, 20, 130),
            productUrl,
            researchSourceUrl,
            Limit(
                browserFitLabel.Length > 0
                    ? browserFitLabel
                    : NormalizeText(item.FitLabel),
                80),
            sizeEvidence,
            officialSourceVerified,
            Math.Clamp(
                Math.Max(item.ResearchConfidence ?? 0, browserConfidence),
                0,
                confidenceCap));
    }

    private static ProductPageResearchDto? FindBrowserResearch(
        string productUrl,
        string? productName,
        IReadOnlyList<ProductPageResearchDto> research)
    {
        var exactUrl = research.FirstOrDefault(candidate =>
            SameProductPage(candidate.Product.Url, productUrl));
        if (exactUrl is not null)
        {
            return exactUrl;
        }

        var normalizedName = NormalizeKey(productName);
        return normalizedName.Length < 8
            ? null
            : research.FirstOrDefault(candidate =>
            {
                var candidateName = NormalizeKey(candidate.Product.Name);
                return candidateName.Length >= 8 &&
                       (candidateName.Contains(
                            normalizedName,
                            StringComparison.Ordinal) ||
                        normalizedName.Contains(
                            candidateName,
                            StringComparison.Ordinal));
            });
    }

    private static bool SameProductPage(string left, string right)
    {
        return Uri.TryCreate(left, UriKind.Absolute, out var leftUri) &&
               Uri.TryCreate(right, UriKind.Absolute, out var rightUri) &&
               leftUri.Host.Equals(
                   rightUri.Host,
                   StringComparison.OrdinalIgnoreCase) &&
               leftUri.AbsolutePath.TrimEnd('/').Equals(
                   rightUri.AbsolutePath.TrimEnd('/'),
                   StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeKey(string? value)
    {
        return string.Concat(
            NormalizeText(value)
                .ToUpperInvariant()
                .Where(char.IsLetterOrDigit));
    }

    private static IReadOnlyList<string> GetOfficialProductUrls(
        AnalyzeOrderHistoryRequest request)
    {
        return request.OrderCards
            .SelectMany(card => card.ProductLinks)
            .Select(NormalizeHttpUrl)
            .Where(url => url.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(16)
            .ToArray();
    }

    private static string NormalizeOfficialUrl(
        string? value,
        IReadOnlySet<string> officialHosts)
    {
        var normalized = NormalizeHttpUrl(value);
        if (normalized.Length == 0)
        {
            return "";
        }

        var uri = new Uri(normalized);
        return officialHosts.Any(host =>
            uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) ||
            uri.Host.EndsWith($".{host}", StringComparison.OrdinalIgnoreCase))
            ? Limit(normalized, 1_000)
            : "";
    }

    private static string NormalizeHttpUrl(string? value)
    {
        if (!Uri.TryCreate(NormalizeText(value), UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https"))
        {
            return "";
        }

        return uri.AbsoluteUri;
    }

    private static decimal? NormalizeMeasurement(
        decimal? value,
        decimal min,
        decimal max)
    {
        return value is >= 0 && value >= min && value <= max
            ? decimal.Round(value.Value, 1)
            : null;
    }

    private static string NormalizeJson(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstNewLine = trimmed.IndexOf('\n');
        var closingFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstNewLine >= 0 && closingFence > firstNewLine
            ? trimmed[(firstNewLine + 1)..closingFence].Trim()
            : trimmed;
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private static string NormalizeText(string? value)
    {
        return value?.Trim() ?? "";
    }

    private sealed class AiOrderImportResult
    {
        public string? Summary { get; init; }

        public IReadOnlyList<AiOrderItem>? Items { get; init; }
    }

    private sealed class AiOrderItem
    {
        public bool? IsApparel { get; init; }

        public string? Brand { get; init; }

        public string? ProductName { get; init; }

        public string? Category { get; init; }

        public string? PurchasedSize { get; init; }

        public string? Outcome { get; init; }

        public string? Evidence { get; init; }

        public decimal? ChestWidthCm { get; init; }

        public decimal? ShoulderWidthCm { get; init; }

        public decimal? WaistWidthCm { get; init; }

        public decimal? LengthCm { get; init; }

        public decimal? SleeveLengthCm { get; init; }

        public decimal? InseamCm { get; init; }

        public string? ProductUrl { get; init; }

        public string? ResearchSourceUrl { get; init; }

        public string? FitLabel { get; init; }

        public string? SizeEvidence { get; init; }

        public bool? OfficialSourceVerified { get; init; }

        public int? ResearchConfidence { get; init; }
    }
}
