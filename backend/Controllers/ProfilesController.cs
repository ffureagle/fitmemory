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
            profile.FootLengthCm = request.FootLengthCm;
            profile.UsualShoeSizeEu = request.UsualShoeSizeEu;
            profile.FitPreference = request.FitPreference;
            profile.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return Ok(profile.ToResponse());
    }
}
