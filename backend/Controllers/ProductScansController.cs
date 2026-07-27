using FitMemory.Api.Contracts;
using FitMemory.Api.Security;
using FitMemory.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FitMemory.Api.Controllers;

[ApiController]
[Route("api/product-scans")]
[Authorize]
public sealed class ProductScansController(GeminiProductScanClient scanner) : ControllerBase
{
    [HttpPost("vision")]
    public async Task<ActionResult<VisionProductScanResponse>> Vision(
        VisionProductScanRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId)) return Forbid();
        try { return Ok(await scanner.AnalyzeAsync(request, cancellationToken)); }
        catch (AiProviderException exception)
        {
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Görsel ölçü okuyucu yanıt vermedi", detail: exception.ApiMessage);
        }
        catch (InvalidOperationException exception)
        {
            return Problem(statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Beden ölçüleri doğrulanamadı", detail: exception.Message);
        }
    }
}
