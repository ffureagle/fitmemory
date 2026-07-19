using System.Net;

namespace FitMemory.Api.Services;

public sealed class GeminiApiException(
    HttpStatusCode statusCode,
    string apiCode,
    string apiMessage)
    : AiProviderException("Gemini", statusCode, apiCode, apiMessage);
