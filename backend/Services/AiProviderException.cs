using System.Net;

namespace FitMemory.Api.Services;

public class AiProviderException(
    string provider,
    HttpStatusCode statusCode,
    string apiCode,
    string apiMessage)
    : Exception($"{provider} HTTP {(int)statusCode} {apiCode}: {apiMessage}")
{
    public string Provider { get; } = provider;

    public HttpStatusCode StatusCode { get; } = statusCode;

    public string ApiCode { get; } = apiCode;

    public string ApiMessage { get; } = apiMessage;
}
