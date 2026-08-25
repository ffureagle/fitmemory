using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class OpenAiOrderImportClient(
    HttpClient httpClient,
    IOptions<OpenAiOptions> options)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<OrderImportAnalysis> AnalyzeAsync(
        AnalyzeOrderHistoryRequest request,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            throw new InvalidOperationException(
                "OpenAI API anahtarı yapılandırılmamış. Backend User Secrets ayarını kontrol edin.");
        }

        var payload = CreatePayload(settings, request);
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, settings.Endpoint)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);

        using var response = await httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new OpenAiApiException(response.StatusCode, ExtractApiError(responseBody));
        }

        var outputText = ExtractOutputText(responseBody);
        var result = JsonSerializer.Deserialize<AiOrderImportResult>(outputText, JsonOptions)
            ?? throw new InvalidOperationException("OpenAI boş bir sipariş analizi döndürdü.");

        var items = result.Items
            .Take(25)
            .Select(ToResearchedOrder)
            .ToArray();
        return new OrderImportAnalysis(
            items,
            Limit(result.Summary.Trim(), 400),
            "openai-web-research");
    }

    private static object CreatePayload(
        OpenAiOptions settings,
        AnalyzeOrderHistoryRequest request)
    {
        var responseLanguage = request.Language.Equals("en", StringComparison.OrdinalIgnoreCase)
            ? "English"
            : "Turkish";
        var pageEvidence = new
        {
            request.PageUrl,
            request.PageTitle,
            request.Retailer,
            request.SanitizedText,
            orderCards = request.OrderCards.Select(card => new
            {
                card.Text,
                card.Brand,
                card.ProductName,
                card.PurchasedSize,
                card.ProductLinks,
                card.ImageAlt,
                imageAlts = card.Images
                    .Select(image => image.Alt)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Take(12)
            })
        };

        var content = new List<object>
        {
            new
            {
                type = "input_text",
                text = $"""
                    Bu, kullanıcının perakendeci hesabındaki sipariş geçmişi sayfasından alınan ve
                    kişisel bilgileri tarayıcıda filtrelenmiş kanıttır:

                    {JsonSerializer.Serialize(pageEvidence, JsonOptions)}

                    Her gerçek giyim ürünü için marka, tam ürün adı ve satın alınan bedeni çıkar.
                    orderCards içindeki Brand, ProductName ve PurchasedSize alanları aynı görünür
                    ürün kartından çıkarılmış yapılandırılmış DOM kanıtıdır. Bershka
                    online-order-detail sayfasında ürün adının altındaki tek başına görünen 40,
                    42, S veya M değeri satın alınan bedendir; sipariş numarası, tarih veya fiyat
                    değildir. Alanlar doluysa ekran görüntüsüyle doğrulayıp koru.
                    Web aramasıyla ürünün aynısını araştır. Yalnızca aynı ürünün satın alınan bedenine
                    ait doğrulanabilir giysi ölçülerini yaz; bulunamayan her ölçüyü null bırak.
                     Genel marka tablosunu kesin ürün ölçüsü gibi sunma. Ölçü kaynağının doğrudan URL'sini
                     researchSourceUrl alanına koy. Resmi ürün sayfasındaki boxy, relaxed, regular,
                     oversize veya slim kalıp ifadesini değiştirmeden fitLabel alanına; satın alınan bedene ait ölçü
                     kanıtını sizeEvidence alanına yaz. Kaynak resmi marka alan adıysa
                     officialSourceVerified=true yap ve kanıt kalitesini 0-100 puanla.

                    Taranan her ürünün outcome alanını PurchasedUnknownFit yap. Sipariş sayfasındaki
                    teslim, iade veya iptal metni uygulamadaki kullanıcı onayı değildir. Uyum ve
                    iade durumunu yalnız kullanıcı arşiv kartından belirler.
                    Görüntüde olmayan ürün, beden veya ölçüyü uydurma.
                    """
            },
            new
            {
                type = "input_image",
                image_url = request.ScreenshotDataUrl,
                detail = "high"
            }
        };

        return new
        {
            model = settings.Model,
            instructions = $"""
                You are FitMemory's order-history researcher. Write every user-facing field in {responseLanguage}.
                Görseli ve temizlenmiş
                DOM kanıtını birlikte incele; ardından web aramasıyla ürünleri tek tek doğrula. Kullanıcının
                kimliğini, adresini, ödeme bilgisini veya başka hassas özelliğini çıkarmaya çalışma.
                Kanıt yoksa belirsizliği açıkça koru.
                """,
            input = new[]
            {
                new
                {
                    role = "user",
                    content
                }
            },
            tools = new[]
            {
                new { type = "web_search" }
            },
            reasoning = new
            {
                effort = settings.ReasoningEffort
            },
            text = new
            {
                format = new
                {
                    type = "json_schema",
                    name = "order_history_research",
                    strict = true,
                    schema = new
                    {
                        type = "object",
                        additionalProperties = false,
                        properties = new
                        {
                            summary = new { type = "string" },
                            items = new
                            {
                                type = "array",
                                maxItems = 25,
                                items = new
                                {
                                    type = "object",
                                    additionalProperties = false,
                                    properties = new
                                    {
                                        isApparel = new { type = "boolean" },
                                        brand = new { type = "string" },
                                        productName = new { type = "string" },
                                        category = new
                                        {
                                            type = "string",
                                            @enum = new[]
                                            {
                                                "Tops", "Shirts", "Outerwear", "Knitwear",
                                                "Bottoms", "Denim", "Dresses", "Other"
                                            }
                                        },
                                        purchasedSize = new { type = "string" },
                                        outcome = new
                                        {
                                            type = "string",
                                            @enum = new[]
                                            {
                                                "PurchasedUnknownFit"
                                            }
                                        },
                                        evidence = new { type = "string" },
                                        chestWidthCm = NullableNumberSchema(),
                                        shoulderWidthCm = NullableNumberSchema(),
                                        waistWidthCm = NullableNumberSchema(),
                                        lengthCm = NullableNumberSchema(),
                                        sleeveLengthCm = NullableNumberSchema(),
                                        inseamCm = NullableNumberSchema(),
                                        productUrl = new { type = "string" },
                                        researchSourceUrl = new { type = "string" },
                                        fitLabel = new { type = "string" },
                                        sizeEvidence = new { type = "string" },
                                        officialSourceVerified = new { type = "boolean" },
                                        researchConfidence = new
                                        {
                                            type = "integer",
                                            minimum = 0,
                                            maximum = 100
                                        }
                                    },
                                    required = new[]
                                    {
                                        "isApparel", "brand", "productName", "category", "purchasedSize",
                                        "outcome", "evidence", "chestWidthCm", "shoulderWidthCm",
                                         "waistWidthCm", "lengthCm", "sleeveLengthCm", "inseamCm",
                                         "productUrl", "researchSourceUrl", "fitLabel", "sizeEvidence",
                                         "officialSourceVerified", "researchConfidence"
                                    }
                                }
                            }
                        },
                        required = new[] { "summary", "items" }
                    }
                }
            },
            max_output_tokens = 4_500,
            store = false
        };
    }

    private static object NullableNumberSchema()
    {
        return new
        {
            type = new[] { "number", "null" },
            minimum = 0,
            maximum = 300
        };
    }

    private static ResearchedOrder ToResearchedOrder(AiOrderItem item)
    {
        const OrderOutcome outcome =
            OrderOutcome.PurchasedUnknownFit;

        return new ResearchedOrder(
            item.IsApparel,
            Limit(item.Brand.Trim(), 100),
            Limit(item.ProductName.Trim(), 160),
            Limit(item.Category.Trim(), 60),
            Limit(item.PurchasedSize.Trim().ToUpperInvariant(), 30),
            outcome,
            Limit(item.Evidence.Trim(), 240),
            NormalizeMeasurement(item.ChestWidthCm, 20, 150),
            NormalizeMeasurement(item.ShoulderWidthCm, 20, 180),
            NormalizeMeasurement(item.WaistWidthCm, 20, 130),
            NormalizeMeasurement(item.LengthCm, 20, 180),
            NormalizeMeasurement(item.SleeveLengthCm, 10, 120),
            NormalizeMeasurement(item.InseamCm, 20, 130),
            Limit(item.ProductUrl.Trim(), 1_000),
            Limit(item.ResearchSourceUrl.Trim(), 1_000),
            Limit(item.FitLabel.Trim(), 80),
            Limit(item.SizeEvidence.Trim(), 500),
            item.OfficialSourceVerified,
            Math.Clamp(item.ResearchConfidence, 0, 88));
    }

    private static decimal? NormalizeMeasurement(decimal? value, decimal min, decimal max)
    {
        return value is >= 0 && value >= min && value <= max
            ? decimal.Round(value.Value, 1)
            : null;
    }

    private static string ExtractOutputText(string responseBody)
    {
        using var document = JsonDocument.Parse(responseBody);
        var root = document.RootElement;
        if (root.TryGetProperty("output_text", out var outputText) &&
            outputText.ValueKind == JsonValueKind.String)
        {
            return outputText.GetString()
                ?? throw new InvalidOperationException("OpenAI null çıktı döndürdü.");
        }

        if (root.TryGetProperty("output", out var output) &&
            output.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in output.EnumerateArray())
            {
                if (!item.TryGetProperty("content", out var outputContent) ||
                    outputContent.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var contentItem in outputContent.EnumerateArray())
                {
                    if (contentItem.TryGetProperty("text", out var text) &&
                        text.ValueKind == JsonValueKind.String)
                    {
                        return text.GetString()
                            ?? throw new InvalidOperationException("OpenAI null çıktı döndürdü.");
                    }
                }
            }
        }

        throw new InvalidOperationException("OpenAI metin çıktısı döndürmedi.");
    }

    private static string ExtractApiError(string responseBody)
    {
        try
        {
            var node = JsonNode.Parse(responseBody);
            return node?["error"]?["message"]?.GetValue<string>() ?? Limit(responseBody, 500);
        }
        catch (JsonException)
        {
            return Limit(responseBody, 500);
        }
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private sealed class AiOrderImportResult
    {
        public string Summary { get; init; } = "";

        public IReadOnlyList<AiOrderItem> Items { get; init; } = [];
    }

    private sealed class AiOrderItem
    {
        public bool IsApparel { get; init; }

        public string Brand { get; init; } = "";

        public string ProductName { get; init; } = "";

        public string Category { get; init; } = "Other";

        public string PurchasedSize { get; init; } = "";

        public string Outcome { get; init; } = "PurchasedUnknownFit";

        public string Evidence { get; init; } = "";

        public decimal? ChestWidthCm { get; init; }

        public decimal? ShoulderWidthCm { get; init; }

        public decimal? WaistWidthCm { get; init; }

        public decimal? LengthCm { get; init; }

        public decimal? SleeveLengthCm { get; init; }

        public decimal? InseamCm { get; init; }

        public string ProductUrl { get; init; } = "";

        public string ResearchSourceUrl { get; init; } = "";

        public string FitLabel { get; init; } = "";

        public string SizeEvidence { get; init; } = "";

        public bool OfficialSourceVerified { get; init; }

        public int ResearchConfidence { get; init; }
    }
}
