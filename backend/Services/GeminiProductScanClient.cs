using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using FitMemory.Api.Contracts;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class GeminiProductScanClient(
    HttpClient httpClient,
    IOptions<GeminiOptions> options)
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web)
        {
            NumberHandling = JsonNumberHandling.AllowReadingFromString
        };

    public async Task<VisionProductScanResponse> AnalyzeAsync(
        VisionProductScanRequest request,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ApiKey))
            throw new InvalidOperationException("Gemini API anahtarı yapılandırılmamış.");
        var image = GeminiResponseReader.ParseImageDataUrl(request.ScreenshotDataUrl);
        var prompt = $"""
            FitMemory mobil tarayıcısındaki resmi ürün sayfasının ekran görüntüsünü, Android erişilebilirlik
            ağacını, cihaz içi OCR metnini ve DOM metnini birlikte incele. Kanıt önceliği cihaz içi OCR ve
            erişilebilirlik metni, ekranda görünen tablo, son olarak DOM metnidir. Aynı değeri tek kez yaz.
            Görevin yalnızca ekranda gerçekten görünen ÜRÜN ÖLÇÜ TABLOSUNU çıkarmaktır. Beden etiketi,
            göğüs eni, ön uzunluk, kol, omuz, bel, kalça, iç bacak gibi satırları aynen eşleştir.
            Vücut beden rehberini ürünün düz zeminde ölçülen parça ölçüleriyle karıştırma. Hiçbir sayıyı
            tahmin etme veya marka geneli tablodan tamamlama. Görünen yatay CSS grid de tablodur;
            HTML table etiketi bulunması gerekmez. Sütunlar ekranda kısmen görünüyorsa yalnız görünenleri yaz.

            Mevcut ürün verisi: {JsonSerializer.Serialize(request.Product, JsonOptions)}
            Erişilebilirlik ağacı: {request.AccessibilityText}
            Cihaz içi OCR: {request.OcrText}
            Sayfa metni: {request.PageText}

            sizeChart.found yalnız en az bir bedenle en az bir gerçek sayısal ölçü eşleştiyse true olsun.
            """;
        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = "Sen kesin kanıt kullanan bir moda ürün ölçü tablosu OCR uzmanısın. JSON dışında çıktı verme." } } },
            contents = new[] { new { role = "user", parts = new object[] { new { text = prompt }, new { inlineData = new { mimeType = image.MimeType, data = image.Data } } } } },
            generationConfig = new
            {
                temperature = 0.0,
                maxOutputTokens = 2200,
                responseMimeType = "application/json",
                responseJsonSchema = new
                {
                    type = "object", additionalProperties = false,
                    properties = new
                    {
                        sizeChart = new
                        {
                            type = "object", additionalProperties = false,
                            properties = new
                            {
                                found = new { type = "boolean" }, title = new { type = "string" },
                                unit = new { type = "string" },
                                headers = new { type = "array", items = new { type = "string" } },
                                rows = new { type = "array", items = new { type = "object", additionalProperties = false, properties = new { cells = new { type = "array", items = new { type = "string" } } }, required = new[] { "cells" } } },
                                rawText = new { type = "string" }
                            },
                            required = new[] { "found", "title", "unit", "headers", "rows", "rawText" }
                        }
                    }, required = new[] { "sizeChart" }
                }
            }
        };
        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, GeminiResponseReader.BuildGenerateContentEndpoint(settings))
        {
            Content = new StringContent(JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json")
        };
        httpRequest.Headers.Add("x-goog-api-key", settings.ApiKey);
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await httpClient.SendAsync(httpRequest, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = GeminiResponseReader.ExtractApiError(body);
            throw new GeminiApiException(response.StatusCode, error.Code, error.Message);
        }
        var result = JsonSerializer.Deserialize<VisionResult>(GeminiResponseReader.ExtractText(body), JsonOptions)
            ?? throw new InvalidOperationException("Görsel ölçü okuyucu boş yanıt verdi.");
        if (!result.SizeChart.Found || (result.SizeChart.Rows.Count == 0 && string.IsNullOrWhiteSpace(result.SizeChart.RawText)))
            throw new InvalidOperationException("Açık ekranda bedenle eşleşen sayısal ürün ölçüsü bulunamadı.");
        return new VisionProductScanResponse(request.Product, result.SizeChart, DateTimeOffset.UtcNow);
    }

    private sealed class VisionResult
    {
        public required SizeChartDto SizeChart { get; init; }
    }
}
