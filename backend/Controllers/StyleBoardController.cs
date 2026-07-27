using FitMemory.Api.Contracts;
using FitMemory.Api.Data;
using FitMemory.Api.Models;
using FitMemory.Api.Security;
using FitMemory.Api.Services;
using System.Text.Json;
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
    ProductCategoryService categoryService,
    WardrobeStylistService wardrobeStylistService) : ControllerBase
{
    private const int MaxItems = 12;
    private const int MaxFavorites = 30;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

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
        if (request.SaveToStudio && existing is null &&
            profileItems.Count(item => item.IsInStudio) >= MaxItems)
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
            IsInStudio = false,
            IsSaved = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        item.Brand = Clean(request.Product.Brand, 120);
        item.ProductName = Clean(request.Product.Name, 240, "Adsız ürün");
        item.Category = categoryService.GetTurkishLabel(request.Product);
        item.Price = Clean(request.Product.Price, 80);
        item.ImageUrl = Clean(request.Product.ImageUrl, 2000);
        item.ProductReference = Clean(request.Product.ProductReference, 120);
        item.FitLabel = Clean(request.Product.FitLabel, 80);
        item.FitEvidence = Clean(request.Product.FitEvidence, 300);
        item.Description = Clean(request.Product.Description, 1200);
        item.MaterialSummary = Clean(request.Product.MaterialSummary, 240);
        item.MaterialEvidence = Clean(request.Product.MaterialEvidence, 1600);
        item.RecommendedSize = Clean(
            request.RecommendedSize.ToUpperInvariant(),
            30);
        item.RecommendationConfidence = Math.Clamp(
            request.RecommendationConfidence,
            0,
            95);
        item.IsInStudio |= request.SaveToStudio;
        item.IsSaved |= request.SaveToCloset;
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
                    candidate.Id != item.Id &&
                    candidate.IsInStudio)
                .OrderByDescending(candidate => candidate.UpdatedAt)
                .ToListAsync(cancellationToken)
            : [];
        if (item.IsSaved)
        {
            item.IsInStudio = false;
            item.IsSelected = false;
            item.UpdatedAt = DateTimeOffset.UtcNow;
        }
        else
        {
            db.StyleBoardItems.Remove(item);
        }
        var selectedReplacement = replacement.FirstOrDefault(candidate =>
            GetSlot(candidate) == deletedSlot);
        if (selectedReplacement is not null)
        {
            selectedReplacement.IsSelected = true;
        }
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpDelete("items/{id:int}/saved")]
    public async Task<IActionResult> DeleteSaved(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId)) return Forbid();
        var item = await db.StyleBoardItems
            .Include(candidate => candidate.UserProfile)
            .SingleOrDefaultAsync(candidate => candidate.Id == id && candidate.UserProfile.UserId == userId, cancellationToken);
        if (item is null) return NotFound();
        if (item.IsInStudio)
        {
            item.IsSaved = false;
            item.UpdatedAt = DateTimeOffset.UtcNow;
        }
        else
        {
            db.StyleBoardItems.Remove(item);
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
            .Where(item => item.UserProfile.UserId == userId && item.IsInStudio)
            .ToListAsync(cancellationToken);
        var selected = items.SingleOrDefault(item => item.Id == id);
        if (selected is null)
        {
            return NotFound();
        }

        var slot = GetSlot(selected);
        var shouldSelect = !selected.IsSelected;
        foreach (var item in items.Where(item =>
                     GetSlot(item) == slot))
        {
            item.IsSelected = shouldSelect && item.Id == selected.Id;
        }
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
            .Where(item => item.UserProfile.UserId == userId && item.IsInStudio)
            .ToListAsync(cancellationToken);
        foreach (var item in items)
        {
            if (item.IsSaved)
            {
                item.IsInStudio = false;
                item.IsSelected = false;
                item.UpdatedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                db.StyleBoardItems.Remove(item);
            }
        }
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
            .Where(item => item.UserProfileId == profile.Id && item.IsInStudio)
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
            "",
            cancellationToken));
    }

    [HttpGet("favorites")]
    public async Task<ActionResult<IReadOnlyList<FavoriteOutfitResponse>>> GetFavorites(
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId)) return Forbid();
        var favorites = await db.FavoriteOutfits
            .AsNoTracking()
            .Include(item => item.UserProfile)
            .Where(item => item.UserProfile.UserId == userId)
            .OrderByDescending(item => item.CreatedAt)
            .ToListAsync(cancellationToken);
        return Ok(favorites.Select(ToFavoriteResponse).ToArray());
    }

    [HttpPost("favorites")]
    public async Task<ActionResult<FavoriteOutfitResponse>> SaveFavorite(
        SaveFavoriteOutfitRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId)) return Forbid();
        var profile = await db.UserProfiles.SingleOrDefaultAsync(item => item.UserId == request.UserId, cancellationToken);
        if (profile is null) return NotFound();
        var count = await db.FavoriteOutfits.CountAsync(item => item.UserProfileId == profile.Id, cancellationToken);
        if (count >= MaxFavorites)
        {
            return Problem(statusCode: 409, title: "Favoriler dolu", detail: $"En fazla {MaxFavorites} favori kombin saklanabilir.");
        }
        var distinctIds = request.ItemIds.Distinct().ToArray();
        var items = await db.StyleBoardItems
            .Include(item => item.UserProfile)
            .Where(item => item.UserProfileId == profile.Id && distinctIds.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (items.Count < 2 || items.Count != distinctIds.Length)
        {
            return Problem(statusCode: 422, title: "Kombin bulunamadı", detail: "Favoriye eklemek için en az iki geçerli parça seç.");
        }
        var favorite = new FavoriteOutfit
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            Title = Clean(request.Title, 160, "Favori kombin"),
            AnalysisJson = JsonSerializer.Serialize(request.Analysis, JsonOptions),
            ItemsJson = JsonSerializer.Serialize(items.Select(item => item.ToResponse()).ToArray(), JsonOptions),
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.FavoriteOutfits.Add(favorite);
        await db.SaveChangesAsync(cancellationToken);
        return Created($"/api/style-board/favorites/{favorite.Id}", ToFavoriteResponse(favorite));
    }

    [HttpPost("favorites/wardrobe")]
    public async Task<ActionResult<FavoriteOutfitResponse>> SaveWardrobeFavorite(
        SaveWardrobeFavoriteRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId)) return Forbid();

        var profile = await db.UserProfiles.SingleOrDefaultAsync(
            item => item.UserId == request.UserId,
            cancellationToken);
        if (profile is null) return NotFound();

        var favoriteCount = await db.FavoriteOutfits.CountAsync(
            item => item.UserProfileId == profile.Id,
            cancellationToken);
        if (favoriteCount >= MaxFavorites)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Favoriler dolu",
                detail: $"En fazla {MaxFavorites} favori kombin saklanabilir.");
        }

        var orderIds = request.OrderIds.Distinct().ToArray();
        var orders = await db.OrderHistoryItems
            .AsNoTracking()
            .Where(item => item.UserProfileId == profile.Id &&
                           !item.ReturnConfirmedByUser &&
                           orderIds.Contains(item.Id))
            .ToListAsync(cancellationToken);
        if (orders.Count < 2 || orders.Count != orderIds.Length)
        {
            return Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Kombin kaydedilemedi",
                detail: "Kombin, dolabında bulunan en az iki geçerli parçadan oluşmalı.");
        }

        var items = orders.Select(order => new StyleBoardItemResponse(
            -order.Id,
            request.UserId,
            order.ProductUrl ?? order.ResearchSourceUrl ?? "",
            order.Brand,
            order.ProductName,
            categoryService.GetTurkishLabel(new ProductDto
            {
                Url = order.ProductUrl ?? "",
                Brand = order.Brand,
                Name = order.ProductName,
                Category = order.Category
            }),
            "",
            order.ImageUrl ?? "",
            order.ProductFamilyKey ?? "",
            order.FitLabel ?? "",
            order.SizeEvidence ?? "",
            order.FitAssessment ?? "",
            order.MaterialSummary ?? "",
            order.MaterialEvidence ?? "",
            order.PurchasedSize,
            Math.Clamp(order.FitAssessmentConfidence, 0, 95),
            false,
            false,
            false,
            order.CreatedAt,
            order.UpdatedAt)).ToArray();

        var favorite = new FavoriteOutfit
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            Title = $"Dolap · {Clean(request.Title, 152, "Favori kombin")}",
            AnalysisJson = JsonSerializer.Serialize(request.Analysis, JsonOptions),
            ItemsJson = JsonSerializer.Serialize(items, JsonOptions),
            CreatedAt = DateTimeOffset.UtcNow
        };
        db.FavoriteOutfits.Add(favorite);
        await db.SaveChangesAsync(cancellationToken);
        return Created($"/api/style-board/favorites/{favorite.Id}", ToFavoriteResponse(favorite));
    }

    [HttpDelete("favorites/{id:int}")]
    public async Task<IActionResult> DeleteFavorite(
        int id,
        [FromQuery] string userId,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(userId)) return Forbid();
        var favorite = await db.FavoriteOutfits
            .Include(item => item.UserProfile)
            .SingleOrDefaultAsync(item => item.Id == id && item.UserProfile.UserId == userId, cancellationToken);
        if (favorite is null) return NotFound();
        db.FavoriteOutfits.Remove(favorite);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    [HttpPost("wardrobe-outfit")]
    public async Task<ActionResult<WardrobeOutfitResponse>> WardrobeOutfit(
        WardrobeOutfitRequest request,
        CancellationToken cancellationToken)
    {
        if (!User.Owns(request.UserId)) return Forbid();
        var profile = await db.UserProfiles
            .AsNoTracking()
            .SingleOrDefaultAsync(candidate => candidate.UserId == request.UserId, cancellationToken);
        if (profile is null) return NotFound();
        var wardrobe = await db.OrderHistoryItems
            .AsNoTracking()
            .Where(item => item.UserProfileId == profile.Id && !item.ReturnConfirmedByUser)
            .OrderByDescending(item => item.FitScore)
            .ThenByDescending(item => item.UpdatedAt)
            .ToListAsync(cancellationToken);
        var chosen = wardrobeStylistService
            .SelectRequestedOutfit(profile, wardrobe, request.Prompt)
            .ToArray();
        if (chosen.Length < 2)
        {
            return Problem(statusCode: 422, title: "Dolapta yeterli parça yok", detail: "Kombin için en az iki farklı kategoride tutulmuş ürün gerekli.");
        }
        var now = DateTimeOffset.UtcNow;
        var items = chosen.Select(order => new StyleBoardItem
        {
            UserProfileId = profile.Id,
            UserProfile = profile,
            ProductUrl = order.ProductUrl ?? $"https://fitmemory.local/wardrobe/{order.Id}",
            Brand = order.Brand,
            ProductName = order.ProductName,
            Category = order.Category,
            ImageUrl = order.ImageUrl ?? "",
            FitLabel = order.FitLabel ?? "",
            FitEvidence = order.SizeEvidence ?? "",
            MaterialSummary = order.MaterialSummary ?? "",
            MaterialEvidence = order.MaterialEvidence ?? "",
            RecommendedSize = order.PurchasedSize,
            RecommendationConfidence = order.FitAssessmentConfidence,
            IsSelected = true,
            CreatedAt = now,
            UpdatedAt = now
        }).ToArray();
        var analysis = await analysisService.AnalyzeAsync(profile, items, request.Language, request.Prompt, cancellationToken);
        var strongVerdict = analysis.Verdict.Equals("Güçlü", StringComparison.OrdinalIgnoreCase) ||
                            analysis.Verdict.Equals("Strong", StringComparison.OrdinalIgnoreCase);
        if (analysis.Score < 72 || !strongVerdict)
        {
            return Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Bu istek için güçlü kombin bulunamadı",
                detail: "Dolabındaki parçalar bu kullanım ve mevsim isteğini yeterince iyi karşılamıyor. Daha uygun parçalar eklediğinde yeniden deneyebilirsin.");
        }
        return Ok(new WardrobeOutfitResponse(
            analysis,
            chosen.Select(order => new WardrobeOutfitPieceResponse(order.Id, order.Brand, order.ProductName, order.Category, order.PurchasedSize, order.ImageUrl)).ToArray()));
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

    private static FavoriteOutfitResponse ToFavoriteResponse(FavoriteOutfit favorite)
    {
        var analysis = JsonSerializer.Deserialize<StyleBoardAnalysisResponse>(favorite.AnalysisJson, JsonOptions)
            ?? throw new InvalidOperationException("Favori kombin analizi okunamadı.");
        var items = JsonSerializer.Deserialize<IReadOnlyList<StyleBoardItemResponse>>(favorite.ItemsJson, JsonOptions) ?? [];
        return new FavoriteOutfitResponse(favorite.Id, favorite.UserProfile.UserId, favorite.Title, analysis, items, favorite.CreatedAt);
    }
}
