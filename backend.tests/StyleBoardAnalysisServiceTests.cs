using System.Net;
using System.Text;
using System.Text.Json;
using FitMemory.Api.Models;
using FitMemory.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Tests;

public sealed class StyleBoardAnalysisServiceTests
{
    [Fact]
    public async Task GeminiRequestIncludesTrustedProductImages()
    {
        string? geminiRequest = null;
        var handler = new StubHandler(async request =>
        {
            if (request.Method == HttpMethod.Get)
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new ByteArrayContent([1, 2, 3, 4])
                    {
                        Headers =
                        {
                            ContentType =
                                new System.Net.Http.Headers.MediaTypeHeaderValue(
                                    "image/jpeg")
                        }
                    }
                };
            }

            geminiRequest = await request.Content!.ReadAsStringAsync();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    {
                      "candidates": [{
                        "content": {
                          "parts": [{
                            "text": "{\"verdict\":\"Güçlü\",\"score\":82,\"headline\":\"Renk ve oran dengeli\",\"explanation\":\"Görseller birlikte çalışıyor.\",\"notes\":[],\"seasonContext\":\"Eylül · Sonbahar\"}"
                          }]
                        }
                      }]
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            };
        });
        var service = CreateService(new HttpClient(handler));
        var profile = Profile();

        var result = await service.AnalyzeAsync(
            profile,
            [
                Item(
                    profile,
                    1,
                    "Gömlek",
                    "Üst",
                    "https://static.pullandbear.net/image.jpg"),
                Item(profile, 2, "Jean", "Alt", "")
            ],
            "tr",
            "",
            CancellationToken.None);

        Assert.NotNull(geminiRequest);
        Assert.Contains("\"inlineData\"", geminiRequest);
        Assert.Contains(Convert.ToBase64String([1, 2, 3, 4]), geminiRequest);
        using var payload = JsonDocument.Parse(geminiRequest);
        var evidence = payload.RootElement
            .GetProperty("contents")[0]
            .GetProperty("parts")
            .EnumerateArray()
            .Last(part => part.TryGetProperty("text", out var text) &&
                          text.GetString()?.Contains(
                              "selectedProducts",
                              StringComparison.Ordinal) == true)
            .GetProperty("text")
            .GetString();
        Assert.Contains("\"hasAttachedImage\":true", evidence);
        Assert.Equal(82, result.Score);
    }

    [Fact]
    public async Task AiFailureDoesNotClaimUnverifiedVisualCompatibility()
    {
        var handler = new StubHandler(_ =>
            Task.FromResult(new HttpResponseMessage(
                HttpStatusCode.ServiceUnavailable)));
        var service = CreateService(new HttpClient(handler));
        var profile = Profile();

        var result = await service.AnalyzeAsync(
            profile,
            [
                Item(profile, 1, "Ceket", "Dış giyim", ""),
                Item(profile, 2, "Jean", "Alt", "")
            ],
            "tr",
            "",
            CancellationToken.None);

        Assert.Equal("Kanıt eksik", result.Verdict);
        Assert.True(result.Score <= 58);
        Assert.Contains(
            "görsel",
            result.Explanation,
            StringComparison.OrdinalIgnoreCase);
    }

    private static StyleBoardAnalysisService CreateService(HttpClient client) =>
        new(
            client,
            Options.Create(new AiProviderOptions { Provider = "Gemini" }),
            Options.Create(new GeminiOptions { ApiKey = "test-key" }),
            Options.Create(new OpenAiOptions()),
            NullLogger<StyleBoardAnalysisService>.Instance);

    private static UserProfile Profile() => new()
    {
        UserId = "test-user",
        Age = 26,
        HeightCm = 175,
        WeightKg = 70,
        ShoulderWidthCm = 44,
        WaistCircumferenceCm = 80
    };

    private static StyleBoardItem Item(
        UserProfile profile,
        int id,
        string name,
        string category,
        string imageUrl) => new()
    {
        Id = id,
        UserProfile = profile,
        ProductUrl = $"https://www.pullandbear.com/{id}",
        Brand = "Pull&Bear",
        ProductName = name,
        Category = category,
        ImageUrl = imageUrl,
        FitLabel = "Regular",
        IsSelected = true,
        IsInStudio = true
    };

    private sealed class StubHandler(
        Func<HttpRequestMessage, Task<HttpResponseMessage>> send)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => send(request);
    }
}
