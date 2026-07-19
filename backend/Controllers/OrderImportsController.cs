using System.Net;
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
[Route("api/order-imports")]
[Authorize]
public sealed class OrderImportsController(
    FitMemoryDbContext db,
    AiOrderImportService aiImportService,
    ArchivedFitAssessmentService fitAssessmentService,
    ProductIdentityService productIdentityService,
    ILogger<OrderImportsController> logger) : ControllerBase
{
    [HttpPost("analyze")]
    [ProducesResponseType<OrderImportResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<OrderImportResponse>> Analyze(
        AnalyzeOrderHistoryRequest request,
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
                detail: "Sipariş geçmişini taramadan önce profilinizi kaydedin.");
        }

        OrderImportAnalysis analysis;
        try
        {
            analysis = await aiImportService.AnalyzeAsync(request, cancellationToken);
        }
        catch (AiProviderException exception)
        {
            var isLimit = exception.StatusCode == HttpStatusCode.TooManyRequests;
            var isInvalidRequest =
                exception.StatusCode == HttpStatusCode.BadRequest ||
                exception.ApiCode.Equals(
                    "INVALID_ARGUMENT",
                    StringComparison.OrdinalIgnoreCase);
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: isLimit
                    ? $"{exception.Provider} kullanım sınırına ulaştı"
                    : isInvalidRequest
                        ? $"{exception.Provider} tarama isteğini geçersiz buldu"
                        : $"{exception.Provider} araştırma servisi isteği reddetti",
                detail: BuildProviderErrorDetail(
                    exception,
                    isLimit,
                    isInvalidRequest));
        }
        catch (InvalidOperationException exception)
        {
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "AI araştırma servisi hazır değil",
                detail: exception.Message);
        }
        catch (JsonException)
        {
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Gemini araştırma çıktısı okunamadı",
                detail:
                    "Gemini ürün araştırmasını eksik veya beklenmeyen biçimde döndürdü. " +
                    "Tarama verileri kaydedilmedi; sayfayı yenileyip yeniden deneyin.");
        }
        catch (TaskCanceledException)
            when (!cancellationToken.IsCancellationRequested)
        {
            return Problem(
                statusCode: StatusCodes.Status504GatewayTimeout,
                title: "Gemini araştırması zaman aşımına uğradı",
                detail:
                    "Resmi ürün sayfaları veya AI yanıtı zamanında tamamlanamadı. " +
                    "Hiçbir arşiv verisi değiştirilmedi; daha az sipariş kartını görünür tutup yeniden deneyin.");
        }
        catch (HttpRequestException exception)
        {
            logger.LogWarning(
                exception,
                "Order scan could not reach the configured AI provider.");
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Gemini araştırma servisine ulaşılamadı",
                detail:
                    "Ağ bağlantısı veya sağlayıcı geçici olarak yanıt vermedi. " +
                    "Hiçbir arşiv verisi değiştirilmedi; kısa süre sonra yeniden deneyin.");
        }

        var stage = "mevcut arşivi okuma";
        try
        {
        var existing = await db.OrderHistoryItems
            .Where(order => order.UserProfileId == profile.Id)
            .ToListAsync(cancellationToken);
        var existingByKey = existing
            .GroupBy(
                order => BuildKey(
                    order.Brand,
                    order.ProductName,
                    order.PurchasedSize),
                StringComparer.Ordinal)
            .ToDictionary(
                group => group.Key,
                group => group.First(),
                StringComparer.Ordinal);
        var responseItems = new List<ImportedOrderItemResponse>();
        var now = DateTimeOffset.UtcNow;

        foreach (var item in analysis.Items.Where(item => item.IsApparel))
        {
            stage = "ürünleri fotoğraf ve resmi kaynakla eşleştirme";
            if (string.IsNullOrWhiteSpace(item.Brand) ||
                string.IsNullOrWhiteSpace(item.ProductName) ||
                string.IsNullOrWhiteSpace(item.PurchasedSize))
            {
                responseItems.Add(ToResponseItem(
                    item,
                    false,
                    false,
                    "Marka, ürün adı veya satın alınan beden kanıtı eksik olduğu için eklenmedi."));
                continue;
            }

            var imageUrl = ResolveProductImage(item, request);
            var key = BuildKey(item.Brand, item.ProductName, item.PurchasedSize);
            if (existingByKey.TryGetValue(key, out var existingOrder))
            {
                var updated = EnrichExistingOrder(
                    existingOrder,
                    item,
                    profile,
                    now,
                    fitAssessmentService,
                    productIdentityService,
                    imageUrl);
                responseItems.Add(ToResponseItem(
                    item,
                    false,
                    updated,
                    updated
                        ? "Mevcut arşiv kaydı yeni resmi kaynak ve kalıp bilgileriyle güncellendi."
                        : "Bu ürün ve beden arşivde zaten var; daha güçlü yeni kanıt bulunamadı."));
                continue;
            }

            var keepMeasurements =
                item.OfficialSourceVerified &&
                item.ResearchConfidence >= 65 &&
                !string.IsNullOrWhiteSpace(item.SizeEvidence) &&
                !string.IsNullOrWhiteSpace(item.ResearchSourceUrl);
            var note = BuildFitNote(item, keepMeasurements);
            var order = new OrderHistoryItem
            {
                UserProfileId = profile.Id,
                UserProfile = profile,
                Brand = item.Brand,
                ProductName = item.ProductName,
                Category = item.Category,
                PurchasedSize = item.PurchasedSize,
                Outcome = OrderOutcome.PurchasedUnknownFit,
                ReturnConfirmedByUser = false,
                FitNotes = note,
                ChestWidthCm = keepMeasurements ? item.ChestWidthCm : null,
                ShoulderWidthCm = keepMeasurements ? item.ShoulderWidthCm : null,
                WaistWidthCm = keepMeasurements ? item.WaistWidthCm : null,
                LengthCm = keepMeasurements ? item.LengthCm : null,
                SleeveLengthCm = keepMeasurements ? item.SleeveLengthCm : null,
                InseamCm = keepMeasurements ? item.InseamCm : null,
                ProductUrl = NormalizeUrl(item.ProductUrl),
                ImageUrl = imageUrl,
                ProductFamilyKey = productIdentityService.BuildFamilyKey(
                    item.Brand,
                    item.ProductName,
                    item.ProductUrl),
                ResearchSourceUrl = item.OfficialSourceVerified
                    ? NormalizeUrl(item.ResearchSourceUrl)
                    : null,
                FitLabel = NormalizeOptional(item.FitLabel, 80),
                SizeEvidence = keepMeasurements
                    ? NormalizeOptional(item.SizeEvidence, 500)
                    : null,
                ResearchConfidence = item.ResearchConfidence,
                CreatedAt = now,
                UpdatedAt = now
            };
            fitAssessmentService.Apply(profile, order);
            db.OrderHistoryItems.Add(order);
            existing.Add(order);
            existingByKey[key] = order;
            responseItems.Add(ToResponseItem(
                item,
                true,
                false,
                keepMeasurements
                    ? "Ürün ve doğrulanmış ölçüler arşive eklendi."
                    : "Ürün arşive eklendi; yeterince güvenilir ölçü bulunamadı."));
        }

        stage = "arşiv değişikliklerini SQLite'a kaydetme";
        await db.SaveChangesAsync(cancellationToken);
        stage = "güncellenmiş arşiv kartlarını hazırlama";
        var allOrders = await db.OrderHistoryItems
            .AsNoTracking()
            .Include(order => order.UserProfile)
            .Where(order => order.UserProfileId == profile.Id)
            .OrderByDescending(order => order.UpdatedAt)
            .ToListAsync(cancellationToken);
        var importedCount = responseItems.Count(item => item.Added);
        var updatedCount = responseItems.Count(item => item.Updated);
        var skippedCount = responseItems.Count - importedCount - updatedCount;

        return Ok(new OrderImportResponse(
            analysis.Items.Count,
            importedCount,
            updatedCount,
            skippedCount,
            string.IsNullOrWhiteSpace(analysis.Summary)
                ? $"{importedCount} ürün arşive eklendi."
                : analysis.Summary,
            analysis.DataSource,
            responseItems,
            allOrders.Select(order => order.ToResponse()).ToArray()));
        }
        catch (DbUpdateException exception)
        {
            logger.LogError(
                exception,
                "Order scan failed while saving archive changes at stage {Stage}.",
                stage);
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Arşiv güncellenemedi",
                detail:
                    $"Tarama {stage} aşamasında durdu ve değişiklikler kaydedilmedi. " +
                    $"Takip kodu: {HttpContext.TraceIdentifier}");
        }
        catch (Exception exception)
            when (exception is not OperationCanceledException)
        {
            logger.LogError(
                exception,
                "Order scan failed at stage {Stage}.",
                stage);
            return Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "Sipariş taraması tamamlanamadı",
                detail:
                    $"Tarama {stage} aşamasında durdu. " +
                    $"Takip kodu: {HttpContext.TraceIdentifier}");
        }
    }

    private static ImportedOrderItemResponse ToResponseItem(
        ResearchedOrder item,
        bool added,
        bool updated,
        string note)
    {
        return new ImportedOrderItemResponse(
            item.Brand,
            item.ProductName,
            item.PurchasedSize,
            item.Outcome,
            item.ResearchConfidence,
            item.ResearchSourceUrl,
            added,
            updated,
            note);
    }

    private static bool EnrichExistingOrder(
        OrderHistoryItem order,
        ResearchedOrder item,
        UserProfile profile,
        DateTimeOffset now,
        ArchivedFitAssessmentService fitAssessmentService,
        ProductIdentityService productIdentityService,
        string? imageUrl)
    {
        var keepMeasurements =
            item.OfficialSourceVerified &&
            item.ResearchConfidence >= 65 &&
            !string.IsNullOrWhiteSpace(item.SizeEvidence) &&
            !string.IsNullOrWhiteSpace(item.ResearchSourceUrl);
        var hasNewEvidence =
            item.ResearchConfidence > order.ResearchConfidence ||
            (string.IsNullOrWhiteSpace(order.FitLabel) &&
             !string.IsNullOrWhiteSpace(item.FitLabel)) ||
            (!string.IsNullOrWhiteSpace(imageUrl) &&
             !imageUrl.Equals(
                 order.ImageUrl,
                 StringComparison.OrdinalIgnoreCase)) ||
            (string.IsNullOrWhiteSpace(order.ResearchSourceUrl) &&
             item.OfficialSourceVerified);
        if (!hasNewEvidence)
        {
            return false;
        }

        order.ProductUrl = NormalizeUrl(item.ProductUrl) ?? order.ProductUrl;
        order.ImageUrl = imageUrl ?? order.ImageUrl;
        order.ProductFamilyKey = productIdentityService.BuildFamilyKey(
            item.Brand,
            item.ProductName,
            order.ProductUrl);
        order.FitLabel =
            NormalizeOptional(item.FitLabel, 80) ?? order.FitLabel;
        order.ResearchConfidence = Math.Max(
            order.ResearchConfidence,
            item.ResearchConfidence);
        if (item.OfficialSourceVerified)
        {
            order.ResearchSourceUrl =
                NormalizeUrl(item.ResearchSourceUrl) ??
                order.ResearchSourceUrl;
        }
        if (keepMeasurements)
        {
            order.SizeEvidence =
                NormalizeOptional(item.SizeEvidence, 500) ??
                order.SizeEvidence;
            order.ChestWidthCm = item.ChestWidthCm ?? order.ChestWidthCm;
            order.ShoulderWidthCm =
                item.ShoulderWidthCm ?? order.ShoulderWidthCm;
            order.WaistWidthCm =
                item.WaistWidthCm ?? order.WaistWidthCm;
            order.LengthCm = item.LengthCm ?? order.LengthCm;
            order.SleeveLengthCm =
                item.SleeveLengthCm ?? order.SleeveLengthCm;
            order.InseamCm = item.InseamCm ?? order.InseamCm;
        }

        order.FitNotes = BuildFitNote(item, keepMeasurements);
        order.UpdatedAt = now;
        fitAssessmentService.Apply(profile, order);
        return true;
    }

    private static string? ResolveProductImage(
        ResearchedOrder item,
        AnalyzeOrderHistoryRequest request)
    {
        var officialProduct = request.ProductPageResearch.FirstOrDefault(
            research =>
                SameProductPage(research.Product.Url, item.ProductUrl) ||
                ProductNamesMatch(
                    research.Product.Name,
                    item.ProductName));
        var officialImage = NormalizeImageUrl(
            officialProduct?.Product.ImageUrl);
        if (officialImage is not null)
        {
            return officialImage;
        }

        var imageCandidates = request.OrderCards
            .SelectMany(card => card.Images)
            .ToArray();
        var linkedImage = imageCandidates.FirstOrDefault(image =>
            SameProductPage(image.ProductUrl, item.ProductUrl));
        var linkedImageUrl = NormalizeImageUrl(linkedImage?.Url);
        if (linkedImageUrl is not null)
        {
            return linkedImageUrl;
        }

        var namedImage = imageCandidates.FirstOrDefault(image =>
            ProductNamesMatch(image.Alt, item.ProductName));
        var namedImageUrl = NormalizeImageUrl(namedImage?.Url);
        if (namedImageUrl is not null)
        {
            return namedImageUrl;
        }

        var exactCard = request.OrderCards.FirstOrDefault(card =>
            card.ProductLinks.Any(link =>
                SameProductPage(link, item.ProductUrl)));
        var exactCardImage = NormalizeImageUrl(exactCard?.ImageUrl);
        if (exactCardImage is not null)
        {
            return exactCardImage;
        }

        var altCard = request.OrderCards.FirstOrDefault(card =>
            ProductNamesMatch(card.ImageAlt, item.ProductName));
        var altCardImage = NormalizeImageUrl(altCard?.ImageUrl);
        if (altCardImage is not null)
        {
            return altCardImage;
        }

        var singleImageCard = request.OrderCards.FirstOrDefault(card =>
            ProductNamesMatch(card.Text, item.ProductName) &&
            card.Images.Count == 1);
        return NormalizeImageUrl(
            singleImageCard?.Images[0].Url ??
            singleImageCard?.ImageUrl);
    }

    private static bool SameProductPage(string? left, string? right)
    {
        return Uri.TryCreate(left, UriKind.Absolute, out var leftUri) &&
               Uri.TryCreate(right, UriKind.Absolute, out var rightUri) &&
               leftUri.Host.Equals(
                   rightUri.Host,
                   StringComparison.OrdinalIgnoreCase) &&
               leftUri.AbsolutePath.TrimEnd('/').Equals(
                   rightUri.AbsolutePath.TrimEnd('/'),
                   StringComparison.OrdinalIgnoreCase);
    }

    private static bool ProductNamesMatch(string? left, string? right)
    {
        var leftKey = NormalizeSearchKey(left);
        var rightKey = NormalizeSearchKey(right);
        return leftKey.Length >= 8 &&
               rightKey.Length >= 8 &&
               (leftKey.Contains(rightKey, StringComparison.Ordinal) ||
                rightKey.Contains(leftKey, StringComparison.Ordinal));
    }

    private static string NormalizeSearchKey(string? value)
    {
        return string.Concat(
            (value ?? "")
                .ToUpperInvariant()
                .Where(char.IsLetterOrDigit));
    }

    private static string? NormalizeImageUrl(string? value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               uri.Scheme is "http" or "https"
            ? uri.AbsoluteUri[..Math.Min(uri.AbsoluteUri.Length, 2_000)]
            : null;
    }

    private static string? BuildFitNote(ResearchedOrder item, bool keepMeasurements)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(item.Evidence))
        {
            parts.Add(item.Evidence);
        }
        if (keepMeasurements)
        {
            parts.Add($"ölçü kaynağı: {item.ResearchSourceUrl}");
        }

        var value = string.Join(" · ", parts);
        return value.Length switch
        {
            0 => null,
            <= 500 => value,
            _ => value[..500]
        };
    }

    private static string? NormalizeUrl(string value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               uri.Scheme is "http" or "https"
            ? uri.AbsoluteUri[..Math.Min(uri.AbsoluteUri.Length, 1_000)]
            : null;
    }

    private static string? NormalizeOptional(string value, int maxLength)
    {
        var normalized = value.Trim();
        return normalized.Length == 0
            ? null
            : normalized[..Math.Min(normalized.Length, maxLength)];
    }

    private static string BuildKey(string brand, string productName, string size)
    {
        static string Normalize(string value)
        {
            return string.Concat(value
                .Trim()
                .ToUpperInvariant()
                .Where(char.IsLetterOrDigit));
        }

        return $"{Normalize(brand)}|{Normalize(productName)}|{Normalize(size)}";
    }

    private static string BuildProviderErrorDetail(
        AiProviderException exception,
        bool isLimit,
        bool isInvalidRequest)
    {
        var code = string.IsNullOrWhiteSpace(exception.ApiCode)
            ? ""
            : $" ({exception.ApiCode})";
        var guidance = isLimit
            ? "Sağlayıcı panelindeki dakika ve günlük kullanım sınırlarını kontrol edin."
            : isInvalidRequest
                ? "Gönderilen tarama verisi Gemini tarafından kabul edilmedi."
                : "API anahtarını, model erişimini ve sağlayıcı panelini kontrol edin.";
        var message = exception.ApiMessage.Trim();
        if (message.Length > 500)
        {
            message = message[..500];
        }

        return $"{exception.Provider}{code}: {message} {guidance}";
    }
}
