using FitMemory.Api.Contracts;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FitMemory.Api.Controllers;

[ApiController]
[Route("api/profiles")]
[Authorize]
public sealed class ProfilesController(FitMemoryDbContext db) : ControllerBase
{
    [HttpGet("{userId}")]
    [ProducesResponseType<ProfileResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProfileResponse>> Get(
        string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var profile = await db.UserProfiles
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate => candidate.UserId == userId,
                cancellationToken);

        return profile is null ? NotFound() : Ok(profile.ToResponse());
    }

    [HttpGet("{userId}/progress")]
    [ProducesResponseType<FitProgressResponse>(StatusCodes.Status200OK)]
    public async Task<ActionResult<FitProgressResponse>> GetProgress(
        string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var profileId = await db.UserProfiles
            .Where(profile => profile.UserId == userId)
            .Select(profile => (int?)profile.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (!profileId.HasValue)
        {
            return Ok(new FitProgressResponse(
                0, 0, 0, 0,
                "İlk doğru beden kararın burada başlayacak.",
                "Ürün sayfasını tara; kararların biriktikçe kişisel kalıp hafızan güçlenir."));
        }

        var analyzedProducts = await db.FitRecommendations
            .Where(item => item.UserProfileId == profileId.Value)
            .Select(item => item.ProductUrl)
            .Distinct()
            .CountAsync(cancellationToken);
        var wardrobePieces = await db.OrderHistoryItems
            .CountAsync(item =>
                item.UserProfileId == profileId.Value &&
                !item.ReturnConfirmedByUser,
                cancellationToken);
        var personalFitSignals = await db.OrderHistoryItems
            .CountAsync(item =>
                item.UserProfileId == profileId.Value &&
                item.Outcome != OrderOutcome.PurchasedUnknownFit,
                cancellationToken);
        var confidentDecisions = await db.FitRecommendations
            .Where(item =>
                item.UserProfileId == profileId.Value &&
                item.Confidence >= 55)
            .Select(item => item.ProductUrl)
            .Distinct()
            .CountAsync(cancellationToken);
        var estimatedAvoidedReturns = (int)Math.Floor(confidentDecisions * 0.2m);

        return Ok(new FitProgressResponse(
            analyzedProducts,
            wardrobePieces,
            personalFitSignals,
            estimatedAvoidedReturns,
            analyzedProducts == 0
                ? "İlk doğru beden kararın burada başlayacak."
                : $"{analyzedProducts} ürün kararını FitMemory ile netleştirdin.",
            estimatedAvoidedReturns > 0
                ? $"Kişisel uyum kanıtlarına göre yaklaşık {estimatedAvoidedReturns} gereksiz iade süreci yaşamama potansiyeli oluşturdun. Bu bir tahmindir."
                : $"{personalFitSignals} kişisel uyum sinyali, sıradaki öneriyi daha isabetli hale getiriyor."));
    }

    [HttpPut("{userId}")]
    [ProducesResponseType<ProfileResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProfileResponse>> Upsert(
        string userId,
        UpsertProfileRequest request,
        CancellationToken cancellationToken)
    {
        var normalizedUserId = userId.Trim();
        if (!User.Owns(normalizedUserId))
        {
            return Forbid();
        }
        if (normalizedUserId.Length is < 8 or > 128)
        {
            ModelState.AddModelError(nameof(userId), "Kullanıcı kimliği 8 ile 128 karakter arasında olmalıdır.");
            return ValidationProblem(ModelState);
        }

        var profile = await db.UserProfiles.SingleOrDefaultAsync(
            candidate => candidate.UserId == normalizedUserId,
            cancellationToken);
        var now = DateTimeOffset.UtcNow;

        if (profile is null)
        {
            profile = new UserProfile
            {
                UserAccountId = User.GetFitMemoryAccountId(),
                UserId = normalizedUserId,
                Age = request.Age,
                HeightCm = request.HeightCm,
                WeightKg = request.WeightKg,
                ShoulderWidthCm = request.ShoulderWidthCm,
                ChestCircumferenceCm = request.ChestCircumferenceCm,
                WaistCircumferenceCm = request.WaistCircumferenceCm,
                HipCircumferenceCm = request.HipCircumferenceCm,
                FrontWaistCm = request.FrontWaistCm,
                InseamCm = request.InseamCm,
                BackWaistCm = request.BackWaistCm,
                FootLengthCm = request.FootLengthCm,
                UsualShoeSizeEu = request.UsualShoeSizeEu,
                FitPreference = request.FitPreference,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.UserProfiles.Add(profile);
        }
        else
        {
            profile.Age = request.Age;
            profile.HeightCm = request.HeightCm;
            profile.WeightKg = request.WeightKg;
            profile.ShoulderWidthCm = request.ShoulderWidthCm;
            profile.ChestCircumferenceCm = request.ChestCircumferenceCm;
            profile.WaistCircumferenceCm = request.WaistCircumferenceCm;
            profile.HipCircumferenceCm = request.HipCircumferenceCm;
            profile.FrontWaistCm = request.FrontWaistCm;
            profile.InseamCm = request.InseamCm;
            profile.BackWaistCm = request.BackWaistCm;
            profile.FootLengthCm = request.FootLengthCm;
            profile.UsualShoeSizeEu = request.UsualShoeSizeEu;
            profile.FitPreference = request.FitPreference;
            profile.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Ok(profile.ToResponse());
    }
}
