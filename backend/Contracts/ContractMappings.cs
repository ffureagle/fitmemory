using System.Text.Json;
using FitMemory.Api.Models;

namespace FitMemory.Api.Contracts;

public static class ContractMappings
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static ProfileResponse ToResponse(this UserProfile profile)
    {
        return new ProfileResponse(
            profile.UserId,
            profile.Age,
            profile.HeightCm,
            profile.WeightKg,
            profile.ShoulderWidthCm,
            profile.ChestCircumferenceCm,
            profile.WaistCircumferenceCm,
            profile.FootLengthCm,
            profile.UsualShoeSizeEu,
            profile.FitPreference,
            profile.CreatedAt,
            profile.UpdatedAt);
    }

    public static StyleBoardItemResponse ToResponse(
        this StyleBoardItem item)
    {
        return new StyleBoardItemResponse(
            item.Id,
            item.UserProfile.UserId,
            item.ProductUrl,
            item.Brand,
            item.ProductName,
            item.Category,
            item.Price,
            item.ImageUrl,
            item.ProductReference,
            item.FitLabel,
            item.FitEvidence,
            item.Description,
            item.RecommendedSize,
            item.RecommendationConfidence,
            item.IsSelected,
            item.CreatedAt,
            item.UpdatedAt);
    }

    public static OrderResponse ToResponse(this OrderHistoryItem order)
    {
        return new OrderResponse(
            order.Id,
            order.UserProfile.UserId,
            order.Brand,
            order.ProductName,
            order.Category,
            order.PurchasedSize,
            order.Outcome,
            order.ReturnConfirmedByUser,
            order.FitNotes,
            order.UserFitNotes,
            order.ChestWidthCm,
            order.ShoulderWidthCm,
            order.WaistWidthCm,
            order.LengthCm,
            order.SleeveLengthCm,
            order.InseamCm,
            order.ProductUrl,
            order.ImageUrl,
            order.ProductFamilyKey,
            order.ResearchSourceUrl,
            order.FitLabel,
            order.SizeEvidence,
            order.ResearchConfidence,
            order.FitScore,
            order.FitAssessment,
            order.FitAssessmentConfidence,
            order.CreatedAt,
            order.UpdatedAt);
    }

    public static FitRecommendationResponse ToResponse(this FitRecommendation recommendation)
    {
        var comparisons = JsonSerializer.Deserialize<IReadOnlyList<ComparisonDto>>(
            recommendation.ComparisonsJson,
            JsonOptions) ?? [];
        var fitNotes = JsonSerializer.Deserialize<IReadOnlyList<string>>(
            recommendation.FitNotesJson,
            JsonOptions) ?? [];
        WardrobeStyleDto style;
        try
        {
            style = JsonSerializer.Deserialize<WardrobeStyleDto>(
                recommendation.StyleJson,
                JsonOptions) ?? WardrobeStyleDto.Empty;
        }
        catch (JsonException)
        {
            style = WardrobeStyleDto.Empty;
        }

        return new FitRecommendationResponse(
            recommendation.Id,
            recommendation.RecommendedSize,
            recommendation.Confidence,
            recommendation.Verdict,
            recommendation.Explanation,
            fitNotes,
            comparisons,
            recommendation.EvidenceSummary,
            recommendation.DataSource,
            style,
            recommendation.CreatedAt);
    }
}
