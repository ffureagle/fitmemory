namespace FitMemory.Api.Services;

public sealed class OpenAiOptions
{
    public const string SectionName = "OpenAi";

    public string ApiKey { get; set; } = "";

    public string Model { get; set; } = "gpt-5.6-sol";

    public string Endpoint { get; set; } = "https://api.openai.com/v1/responses";

    public string ReasoningEffort { get; set; } = "low";

    public bool FallbackOnError { get; set; } = true;
}
