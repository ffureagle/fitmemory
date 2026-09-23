using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FitMemory.Api.Models;
using FitMemory.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Tests;

public sealed class StyleBoardAnalysisServiceTests
{
    [Fact]
    public async Task AiFailureNamesProductsInsteadOfFixedStrongScore()
    {
        var posts = 0;
        var service = Create(_ =>
        {
            posts++;
            return new HttpResponseMessage(HttpStatusCode.InternalServerError)
            {
                Content = new StringContent("unavailable")
            };
        });

        var result = await service.AnalyzeAsync(
            Profile(),
            Items(inditexImage: false),
            "tr",
            "",
            CancellationToken.None);

        Assert.Equal(2, posts);
        Assert.Equal("Kanıt eksik", result.Verdict);
        Assert.Equal(0, result.Score);
        Assert.NotEqual("Güçlü", result.Verdict);
        Assert.Contains("Zara Boxy tişört", result.Explanation);
        Assert.Contains("Pull&Bear Straight jean", result.Explanation);
        Assert.Contains("Zara Boxy tişört", result.Notes);
        Assert.Contains("Pull&Bear Straight jean", result.Notes);
    }

    [Fact]
    public async Task GeminiSendsInditexInlineImageAndRetriesOnce()
    {
        var posts = 0;
        var downloads = new List<string>();
        string? geminiBody = null;
        var service = Create(request =>
        {
            if (request.Method == HttpMethod.Get)
            {
                downloads.Add(request.RequestUri!.Host);
                if (!request.RequestUri.Host.Equals("static.zara.net", StringComparison.Ordinal))
                {
                    return new HttpResponseMessage(HttpStatusCode.NotFound);
                }

                var image = new ByteArrayContent([0xFF, 0xD8, 0xFF]);
                image.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = image };
            }

            posts++;
            geminiBody = request.Content is null
                ? ""
                : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            if (posts == 1)
            {
                return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                {
                    Content = new StringContent("busy")
                };
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(GeminiOk, Encoding.UTF8, "application/json")
            };
        });

        var result = await service.AnalyzeAsync(
            Profile(),
            Items(inditexImage: true),
            "tr",
            "iş için",
            CancellationToken.None);

        Assert.Equal(["static.zara.net"], downloads);
        Assert.Equal(2, posts);
        Assert.NotNull(geminiBody);
        Assert.Contains("inlineData", geminiBody, StringComparison.Ordinal);
        Assert.Contains("/9j/", geminiBody, StringComparison.Ordinal);
        Assert.Contains("image/jpeg", geminiBody, StringComparison.Ordinal);
        Assert.Equal("Güçlü", result.Verdict);
        Assert.Equal(81, result.Score);
        Assert.NotEqual("Kanıt eksik", result.Verdict);
    }

    private const string GeminiOk =
        """
        {"candidates":[{"content":{"parts":[{"text":"{\"verdict\":\"Güçlü\",\"score\":81,\"headline\":\"Dengeli üst ve alt\",\"explanation\":\"Parçalar birlikte çalışıyor.\",\"notes\":[\"Üst ve alt dengeli.\"],\"seasonContext\":\"Eylül\"}"}]}}]}
        """;

    private static StyleBoardAnalysisService Create(
        Func<HttpRequestMessage, HttpResponseMessage> respond)
    {
        var client = new HttpClient(new ScriptedHandler(respond));
        return new StyleBoardAnalysisService(
            client,
            Options.Create(new AiProviderOptions { Provider = "Gemini" }),
            Options.Create(new GeminiOptions { ApiKey = "test-key", Model = "gemini-test" }),
            Options.Create(new OpenAiOptions()),
            NullLogger<StyleBoardAnalysisService>.Instance);
    }

    private static UserProfile Profile() => new()
    {
        UserId = "style-board-user",
        FitPreference = FitPreference.TrueToSize
    };

    private static IReadOnlyList<StyleBoardItem> Items(bool inditexImage)
    {
        var profile = Profile();
        return
        [
            Item(profile, "Zara", "Boxy tişört", "Tişört",
                inditexImage ? "https://static.zara.net/photos/boxy.jpg" : ""),
            Item(profile, "Pull&Bear", "Straight jean", "Pantolon",
                "https://cdn.evil.test/look.jpg")
        ];
    }

    private static StyleBoardItem Item(
        UserProfile profile,
        string brand,
        string name,
        string category,
        string imageUrl) => new()
    {
        UserProfile = profile,
        ProductUrl = $"https://www.zara.com/tr/tr/{name.ToLowerInvariant()}-p1.html",
        Brand = brand,
        ProductName = name,
        Category = category,
        ImageUrl = imageUrl
    };

    private sealed class ScriptedHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }
}
