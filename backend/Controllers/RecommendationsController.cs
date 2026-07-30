using System.Text.Json;
using FitMemory.Api.Contracts;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Security;
using FitMemory.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Controllers;

[ApiController]
[Route("api/recommendations")]
[Authorize]
public sealed class RecommendationsController(
    FitMemoryDbContext db,
    ISizeRecommendationService recommendationService) : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [HttpPost("analyze")]
    [ProducesResponseType<FitRecommendationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FitRecommendationResponse>> Analyze(
        AnalyzeRecommendationRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId))
        {
            return Forbid();
        }

        if (!ProductScanEvidenceValidator.IsVerifiedChart(request.Product, request.SizeChart))
        {
            return Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Doğrulanmış ürün ölçüsü bulunamadı",
                detail: "Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı. Yanlış beden önermek yerine sonuç üretilmedi.");
        }

        var normalizedAdjustmentNote =
            (request.UserAdjustmentNote ?? string.Empty).Trim();
        if (request.IsReconsideration &&
            normalizedAdjustmentNote.Length < 3)
        {
            return Problem(
                statusCode: StatusCodes.Status400BadRequest,
                title: "Yeniden değerlendirme notu gerekli",
                detail:
                    "Mevcut öneriyi yeniden değerlendirmek için en az 3 karakterlik bir detay yazın.");
        }

        var profile = await db.UserProfiles
            .SingleOrDefaultAsync(
                candidate => candidate.UserId == request.UserId,
                cancellationToken);
        if (profile is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Profil bulunamadı",
                detail: "Beden önerisi istemeden önce profilinizi kaydedin.");
        }

        var orders = await db.OrderHistoryItems
            .AsNoTracking()
            .Where(order => order.UserProfileId == profile.Id)
            .OrderByDescending(order => order.UpdatedAt)
            .ToListAsync(cancellationToken);

        var previousRecommendation = request.IsReconsideration
            ? await db.FitRecommendations
                .AsNoTracking()
                .Where(candidate =>
                    candidate.UserProfileId == profile.Id &&
                    candidate.ProductUrl == request.Product.Url.Trim())
                .OrderByDescending(candidate => candidate.CreatedAt)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        var result = await recommendationService.RecommendAsync(
            profile,
            orders,
            request,
            cancellationToken);
        if (previousRecommendation is not null &&
            result.Confidence > previousRecommendation.Confidence)
        {
            result = result with
            {
                Confidence = previousRecommendation.Confidence,
                FitNotes = result.FitNotes
                    .Prepend(
                        "Kullanıcı yeniden değerlendirme notu teknik kanıt puanını tek başına yükseltmez.")
                    .Take(5)
                    .ToArray()
            };
        }

        var now = DateTimeOffset.UtcNow;
        var recommendation = new FitRecommendation
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            ProductUrl = request.Product.Url.Trim(),
            Brand = Limit(request.Product.Brand.Trim(), 120),
            ProductName = Limit(request.Product.Name.Trim(), 240),
            RecommendedSize = Limit(result.RecommendedSize.Trim().ToUpperInvariant(), 30),
            Confidence = Math.Clamp(result.Confidence, 0, 100),
            Verdict = Limit(result.Verdict.Trim(), 240),
            Explanation = Limit(result.Explanation.Trim(), 1600),
            EvidenceSummary = Limit(result.EvidenceSummary.Trim(), 120),
            DataSource = Limit(result.DataSource, 40),
            ComparisonsJson = JsonSerializer.Serialize(result.Comparisons, JsonOptions),
            FitNotesJson = JsonSerializer.Serialize(result.FitNotes, JsonOptions),
            StyleJson = JsonSerializer.Serialize(result.Style, JsonOptions),
            CreatedAt = now
        };

        db.FitRecommendations.Add(recommendation);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(recommendation.ToResponse());
    }

    [HttpGet("latest")]
    [ProducesResponseType<FitRecommendationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FitRecommendationResponse>> GetLatest(
        [FromQuery] string userId,
        [FromQuery] string productUrl,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var recommendation = await db.FitRecommendations
            .AsNoTracking()
            .Where(candidate =>
                candidate.UserProfile.UserId == userId &&
                candidate.ProductUrl == productUrl)
            .OrderByDescending(candidate => candidate.CreatedAt)
            .FirstOrDefaultAsync(cancellationToken);

        return recommendation is null ? NotFound() : Ok(recommendation.ToResponse());
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }
}
