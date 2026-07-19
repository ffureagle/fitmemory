namespace FitMemory.Api.Services;

public sealed class AiProviderOptions
{
    public const string SectionName = "Ai";

    public string Provider { get; set; } = "Gemini";

    public bool IsGemini =>
        Provider.Equals("Gemini", StringComparison.OrdinalIgnoreCase);

    public bool IsOpenAi =>
        Provider.Equals("OpenAI", StringComparison.OrdinalIgnoreCase);
}
