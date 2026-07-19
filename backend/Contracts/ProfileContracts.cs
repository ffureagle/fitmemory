using System.ComponentModel.DataAnnotations;
using FitMemory.Api.Models;

namespace FitMemory.Api.Contracts;

public sealed class UpsertProfileRequest
{
    [Range(13, 100)]
    public int Age { get; init; }

    [Range(100, 250)]
    public decimal HeightCm { get; init; }

    [Range(30, 300)]
    public decimal WeightKg { get; init; }

    [Range(25, 80)]
    public decimal ShoulderWidthCm { get; init; }

    [Range(60, 180)]
    public decimal? ChestCircumferenceCm { get; init; }

    [Range(45, 220)]
    public decimal WaistCircumferenceCm { get; init; }

    [Range(15, 40)]
    public decimal? FootLengthCm { get; init; }

    [Range(20, 55)]
    public decimal? UsualShoeSizeEu { get; init; }

    [EnumDataType(typeof(FitPreference))]
    public FitPreference FitPreference { get; init; }
}

public sealed record ProfileResponse(
    string UserId,
    int? Age,
    decimal HeightCm,
    decimal WeightKg,
    decimal ShoulderWidthCm,
    decimal? ChestCircumferenceCm,
    decimal WaistCircumferenceCm,
    decimal? FootLengthCm,
    decimal? UsualShoeSizeEu,
    FitPreference FitPreference,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
