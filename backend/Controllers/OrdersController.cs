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
[Route("api/orders")]
[Authorize]
public sealed class OrdersController(
    FitMemoryDbContext db,
    ArchivedFitAssessmentService fitAssessmentService,
    ProductIdentityService productIdentityService) : ControllerBase
{
    [HttpGet]
    [ProducesResponseType<IReadOnlyList<OrderResponse>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<IReadOnlyList<OrderResponse>>> GetAll(
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var orders = await db.OrderHistoryItems
            .AsNoTracking()
            .Include(order => order.UserProfile)
            .Where(order => order.UserProfile.UserId == userId)
            .OrderByDescending(order => order.UpdatedAt)
            .ToListAsync(cancellationToken);

        return Ok(orders.Select(order => order.ToResponse()).ToArray());
    }

    [HttpPost]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> Create(
        SaveOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId))
        {
            return Forbid();
        }

        if (request.Outcome.IsReturned() &&
            !request.ReturnConfirmedByUser)
        {
            return InvalidReturnConfirmation();
        }

        var profile = await db.UserProfiles.SingleOrDefaultAsync(
            candidate => candidate.UserId == request.UserId,
            cancellationToken);
        if (profile is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Profil bulunamadı",
                detail: "Sipariş geçmişi eklenmeden önce beden profilini oluşturun.");
        }

        var now = DateTimeOffset.UtcNow;
        var order = new OrderHistoryItem
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            Brand = request.Brand.Trim(),
            ProductName = request.ProductName.Trim(),
            Category = request.Category.Trim(),
            PurchasedSize = request.PurchasedSize.Trim().ToUpperInvariant(),
            Outcome = request.Outcome,
            ReturnConfirmedByUser =
                request.Outcome.IsReturned() &&
                request.ReturnConfirmedByUser,
            FitNotes = NormalizeOptional(request.FitNotes),
            UserFitNotes = NormalizeOptional(request.UserFitNotes),
            ChestWidthCm = request.ChestWidthCm,
            ShoulderWidthCm = request.ShoulderWidthCm,
            WaistWidthCm = request.WaistWidthCm,
            LengthCm = request.LengthCm,
            SleeveLengthCm = request.SleeveLengthCm,
            InseamCm = request.InseamCm,
            ProductUrl = NormalizeOptional(request.ProductUrl),
            ImageUrl = NormalizeOptional(request.ImageUrl),
            ProductFamilyKey = productIdentityService.BuildFamilyKey(
                request.Brand,
                request.ProductName,
                request.ProductUrl),
            ResearchSourceUrl = NormalizeOptional(request.ResearchSourceUrl),
            FitLabel = NormalizeOptional(request.FitLabel),
            SizeEvidence = NormalizeOptional(request.SizeEvidence),
            ResearchConfidence = Math.Clamp(request.ResearchConfidence, 0, 95),
            CreatedAt = now,
            UpdatedAt = now
        };
        fitAssessmentService.Apply(profile, order);

        db.OrderHistoryItems.Add(order);
        await db.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetById), new { id = order.Id, userId = request.UserId }, order.ToResponse());
    }

    [HttpGet("{id:int}")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> GetById(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var order = await db.OrderHistoryItems
            .AsNoTracking()
            .Include(candidate => candidate.UserProfile)
            .SingleOrDefaultAsync(
                candidate => candidate.Id == id && candidate.UserProfile.UserId == userId,
                cancellationToken);

        return order is null ? NotFound() : Ok(order.ToResponse());
    }

    [HttpPut("{id:int}")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> Update(
        int id,
        SaveOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId))
        {
            return Forbid();
        }

        if (request.Outcome.IsReturned() &&
            !request.ReturnConfirmedByUser)
        {
            return InvalidReturnConfirmation();
        }

        var order = await db.OrderHistoryItems
            .Include(candidate => candidate.UserProfile)
            .SingleOrDefaultAsync(
                candidate => candidate.Id == id && candidate.UserProfile.UserId == request.UserId,
                cancellationToken);
        if (order is null)
        {
            return NotFound();
        }

        order.Brand = request.Brand.Trim();
        order.ProductName = request.ProductName.Trim();
        order.Category = request.Category.Trim();
        order.PurchasedSize = request.PurchasedSize.Trim().ToUpperInvariant();
        order.Outcome = request.Outcome;
        order.ReturnConfirmedByUser =
            request.Outcome.IsReturned() &&
            request.ReturnConfirmedByUser;
        order.FitNotes = NormalizeOptional(request.FitNotes);
        order.UserFitNotes = NormalizeOptional(request.UserFitNotes);
        order.ChestWidthCm = request.ChestWidthCm;
        order.ShoulderWidthCm = request.ShoulderWidthCm;
        order.WaistWidthCm = request.WaistWidthCm;
        order.LengthCm = request.LengthCm;
        order.SleeveLengthCm = request.SleeveLengthCm;
        order.InseamCm = request.InseamCm;
        order.ProductUrl = NormalizeOptional(request.ProductUrl);
        order.ImageUrl = NormalizeOptional(request.ImageUrl);
        order.ProductFamilyKey = productIdentityService.BuildFamilyKey(
            request.Brand,
            request.ProductName,
            request.ProductUrl);
        order.ResearchSourceUrl = NormalizeOptional(request.ResearchSourceUrl);
        order.FitLabel = NormalizeOptional(request.FitLabel);
        order.SizeEvidence = NormalizeOptional(request.SizeEvidence);
        order.ResearchConfidence = Math.Clamp(request.ResearchConfidence, 0, 95);
        order.UpdatedAt = DateTimeOffset.UtcNow;
        fitAssessmentService.Apply(order.UserProfile, order);

        await db.SaveChangesAsync(cancellationToken);
        return Ok(order.ToResponse());
    }

    [HttpPatch("{id:int}/feedback")]
    [ProducesResponseType<OrderResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<OrderResponse>> UpdateFeedback(
        int id,
        [FromQuery] string userId,
        UpdateOrderFeedbackRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var order = await db.OrderHistoryItems
            .Include(candidate => candidate.UserProfile)
            .SingleOrDefaultAsync(
                candidate =>
                    candidate.Id == id &&
                    candidate.UserProfile.UserId == userId,
                cancellationToken);
        if (order is null)
        {
            return NotFound();
        }

        if (request.Outcome.IsReturned() &&
            !request.ReturnConfirmedByUser)
        {
            return InvalidReturnConfirmation();
        }

        order.Outcome = request.Outcome;
        order.ReturnConfirmedByUser =
            request.Outcome.IsReturned() &&
            request.ReturnConfirmedByUser;
        order.UserFitNotes = NormalizeOptional(request.UserFitNotes);
        order.UpdatedAt = DateTimeOffset.UtcNow;
        fitAssessmentService.Apply(order.UserProfile, order);
        await db.SaveChangesAsync(cancellationToken);
        return Ok(order.ToResponse());
    }

    [HttpDelete("{id:int}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var order = await db.OrderHistoryItems
            .SingleOrDefaultAsync(
                candidate => candidate.Id == id && candidate.UserProfile.UserId == userId,
                cancellationToken);
        if (order is null)
        {
            return NotFound();
        }

        db.OrderHistoryItems.Remove(order);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static string? NormalizeOptional(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private ActionResult InvalidReturnConfirmation()
    {
        return Problem(
            statusCode: StatusCodes.Status400BadRequest,
            title: "İade kullanıcı tarafından doğrulanmadı",
            detail:
                "Bir ürün yalnızca kullanıcı açıkça “İade ettim” eylemini seçtiğinde dolaptan çıkarılabilir.");
    }
}
