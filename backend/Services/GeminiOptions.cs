namespace FitMemory.Api.Services;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";

    public string ApiKey { get; set; } = "";

    public string Model { get; set; } = "gemini-3.1-flash-lite";

    public string BaseUrl { get; set; } =
        "https://generativelanguage.googleapis.com/v1beta";

    public bool UseGoogleSearch { get; set; }

    public bool UseUrlContext { get; set; } = true;

    public bool FallbackWithoutWebTools { get; set; } = true;

    public bool FallbackOnError { get; set; } = true;
}
