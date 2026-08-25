using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed class ArchivedFitAssessmentService(
    RegionalFitFeedbackService regionalFeedback)
{
    public void Apply(UserProfile profile, OrderHistoryItem order)
    {
        if (order.Outcome != OrderOutcome.PurchasedUnknownFit)
        {
            ApplyUserFeedback(order, regionalFeedback);
            return;
        }

        var signals = new List<(double Score, double Weight, string Detail)>();
        AddShoulderSignal(profile, order, signals);
        AddWaistSignal(profile, order, signals);
        AddFitLabelSignal(profile, order, signals);

        if (signals.Count == 0)
        {
            order.FitScore = null;
            order.FitAssessmentConfidence = Math.Clamp(
                order.ResearchConfidence / 2,
                15,
                40);
            order.FitAssessment =
                "Kişisel uyumu hesaplamak için resmi ürün ölçüsü veya açık bir kalıp bilgisi bulunamadı.";
            return;
        }

        var weightedScore = signals.Sum(signal => signal.Score * signal.Weight) /
                            signals.Sum(signal => signal.Weight);
        order.FitScore = Math.Clamp((int)Math.Round(weightedScore), 10, 92);

        var measurementCount = signals.Count(signal =>
            signal.Detail.StartsWith("Omuz", StringComparison.Ordinal) ||
            signal.Detail.StartsWith("Bel", StringComparison.Ordinal));
        var hasFitLabel = !string.IsNullOrWhiteSpace(order.FitLabel);
        var confidence = 28 +
                         measurementCount * 17 +
                         (hasFitLabel ? 12 : 0) +
                         (!string.IsNullOrWhiteSpace(order.ResearchSourceUrl) ? 10 : 0);
        var researchCap = order.ResearchConfidence > 0
            ? Math.Clamp(order.ResearchConfidence + 4, 35, 84)
            : 45;
        order.FitAssessmentConfidence = Math.Clamp(
            Math.Min(confidence, researchCap),
            20,
            84);

        var fitDescription = order.FitScore.Value switch
        {
            >= 80 => "Profilin ve kalıp tercihinle oldukça uyumlu görünüyor.",
            >= 65 => "Profiline yakın görünüyor; küçük bir kalıp farkı olabilir.",
            >= 45 => "Uyum sınırda; bol veya dar hissetme ihtimali belirgin.",
            _ => "Profilin ve kalıp tercihinle uyuşmama riski yüksek."
        };
        var strongestSignals = string.Join(
            " ",
            signals
                .OrderByDescending(signal => signal.Weight)
                .Take(2)
                .Select(signal => signal.Detail));
        order.FitAssessment =
            $"Tahmin: {fitDescription} {strongestSignals}".Trim();
        AppendRegionalNote(order, regionalFeedback);
    }

    private static void AppendRegionalNote(
        OrderHistoryItem order,
        RegionalFitFeedbackService regionalFeedback)
    {
        var summary = regionalFeedback.Summarize(order.UserFitNotes);
        if (string.IsNullOrWhiteSpace(summary))
        {
            return;
        }

        order.FitAssessment =
            $"{order.FitAssessment} Kullanıcı notu: {summary}.";
        order.FitAssessmentConfidence = Math.Max(
            order.FitAssessmentConfidence,
            78);
    }

    private static void ApplyUserFeedback(
        OrderHistoryItem order,
        RegionalFitFeedbackService regionalFeedback)
    {
        (int? Score, string? Assessment, int Confidence) result =
            order.Outcome switch
            {
                OrderOutcome.KeptGoodFit => (
                    92,
                    "Sen bu bedeni iyi uyum olarak işaretledin; sonraki önerilerde güçlü kanıt olarak kullanılacak.",
                    92),
                OrderOutcome.KeptTooBaggy => (
                    25,
                    "Bu parça dolabında; bol geldiği bilgisi sonraki önerilerde üst uyum sınırı olacak.",
                    92),
                OrderOutcome.KeptTooTight => (
                    25,
                    "Bu parça dolabında; dar geldiği bilgisi sonraki önerilerde alt uyum sınırı olacak.",
                    92),
                OrderOutcome.ReturnedTooBaggy => (
                    25,
                    "Bu parçayı bol geldiği için iade ettiğini doğruladın; sonraki önerilerde üst uyum sınırı olacak.",
                    92),
                OrderOutcome.ReturnedTooTight => (
                    25,
                    "Bu parçayı dar geldiği için iade ettiğini doğruladın; sonraki önerilerde alt uyum sınırı olacak.",
                    92),
                _ => (null, null, 20)
            };
        var regionalSignals = regionalFeedback.Parse(order.UserFitNotes);
        var negativeSignalCount = regionalSignals.Count(signal =>
            signal.State is RegionalFitState.Tight or RegionalFitState.Loose);
        order.FitScore =
            order.Outcome == OrderOutcome.KeptGoodFit &&
            result.Score.HasValue
                ? Math.Clamp(
                    result.Score.Value - negativeSignalCount * 14,
                    45,
                    92)
                : result.Score;
        var regionalSummary = regionalFeedback.Summarize(order.UserFitNotes);
        order.FitAssessment = string.IsNullOrWhiteSpace(regionalSummary)
            ? result.Assessment
            : $"{result.Assessment} Bölgesel notun: {regionalSummary}.";
        order.FitAssessmentConfidence = result.Confidence;
    }

    private static void AddShoulderSignal(
        UserProfile profile,
        OrderHistoryItem order,
        ICollection<(double Score, double Weight, string Detail)> signals)
    {
        if (order.ShoulderWidthCm is null ||
            !IsUpperBody(order.Category))
        {
            return;
        }

        var orderWidth = order.ShoulderWidthCm.Value >= 70
            ? order.ShoulderWidthCm.Value / 2
            : order.ShoulderWidthCm.Value;
        var bodyWidth = profile.ShoulderWidthCm >= 70
            ? profile.ShoulderWidthCm / 2
            : profile.ShoulderWidthCm;
        var ease = (double)(orderWidth - bodyWidth);
        var target = profile.FitPreference switch
        {
            FitPreference.Slim => 0d,
            FitPreference.TrueToSize => 2d,
            FitPreference.Relaxed => 6d,
            FitPreference.Oversized => 10d,
            _ => 2d
        };
        var score = Math.Clamp(100d - Math.Abs(ease - target) * 7d, 10d, 92d);
        signals.Add((
            score,
            1.4,
            $"Omuzda yaklaşık {ease:+0.#;-0.#;0} cm giysi payı var."));
    }

    private static void AddWaistSignal(
        UserProfile profile,
        OrderHistoryItem order,
        ICollection<(double Score, double Weight, string Detail)> signals)
    {
        if (order.WaistWidthCm is null)
        {
            return;
        }

        var garmentCircumference = (double)order.WaistWidthCm.Value * 2d;
        var ease = garmentCircumference - (double)profile.WaistCircumferenceCm;
        var target = profile.FitPreference switch
        {
            FitPreference.Slim => 2d,
            FitPreference.TrueToSize => 6d,
            FitPreference.Relaxed => 13d,
            FitPreference.Oversized => 22d,
            _ => 6d
        };
        var score = Math.Clamp(100d - Math.Abs(ease - target) * 3.2d, 10d, 92d);
        signals.Add((
            score,
            1.2,
            $"Bel çevresinde yaklaşık {ease:+0.#;-0.#;0} cm giysi payı var."));
    }

    private static void AddFitLabelSignal(
        UserProfile profile,
        OrderHistoryItem order,
        ICollection<(double Score, double Weight, string Detail)> signals)
    {
        if (string.IsNullOrWhiteSpace(order.FitLabel))
        {
            return;
        }

        var label = order.FitLabel.ToLowerInvariant();
        var detected = label switch
        {
            var value when value.Contains("oversize") => FitPreference.Oversized,
            var value when value.Contains("boxy") ||
                           value.Contains("kutu") => FitPreference.Relaxed,
            var value when value.Contains("relax") ||
                           value.Contains("rahat") => FitPreference.Relaxed,
            var value when value.Contains("slim") ||
                           value.Contains("dar") => FitPreference.Slim,
            var value when value.Contains("regular") ||
                           value.Contains("standart") => FitPreference.TrueToSize,
            _ => (FitPreference?)null
        };
        if (detected is null)
        {
            return;
        }

        var distance = Math.Abs(
            PreferencePosition(profile.FitPreference) -
            PreferencePosition(detected.Value));
        var score = Math.Clamp(88d - distance * 20d, 20d, 88d);
        signals.Add((
            score,
            0.8,
            $"Resmi kalıp etiketi “{order.FitLabel}”."));
    }

    private static int PreferencePosition(FitPreference preference)
    {
        return preference switch
        {
            FitPreference.Slim => 0,
            FitPreference.TrueToSize => 1,
            FitPreference.Relaxed => 2,
            FitPreference.Oversized => 3,
            _ => 1
        };
    }

    private static bool IsUpperBody(string category)
    {
        return category is "Tops" or "Shirts" or "Outerwear" or "Knitwear" or "Dresses";
    }
}
