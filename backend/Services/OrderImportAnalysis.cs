using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed record OrderImportAnalysis(
    IReadOnlyList<ResearchedOrder> Items,
    string Summary,
    string DataSource);

public sealed record ResearchedOrder(
    bool IsApparel,
    string Brand,
    string ProductName,
    string Category,
    string PurchasedSize,
    OrderOutcome Outcome,
    string Evidence,
    decimal? ChestWidthCm,
    decimal? ShoulderWidthCm,
    decimal? WaistWidthCm,
    decimal? LengthCm,
    decimal? SleeveLengthCm,
    decimal? InseamCm,
    string ProductUrl,
    string ResearchSourceUrl,
    string FitLabel,
    string SizeEvidence,
    bool OfficialSourceVerified,
    int ResearchConfidence);
