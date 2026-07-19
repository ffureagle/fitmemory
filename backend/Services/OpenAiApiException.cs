using System.Net;

namespace FitMemory.Api.Services;

public sealed class OpenAiApiException(HttpStatusCode statusCode, string apiMessage)
    : AiProviderException("OpenAI", statusCode, "", apiMessage);
