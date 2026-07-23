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
[Route("api/style-board")]
[Authorize]
public sealed class StyleBoardController(
    FitMemoryDbContext db,
    StyleBoardAnalysisService analysisService,
    ProductCategoryService categoryService) : ControllerBase
{
    private const int MaxItems = 12;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<StyleBoardItemResponse>>> GetAll(
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var items = await db.StyleBoardItems
            .AsNoTracking()
            .Include(item => item.UserProfile)
            .Where(item => item.UserProfile.UserId == userId)
            .OrderByDescending(item => item.UpdatedAt)
            .ToListAsync(cancellationToken);
        return Ok(items.Select(item => item.ToResponse()).ToArray());
    }

    [HttpPost("items")]
    public async Task<ActionResult<StyleBoardItemResponse>> Save(
        SaveStyleBoardItemRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId))
        {
            return Forbid();
        }

        var profile = await db.UserProfiles.SingleOrDefaultAsync(
            candidate => candidate.UserId == request.UserId,
            cancellationToken);
        if (profile is null)
        {
            return Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Profil bulunamadı",
                detail: "Kombin Stüdyosu'na parça eklemeden önce profilini kaydet.");
        }

        var url = request.Product.Url.Trim();
        var profileItems = await db.StyleBoardItems
            .Include(item => item.UserProfile)
            .Where(item => item.UserProfileId == profile.Id)
            .ToListAsync(cancellationToken);
        var existing = profileItems.SingleOrDefault(
            item => item.ProductUrl == url);
        if (existing is null &&
            profileItems.Count >= MaxItems)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Stüdyo dolu",
                detail: $"Bir kombinde en fazla {MaxItems} aday parça tutulabilir. Önce kullanmayacağın bir parçayı çıkar.");
        }

        var now = DateTimeOffset.UtcNow;
        var item = existing ?? new StyleBoardItem
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            ProductUrl = url,
            Brand = "",
            ProductName = "",
            Category = "",
            IsSelected = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        item.Brand = Clean(request.Product.Brand, 120);
        item.ProductName = Clean(request.Product.Name, 240, "Adsız ürün");
        item.Category = Clean(request.Product.Category, 120, "Diğer");
        item.Price = Clean(request.Product.Price, 80);
        item.ImageUrl = Clean(request.Product.ImageUrl, 2000);
        item.ProductReference = Clean(request.Product.ProductReference, 120);
        item.FitLabel = Clean(request.Product.FitLabel, 80);
        item.FitEvidence = Clean(request.Product.FitEvidence, 300);
        item.Description = Clean(request.Product.Description, 1200);
        item.RecommendedSize = Clean(
            request.RecommendedSize.ToUpperInvariant(),
            30);
        item.RecommendationConfidence = Math.Clamp(
            request.RecommendationConfidence,
            0,
            95);
        item.UpdatedAt = now;
        if (existing is null)
        {
            db.StyleBoardItems.Add(item);
        }
        await db.SaveChangesAsync(cancellationToken);
        return existing is null
            ? Created($"/api/style-board/items/{item.Id}", item.ToResponse())
            : Ok(item.ToResponse());
    }

    [HttpDelete("items/{id:int}")]
    public async Task<IActionResult> Delete(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var item = await db.StyleBoardItems
            .Include(candidate => candidate.UserProfile)
            .SingleOrDefaultAsync(
                candidate =>
                    candidate.Id == id &&
                    candidate.UserProfile.UserId == userId,
                cancellationToken);
        if (item is null)
        {
            return NotFound();
        }
        var deletedSlot = GetSlot(item);
        var replacement = item.IsSelected
            ? await db.StyleBoardItems
                .Where(candidate =>
                    candidate.UserProfileId == item.UserProfileId &&
                    candidate.Id != item.Id)
                .OrderByDescending(candidate => candidate.UpdatedAt)
                .ToListAsync(cancellationToken)
            : [];
        db.StyleBoardItems.Remove(item);
        var selectedReplacement = replacement.FirstOrDefault(candidate =>
            GetSlot(candidate) == deletedSlot);
        if (selectedReplacement is not null)
        {
            selectedReplacement.IsSelected = true;
        }
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPatch("items/{id:int}/select")]
    public async Task<ActionResult<StyleBoardItemResponse>> Select(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var items = await db.StyleBoardItems
            .Include(item => item.UserProfile)
            .Where(item => item.UserProfile.UserId == userId)
            .ToListAsync(cancellationToken);
        var selected = items.SingleOrDefault(item => item.Id == id);
        if (selected is null)
        {
            return NotFound();
        }

        var slot = GetSlot(selected);
        foreach (var item in items.Where(item =>
                     GetSlot(item) == slot))
        {
            item.IsSelected = item.Id == selected.Id;
        }
        selected.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return Ok(selected.ToResponse());
    }

    [HttpDelete]
    public async Task<IActionResult> Clear(
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId))
        {
            return Forbid();
        }

        var items = await db.StyleBoardItems
            .Where(item => item.UserProfile.UserId == userId)
            .ToListAsync(cancellationToken);
        db.StyleBoardItems.RemoveRange(items);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("analyze")]
    public async Task<ActionResult<StyleBoardAnalysisResponse>> Analyze(
        AnalyzeStyleBoardRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId))
        {
            return Forbid();
        }

        var profile = await db.UserProfiles
            .AsNoTracking()
            .SingleOrDefaultAsync(
                candidate => candidate.UserId == request.UserId,
                cancellationToken);
        if (profile is null)
        {
            return NotFound();
        }
        var items = await db.StyleBoardItems
            .AsNoTracking()
            .Where(item => item.UserProfileId == profile.Id)
            .OrderBy(item => item.CreatedAt)
            .ToListAsync(cancellationToken);
        var selectedItems = items
            .Where(item => item.IsSelected)
            .GroupBy(GetSlot)
            .Select(group => group
                .OrderByDescending(item => item.UpdatedAt)
                .First())
            .ToArray();
        if (selectedItems.Length < 2)
        {
            return Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "En az iki parça gerekli",
                detail: "AI'ın bir ilişki değerlendirebilmesi için farklı kategorilerden en az iki aktif parça seç.");
        }
        return Ok(await analysisService.AnalyzeAsync(
            profile,
            selectedItems,
            request.Language,
            cancellationToken));
    }

    private string GetSlot(StyleBoardItem item)
    {
        return GetSlot(new ProductDto
        {
            Url = item.ProductUrl,
            Brand = item.Brand,
            Name = item.ProductName,
            Category = item.Category
        });
    }

    private string GetSlot(ProductDto product)
    {
        return categoryService.GetGroup(product) switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops => "upper",
            ProductCategoryGroup.Bottoms => "bottom",
            ProductCategoryGroup.Outerwear => "outerwear",
            ProductCategoryGroup.Footwear => "footwear",
            ProductCategoryGroup.Dresses => "one-piece",
            ProductCategoryGroup.Accessories => "accessory",
            _ => "other"
        };
    }

    private static string Clean(
        string? value,
        int maxLength,
        string fallback = "")
    {
        var cleaned = value?.Trim() ?? "";
        if (cleaned.Length == 0)
        {
            cleaned = fallback;
        }
        return cleaned.Length <= maxLength
            ? cleaned
            : cleaned[..maxLength];
    }
}
