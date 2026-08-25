using System.Globalization;
using System.Text.RegularExpressions;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed partial class LocalFitRecommendationEngine(
    RegionalFitFeedbackService regionalFeedback,
    ProductIdentityService productIdentityService,
    ProductFitTaxonomyService fitTaxonomy)
{
    private const string Width = "width";
    private const string Circumference = "circumference";
    private const string Linear = "linear";
    private const string Mass = "mass";
    private const double ShoulderCircumferenceFloor = 70;

    private static readonly IReadOnlyDictionary<string, double> Tolerances =
        new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["Chest"] = 4.0,
            ["Waist"] = 4.0,
            ["Shoulder"] = 2.5,
            ["Length"] = 4.0,
            ["Sleeve"] = 3.0,
            ["Inseam"] = 3.0,
            ["Hip"] = 4.0,
            ["FootLength"] = 0.45,
            ["Height"] = 8.0,
            ["Weight"] = 8.0
        };

    public RecommendationResult Analyze(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        AnalyzeRecommendationRequest request)
    {
        var candidates = ParseCandidates(request.SizeChart);
        var availableSizes = candidates
            .Select(candidate => candidate.Label)
            .Concat(ExtractTextSizes(request.SizeChart.RawText, request.Product))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var measuredWithMetrics = candidates
            .Where(candidate => candidate.Measurements.Count > 0)
            .Select(candidate => candidate.Label)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var listedSizes = (request.SizeChart.AvailableSizes ?? [])
            .Where(label => !string.IsNullOrWhiteSpace(label))
            .Concat(availableSizes)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (measuredWithMetrics.Length == 1 && listedSizes.Length >= 2)
        {
            return new RecommendationResult(
                "Bilinmiyor",
                0,
                "Yalnız bir bedenin milimi okundu; diğer bedenler toplanamadı.",
                "Ölçü paneli açıkken tek bedenin sayıları geldi. FitMemory bu yüzden o tek satırı senin bedenin diye önermedi. Paneldeki tüm bedenleri tek tek gezdirip yeniden dene.",
                [
                    "Ölçüleri görüntüle açık kalsın; Tara ürün sayfasına dönmesin.",
                    "Açık tabloda her beden chip'ine basılınca milimler değişmeli."
                ],
                [],
                BuildEvidenceSummary(orders),
                "local-insufficient");
        }

        if (availableSizes.Length == 0)
        {
            return new RecommendationResult(
                "Bilinmiyor",
                20,
                "Tabloda okunabilir beden etiketleri bulunamadı.",
                "FitMemory bir beden tablosu alanı buldu ancak beden etiketlerini veya ölçüleri güvenilir biçimde ayrıştıramadı.",
                [
                    "Yeniden taramadan önce beden tablosunun tamamını açın.",
                    "Daha güçlü sonuç için sipariş geçmişi taramasını tamamlayın."
                ],
                [],
                BuildEvidenceSummary(orders),
                "local");
        }

        var relevantOrders = orders
            .Where(order =>
            {
                var sameProductFamily =
                    productIdentityService.IsSameFamily(
                        order,
                        request.Product);
                return fitTaxonomy.IsSizingEvidenceEligible(
                    order,
                    request.Product,
                    sameProductFamily);
            })
            .ToArray();
        var sameFamilyOrders = relevantOrders
            .Where(order => productIdentityService.IsSameFamily(
                order,
                request.Product))
            .ToArray();
        var targets = BuildTargets(
            profile,
            relevantOrders,
            request.Product);
        var evaluated = candidates
            .Select((candidate, index) => ScoreCandidate(
                candidate,
                targets,
                relevantOrders,
                sameFamilyOrders,
                profile,
                request.Product,
                index))
            .ToArray();
        var hasComparableMeasurements = evaluated.Any(result =>
            result.MatchedMetrics > 0);
        var scored = evaluated
            .Where(result =>
                result.MatchedMetrics > 0 &&
                result.StructurallyPlausible)
            .OrderBy(result => result.Score)
            .ThenBy(result => result.Index)
            .ToArray();

        if (scored.Length == 0)
        {
            if (sameFamilyOrders.Any(HasConfirmedNegativeSizeBoundary))
            {
                return new RecommendationResult(
                    "Bilinmiyor",
                    32,
                    "Bu kalıpta doğrulanmış olumsuz deneyiminle çelişmeyen bir beden bulunamadı.",
                    "Aynı ürün/kalıp ailesinde daha önce bol veya dar kaldığını belirttiğin beden güçlü bir sınır olarak uygulandı. FitMemory bu sınırı yok sayıp daha büyük ya da daha küçük bir bedeni sırf tablo ortalamasına uyuyor diye önermedi.",
                    [
                        "Önceki kişisel uyum geri bildirimin, genel beden tablosundan daha güçlü kanıt sayıldı.",
                        "Sayfada uygun yönde başka beden varsa ölçüler açıldığında yeniden karşılaştırılabilir.",
                        "Kalıp etiketi değişirse sonuç aynı beden numarası üzerinden taşınmaz."
                    ],
                    [],
                    BuildEvidenceSummary(relevantOrders),
                    "local-personal-boundary");
            }

            var bottomEstimate = EstimateBottomLabelSize(
                profile,
                request.Product,
                availableSizes);
            if (bottomEstimate is not null)
            {
                return new RecommendationResult(
                    ApplyMerchantSizeShift(
                        bottomEstimate.SelectedSize,
                        request.Product,
                        availableSizes),
                    bottomEstimate.Confidence,
                    $"{bottomEstimate.SelectedSize}, bel ölçüne göre en tutarlı beden.",
                    $"{bottomEstimate.SelectedSize} beden {bottomEstimate.WaistCm:0.#} cm belinle bu kesimde örtüşür. Okunan daha dar beden bele oturmadığı için elendi.",
                    [
                        "Bel çevren ürün bel ölçüsüyle karşılaştırıldı.",
                        "Tüm bedenlerin milimini açmak sonucu güçlendirir."
                    ],
                    [
                        new ComparisonDto(
                            "Bel",
                            $"{bottomEstimate.WaistCm:0.#} cm bel · {bottomEstimate.TargetEu} EU aralığı")
                    ],
                    BuildEvidenceSummary(relevantOrders),
                    "local-waist-label-estimate");
            }


            return new RecommendationResult(
                "Bilinmiyor",
                0,
                "Ürün ölçüleri okunmadan beden önerilmedi.",
                "Sayfadaki ölçü tablosu henüz sayısal giysi milimine dönüşmedi. FitMemory bu yüzden göğüs çevrenden veya model bedeninden ölçü uydurmadı. Ölçüler sekmesini açık bırakıp yeniden dene.",
                [
                    "Beden önerisi yalnız okunan ürün ölçülerinden üretilir.",
                    "Mağazanın 'büyük beden, bir beden küçük al' uyarısı ölçü okunduktan sonra uygulanır."
                ],
                [],
                BuildEvidenceSummary(relevantOrders),
                "local-insufficient");
        }

        var best = scored[0];
        var confidence = CalculateConfidence(best, relevantOrders, targets);
        var comparisons = BuildComparisons(
            best.Candidate,
            targets,
            profile);
        var explanation = BuildExplanation(
            best.Candidate,
            comparisons,
            profile,
            request.Product,
            relevantOrders);
        var fitNotes = BuildFitNotes(
            profile,
            relevantOrders,
            sameFamilyOrders,
            best);

        var selectedSize = ApplyMerchantSizeShift(
            best.Candidate.Label,
            request.Product,
            availableSizes);
        return new RecommendationResult(
            selectedSize,
            confidence,
            $"{selectedSize}, ölçülerinize en güçlü eşleşme.",
            explanation,
            fitNotes,
            comparisons,
            BuildEvidenceSummary(relevantOrders),
            "local");
    }

    public IReadOnlyList<string> GetAvailableSizes(
        SizeChartDto chart,
        ProductDto? product = null)
    {
        var structured = ParseCandidates(chart)
            .Select(candidate => candidate.Label)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return structured.Length > 0
            ? structured
            : ExtractTextSizes(chart.RawText, product);
    }

    public bool IsStructurallyPlausible(
        UserProfile profile,
        SizeChartDto chart,
        ProductDto product,
        string size)
    {
        var candidate = ParseCandidates(chart)
            .FirstOrDefault(item => item.Label.Equals(
                size,
                StringComparison.OrdinalIgnoreCase));
        return candidate is not null &&
               EvaluateStructuralFit(
                   candidate,
                   profile,
                   product).IsPlausible;
    }

    private static IReadOnlyList<ChartCandidate> ParseCandidates(SizeChartDto chart)
    {
        if (chart.Headers.Count == 0 || chart.Rows.Count == 0)
        {
            return [];
        }

        var sizeIndex = FindSizeIndex(chart.Headers);
        if (sizeIndex < 0)
        {
            return [];
        }
        var candidates = new List<ChartCandidate>();
        foreach (var row in chart.Rows)
        {
            if (row.Cells.Count == 0 || sizeIndex >= row.Cells.Count)
            {
                continue;
            }

            var label = NormalizeSizeLabel(row.Cells[sizeIndex]);
            if (string.IsNullOrWhiteSpace(label))
            {
                continue;
            }

            var measurements = new Dictionary<string, ChartMeasurement>(StringComparer.OrdinalIgnoreCase);
            for (var index = 0; index < Math.Min(chart.Headers.Count, row.Cells.Count); index++)
            {
                if (index == sizeIndex)
                {
                    continue;
                }

                var metric = CanonicalMetric(chart.Headers[index]);
                if (metric is null || !TryParseMeasurement(
                        row.Cells[index],
                        chart.Headers[index],
                        chart.Unit,
                        metric,
                        out var measurement))
                {
                    continue;
                }

                measurements.TryAdd(metric, measurement);
            }

            candidates.Add(new ChartCandidate(label, measurements));
        }

        return candidates;
    }

    private static int FindSizeIndex(IReadOnlyList<string> headers)
    {
        for (var index = 0; index < headers.Count; index++)
        {
            var normalized = headers[index].ToLower(CultureInfo.GetCultureInfo("tr-TR"));
            if (normalized.Contains("size", StringComparison.Ordinal) ||
                normalized.Contains("beden", StringComparison.Ordinal) ||
                normalized is "eu" or "uk" or "us")
            {
                return index;
            }
        }
        return -1;
    }

    private static string? CanonicalMetric(string header)
    {
        var normalized = header.ToLower(CultureInfo.GetCultureInfo("tr-TR"));
        if (normalized.Contains("foot length", StringComparison.Ordinal) ||
            normalized.Contains("feet length", StringComparison.Ordinal) ||
            normalized.Contains("insole length", StringComparison.Ordinal) ||
            normalized.Contains("ayak uzun", StringComparison.Ordinal) ||
            normalized.Contains("ayak boy", StringComparison.Ordinal) ||
            normalized.Contains("taban uzun", StringComparison.Ordinal))
        {
            return "FootLength";
        }
        if (normalized.Contains("chest", StringComparison.Ordinal) ||
            normalized.Contains("bust", StringComparison.Ordinal) ||
            normalized.Contains("göğüs", StringComparison.Ordinal) ||
            normalized.Contains("gogus", StringComparison.Ordinal))
        {
            return "Chest";
        }
        if (normalized.Contains("waist", StringComparison.Ordinal) ||
            normalized.Contains("bel", StringComparison.Ordinal))
        {
            return "Waist";
        }
        if (normalized.Contains("shoulder", StringComparison.Ordinal) ||
            normalized.Contains("omuz", StringComparison.Ordinal))
        {
            return "Shoulder";
        }
        if (normalized.Contains("sleeve", StringComparison.Ordinal) ||
            normalized.Contains("arm length", StringComparison.Ordinal) ||
            normalized.Contains("kol", StringComparison.Ordinal))
        {
            return "Sleeve";
        }
        if (normalized.Contains("inseam", StringComparison.Ordinal) ||
            normalized.Contains("inside leg", StringComparison.Ordinal) ||
            normalized.Contains("iç bacak", StringComparison.Ordinal) ||
            normalized.Contains("ic bacak", StringComparison.Ordinal))
        {
            return "Inseam";
        }
        if (normalized.Contains("hip", StringComparison.Ordinal) ||
            normalized.Contains("seat", StringComparison.Ordinal) ||
            normalized.Contains("kalça", StringComparison.Ordinal) ||
            normalized.Contains("kalca", StringComparison.Ordinal))
        {
            return "Hip";
        }
        if (normalized.Contains("height", StringComparison.Ordinal) ||
            normalized.Contains("boy", StringComparison.Ordinal))
        {
            return "Height";
        }
        if (normalized.Contains("weight", StringComparison.Ordinal) ||
            normalized.Contains("kilo", StringComparison.Ordinal) ||
            normalized.Contains("ağırlık", StringComparison.Ordinal))
        {
            return "Weight";
        }
        if (normalized.Contains("length", StringComparison.Ordinal) ||
            normalized.Contains("uzunluk", StringComparison.Ordinal))
        {
            return "Length";
        }
        return null;
    }

    private static bool TryParseMeasurement(
        string cell,
        string header,
        string chartUnit,
        string metric,
        out ChartMeasurement measurement)
    {
        measurement = default;
        var matches = DecimalNumberRegex().Matches(cell);
        var values = new List<double>();
        foreach (Match match in matches)
        {
            var normalized = match.Value.Replace(',', '.');
            if (double.TryParse(
                    normalized,
                    NumberStyles.AllowDecimalPoint,
                    CultureInfo.InvariantCulture,
                    out var number))
            {
                values.Add(number);
            }
        }

        if (values.Count == 0)
        {
            return false;
        }

        var value = values.Count > 1 ? values.Average() : values[0];
        var normalizedHeader = header.ToLowerInvariant();
        var normalizedCell = cell.ToLowerInvariant();
        var isInches =
            chartUnit.Equals("Inches", StringComparison.OrdinalIgnoreCase) ||
            normalizedHeader.Contains("inch", StringComparison.Ordinal) ||
            normalizedHeader.Contains("(in)", StringComparison.Ordinal) ||
            normalizedCell.Contains("inch", StringComparison.Ordinal);
        if (isInches && metric != "Weight")
        {
            value *= 2.54;
        }

        var kind = MetricKind(metric, normalizedHeader, value);
        measurement = new ChartMeasurement(Math.Round(value, 1), kind);
        return true;
    }

    private static string MetricKind(string metric, string header, double value)
    {
        if (metric == "Weight")
        {
            return Mass;
        }
        if (metric is not ("Chest" or "Waist" or "Hip" or "Shoulder"))
        {
            return Linear;
        }

        var explicitCircumference =
            header.Contains("circum", StringComparison.Ordinal) ||
            header.Contains("body meas", StringComparison.Ordinal) ||
            header.Contains("çevre", StringComparison.Ordinal) ||
            header.Contains("cevre", StringComparison.Ordinal);
        var explicitWidth =
            header.Contains("width", StringComparison.Ordinal) ||
            header.Contains("flat", StringComparison.Ordinal) ||
            header.Contains("half", StringComparison.Ordinal) ||
            header.Contains("1/2", StringComparison.Ordinal) ||
            header.Contains("eni", StringComparison.Ordinal) ||
            header.Contains("genişlik", StringComparison.Ordinal) ||
            header.Contains("genislik", StringComparison.Ordinal);
        var circumferenceFloor = metric switch
        {
            "Chest" => 78,
            "Shoulder" => ShoulderCircumferenceFloor,
            _ => 60
        };
        if (explicitCircumference && !explicitWidth)
        {
            return Circumference;
        }
        if (value >= circumferenceFloor)
        {
            return Circumference;
        }
        return Width;
    }

    private static IReadOnlyDictionary<string, TargetMetric> BuildTargets(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        ProductDto product)
    {
        var targets = new Dictionary<string, TargetMetric>(StringComparer.OrdinalIgnoreCase);
        var kept = orders.Where(order => order.Outcome == OrderOutcome.KeptGoodFit).ToArray();

        AddHistoryTarget(targets, "Chest", kept, order => order.ChestWidthCm, Width, profile.FitPreference);
        AddHistoryTarget(targets, "Waist", kept, order => order.WaistWidthCm, Width, profile.FitPreference);
        AddHistoryTarget(targets, "Shoulder", kept, order => StoredShoulderWidth(order.ShoulderWidthCm), Width, profile.FitPreference);
        AddHistoryTarget(targets, "Length", kept, order => order.LengthCm, Linear, profile.FitPreference);
        AddHistoryTarget(targets, "Sleeve", kept, order => order.SleeveLengthCm, Linear, profile.FitPreference);
        AddHistoryTarget(targets, "Inseam", kept, order => order.InseamCm, Linear, profile.FitPreference);

        if (kept.Length == 0)
        {
            var unverified = orders
                .Where(order => order.Outcome == OrderOutcome.PurchasedUnknownFit)
                .ToArray();
            AddUnverifiedTarget(targets, "Chest", unverified, order => order.ChestWidthCm, Width);
            AddUnverifiedTarget(targets, "Waist", unverified, order => order.WaistWidthCm, Width);
            AddUnverifiedTarget(targets, "Shoulder", unverified, order => StoredShoulderWidth(order.ShoulderWidthCm), Width);
            AddUnverifiedTarget(targets, "Length", unverified, order => order.LengthCm, Linear);
            AddUnverifiedTarget(targets, "Sleeve", unverified, order => order.SleeveLengthCm, Linear);
            AddUnverifiedTarget(targets, "Inseam", unverified, order => order.InseamCm, Linear);
        }

        if (profile.FootLengthCm.HasValue)
        {
            targets.TryAdd("FootLength", new TargetMetric(
                (double)profile.FootLengthCm.Value,
                Linear,
                "Ayak profili",
                1.0));
        }
        targets.TryAdd("Shoulder", new TargetMetric(
            StoredShoulderCircumference(profile.ShoulderWidthCm),
            Circumference,
            "Vücut profili",
            0.65));
        if (profile.ChestCircumferenceCm.HasValue)
        {
            targets.TryAdd("Chest", new TargetMetric(
                (double)profile.ChestCircumferenceCm.Value,
                Circumference,
                "Göğüs çevresi",
                0.90));
        }
        targets.TryAdd("Waist", new TargetMetric(
            (double)profile.WaistCircumferenceCm,
            Circumference,
            "Vücut profili",
            0.55));
        targets.TryAdd("Height", new TargetMetric(
            (double)profile.HeightCm,
            Linear,
            "Vücut profili",
            0.35));
        targets.TryAdd("Weight", new TargetMetric(
            (double)profile.WeightKg,
            Mass,
            "Vücut profili",
            0.25));

        return targets;
    }

    private static void AddHistoryTarget(
        IDictionary<string, TargetMetric> targets,
        string metric,
        IReadOnlyList<OrderHistoryItem> kept,
        Func<OrderHistoryItem, decimal?> selector,
        string kind,
        FitPreference preference)
    {
        var values = kept
            .Select(selector)
            .Where(value => value.HasValue)
            .Select(value => (double)value!.Value)
            .ToArray();
        if (values.Length == 0)
        {
            return;
        }

        var offset = PreferenceOffset(metric, preference);
        targets[metric] = new TargetMetric(
            Math.Round(values.Average() + offset, 1),
            kind,
            $"{values.Length} doğrulanmış ürün",
            1.0);
    }

    private static void AddUnverifiedTarget(
        IDictionary<string, TargetMetric> targets,
        string metric,
        IReadOnlyList<OrderHistoryItem> orders,
        Func<OrderHistoryItem, decimal?> selector,
        string kind)
    {
        var values = orders
            .Select(selector)
            .Where(value => value.HasValue)
            .Select(value => (double)value!.Value)
            .ToArray();
        if (values.Length == 0)
        {
            return;
        }

        targets[metric] = new TargetMetric(
            Math.Round(values.Average(), 1),
            kind,
            $"{values.Length} uyumu doğrulanmamış satın alım",
            0.30);
    }

    private static double PreferenceOffset(string metric, FitPreference preference)
    {
        var scale = metric switch
        {
            "Chest" or "Waist" => 1.0,
            "Shoulder" => 0.5,
            "Length" or "Sleeve" => 0.35,
            _ => 0.0
        };
        var offset = preference switch
        {
            FitPreference.Slim => -1.0,
            FitPreference.Relaxed => 1.5,
            FitPreference.Oversized => 2.5,
            _ => 0.0
        };
        return offset * scale;
    }

    private CandidateScore ScoreCandidate(
        ChartCandidate candidate,
        IReadOnlyDictionary<string, TargetMetric> targets,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> sameFamilyOrders,
        UserProfile profile,
        ProductDto product,
        int index)
    {
        var score = 0.0;
        var matched = 0;
        foreach (var (metric, measurement) in candidate.Measurements)
        {
            if (!targets.TryGetValue(metric, out var target))
            {
                continue;
            }

            var targetValue = ConvertKind(target.Value, target.Kind, measurement.Kind);
            if (metric.Equals("Chest", StringComparison.OrdinalIgnoreCase) &&
                profile.ChestCircumferenceCm.HasValue)
            {
                targetValue = ChestTargetValue(profile, product, measurement.Kind);
            }
            var tolerance = Tolerances.GetValueOrDefault(metric, 4.0);
            score += Math.Abs(measurement.Value - targetValue) / tolerance * target.Strength;
            matched++;
        }

        if (IsBottomProduct(product) && profile.WaistCircumferenceCm > 0)
        {
            var raw = (int)Math.Round((double)profile.WaistCircumferenceCm / 2);
            var targetEu = raw % 2 == 0 ? raw : raw - 1;
            if (int.TryParse(candidate.Label, out var sizeNum))
            {
                score += Math.Abs(sizeNum - targetEu) / 8.0;
            }
        }

        var structuralFit = EvaluateStructuralFit(
            candidate,
            profile,
            product);
        var violatesPersonalBoundary = sameFamilyOrders.Any(order =>
            ViolatesConfirmedSizeBoundary(candidate.Label, order));
        score += structuralFit.Penalty;
        score += ReturnBoundaryPenalty(
            candidate,
            orders,
            sameFamilyOrders);
        return new CandidateScore(
            candidate,
            score / Math.Max(matched, 1),
            matched,
            structuralFit.IsPlausible && !violatesPersonalBoundary,
            index);
    }

    private StructuralFitResult EvaluateStructuralFit(
        ChartCandidate candidate,
        UserProfile profile,
        ProductDto product)
    {
        var fit = ProductFit(product);
        if (candidate.Measurements.TryGetValue(
                "Shoulder",
                out var shoulder))
        {
            var difference =
                ConvertKind(shoulder.Value, shoulder.Kind, Width) -
                StoredShoulderWidth(profile.ShoulderWidthCm);
            var shoulderBounds = fit switch
            {
                ProductFitKind.Slim => (-1.5, 3.5),
                ProductFitKind.Regular => (-1.5, 7.0),
                ProductFitKind.Relaxed => (-1.0, 9.0),
                ProductFitKind.Boxy => (-1.0, 12.0),
                ProductFitKind.Oversized => (-1.0, 16.0),
                _ => (-1.5, 7.0)
            };
            if (difference < shoulderBounds.Item1 ||
                difference > shoulderBounds.Item2)
            {
                return new StructuralFitResult(false, 100);
            }
        }

        if (profile.ChestCircumferenceCm.HasValue &&
            candidate.Measurements.TryGetValue(
                "Chest",
                out var chest))
        {
            var body = (double)profile.ChestCircumferenceCm.Value;
            if (chest.Kind == Circumference)
            {
                if (Math.Abs(chest.Value - body) > 10)
                {
                    return new StructuralFitResult(false, 100);
                }
            }
            else if (chest.Kind == Width)
            {
                var garmentEase = chest.Value - body / 2;
                var chestBounds = PreferredChestEaseBounds(
                    profile.FitPreference,
                    fit);
                var categoryAllowance = IsOuterwear(product) ? 1.5 : 0.0;
                if (garmentEase < chestBounds.Item1 ||
                    garmentEase > chestBounds.Item2 + categoryAllowance)
                {
                    return new StructuralFitResult(false, 100);
                }
            }
        }

        if (profile.WaistCircumferenceCm > 0 &&
            candidate.Measurements.TryGetValue("Waist", out var waist))
        {
            var body = (double)profile.WaistCircumferenceCm;
            var garment = ConvertKind(waist.Value, waist.Kind, Circumference);
            var ease = garment - body;
            var waistBounds = PreferredWaistEaseBounds(profile.FitPreference, fit);
            if (ease < waistBounds.Item1 || ease > waistBounds.Item2)
            {
                return new StructuralFitResult(false, 100);
            }
        }
        else if (profile.WaistCircumferenceCm > 0 &&
                 candidate.Measurements.TryGetValue("Hip", out var hip))
        {
            var body = (double)profile.WaistCircumferenceCm;
            var garment = ConvertKind(hip.Value, hip.Kind, Circumference);
            var ease = garment - body;
            if (ease < -6 || ease > 22)
            {
                return new StructuralFitResult(false, 100);
            }
        }

        return new StructuralFitResult(true, 0);
    }

    private string? FindConfirmedCategorySize(
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<string> availableSizes)
    {
        return orders
            .Where(order =>
                order.Outcome == OrderOutcome.KeptGoodFit &&
                !regionalFeedback.HasNegativeSignal(
                    order.UserFitNotes) &&
                availableSizes.Contains(
                    order.PurchasedSize,
                    StringComparer.OrdinalIgnoreCase))
            .GroupBy(
                order => order.PurchasedSize,
                StringComparer.OrdinalIgnoreCase)
            .OrderByDescending(group => group.Count())
            .ThenByDescending(group => group.Max(order => order.UpdatedAt))
            .Select(group => group.Key)
            .FirstOrDefault();
    }

    private static FootwearSizeEstimate? EstimateFootwearLabelSize(
        UserProfile profile,
        ProductDto product,
        IReadOnlyList<string> availableSizes)
    {
        if (!profile.UsualShoeSizeEu.HasValue ||
            !IsFootwearProduct(product))
        {
            return null;
        }

        var numericSizes = availableSizes
            .Select(size => new
            {
                Label = size.Trim().ToUpperInvariant(),
                Parsed = decimal.TryParse(
                    size.Trim().Replace(',', '.'),
                    NumberStyles.AllowDecimalPoint,
                    CultureInfo.InvariantCulture,
                    out var value)
                    ? value
                    : (decimal?)null
            })
            .Where(item => item.Parsed is >= 20 and <= 55)
            .ToArray();
        if (numericSizes.Length == 0)
        {
            return null;
        }

        var selected = numericSizes
            .OrderBy(item => Math.Abs(
                item.Parsed!.Value -
                profile.UsualShoeSizeEu.Value))
            .ThenBy(item => item.Parsed)
            .First();
        return new FootwearSizeEstimate(
            selected.Label,
            profile.FootLengthCm.HasValue ? 56 : 50);
    }

    private static bool IsFootwearProduct(ProductDto product)
    {
        var value = $" {product.Category} {product.Name} "
            .ToLowerInvariant();
        return value.Contains("ayakkabı", StringComparison.Ordinal) ||
               value.Contains("ayakkabi", StringComparison.Ordinal) ||
               value.Contains("shoe", StringComparison.Ordinal) ||
               value.Contains("sneaker", StringComparison.Ordinal) ||
               value.Contains("trainer", StringComparison.Ordinal) ||
               value.Contains("loafer", StringComparison.Ordinal) ||
               value.Contains("bot", StringComparison.Ordinal) ||
               value.Contains("boot", StringComparison.Ordinal) ||
               value.Contains("sandal", StringComparison.Ordinal) ||
               value.Contains("terlik", StringComparison.Ordinal);
    }

    private static ModelReferenceEstimate? EstimateFromModelReference(
        UserProfile profile,
        ProductDto product,
        IReadOnlyList<string> availableSizes)
    {
        if (!product.ModelHeightCm.HasValue ||
            string.IsNullOrWhiteSpace(product.ModelWornSize) ||
            !IsUpperBodySizeEstimateProduct(product))
        {
            return null;
        }

        var modelSize = product.ModelWornSize.Trim().ToUpperInvariant();
        var selectedSize = availableSizes.FirstOrDefault(size =>
            size.Equals(modelSize, StringComparison.OrdinalIgnoreCase));
        if (string.IsNullOrWhiteSpace(selectedSize))
        {
            return null;
        }

        var heightDifference =
            (double)profile.HeightCm - product.ModelHeightCm.Value;
        if (Math.Abs(heightDifference) > 12)
        {
            return null;
        }

        var confidence = Math.Clamp(
            48 +
            (Math.Abs(heightDifference) <= 6 ? 4 : 0) +
            (!string.IsNullOrWhiteSpace(product.FitLabel) ? 3 : 0),
            45,
            56);
        return new ModelReferenceEstimate(
            selectedSize.ToUpperInvariant(),
            product.ModelHeightCm.Value,
            heightDifference,
            confidence);
    }

    private static BodySizeEstimate? EstimateUpperBodyLabelSize(
        UserProfile profile,
        ProductDto product,
        IReadOnlyList<string> availableSizes)
    {
        if (!profile.ChestCircumferenceCm.HasValue ||
            !IsUpperBodySizeEstimateProduct(product))
        {
            return null;
        }

        var letterOrder = new[]
        {
            "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"
        };
        var available = availableSizes
            .Select(size => size.Trim().ToUpperInvariant())
            .Where(size => letterOrder.Contains(
                size,
                StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (available.Length == 0)
        {
            return null;
        }

        var chest = (double)profile.ChestCircumferenceCm.Value;
        var ranges = new (string Size, double Low, double High)[]
        {
            ("XXS", 70, 78),
            ("XS", 78, 86),
            ("S", 86, 94),
            ("M", 94, 102),
            ("L", 102, 110),
            ("XL", 110, 118),
            ("XXL", 118, 126),
            ("XXXL", 126, 134)
        };
        var bodyRange = ranges.FirstOrDefault(range =>
            chest >= range.Low && chest <= range.High);
        if (string.IsNullOrWhiteSpace(bodyRange.Size))
        {
            bodyRange = chest < ranges[0].Low
                ? ranges[0]
                : ranges[^1];
        }

        var bodyIndex = Array.IndexOf(letterOrder, bodyRange.Size);
        var selected = available
            .OrderBy(size =>
                Math.Abs(Array.IndexOf(letterOrder, size) - bodyIndex))
            .ThenBy(size => Array.IndexOf(letterOrder, size))
            .First();
        var brandEvidence = product.Brand.Contains(
            "pull",
            StringComparison.OrdinalIgnoreCase)
            ? 44
            : 38;
        return new BodySizeEstimate(
            selected,
            bodyRange.Size,
            chest,
            bodyRange.Low,
            bodyRange.High,
            brandEvidence);
    }

    private static bool IsUpperBodySizeEstimateProduct(ProductDto product)
    {
        var value = $" {product.Category} {product.Name} "
            .ToLowerInvariant();
        var isBottomOrAccessory =
            value.Contains("pantolon", StringComparison.Ordinal) ||
            value.Contains("jean", StringComparison.Ordinal) ||
            value.Contains("denim", StringComparison.Ordinal) ||
            value.Contains("şort", StringComparison.Ordinal) ||
            value.Contains("shorts", StringComparison.Ordinal) ||
            value.Contains("etek", StringComparison.Ordinal) ||
            value.Contains("ayakkabı", StringComparison.Ordinal) ||
            value.Contains("shoe", StringComparison.Ordinal) ||
            value.Contains("aksesuar", StringComparison.Ordinal);
        if (isBottomOrAccessory)
        {
            return false;
        }

        return value.Contains("tişört", StringComparison.Ordinal) ||
               value.Contains("tisort", StringComparison.Ordinal) ||
               value.Contains("t-shirt", StringComparison.Ordinal) ||
               value.Contains("sweat", StringComparison.Ordinal) ||
               value.Contains("hoodie", StringComparison.Ordinal) ||
               value.Contains("kazak", StringComparison.Ordinal) ||
               value.Contains("triko", StringComparison.Ordinal) ||
               value.Contains("gömlek", StringComparison.Ordinal) ||
               value.Contains("shirt", StringComparison.Ordinal) ||
               value.Contains("üst", StringComparison.Ordinal) ||
               value.Contains("top", StringComparison.Ordinal) ||
               value.Contains("mont", StringComparison.Ordinal) ||
               value.Contains("ceket", StringComparison.Ordinal) ||
               value.Contains("jacket", StringComparison.Ordinal) ||
               value.Contains("outerwear", StringComparison.Ordinal);
    }

    private static double ChestEaseWidth(
        ProductDto product,
        FitPreference preference)
    {
        var preferredEase = preference switch
        {
            FitPreference.Slim => 1.5,
            FitPreference.Relaxed => 4.0,
            FitPreference.Oversized => 6.0,
            _ => 2.5
        };
        var fitAdjustment = ProductFit(product) switch
        {
            ProductFitKind.Slim => -0.5,
            ProductFitKind.Relaxed => 0.35,
            ProductFitKind.Boxy => 0.5,
            ProductFitKind.Oversized => 0.75,
            _ => 0.0
        };
        var outerwearAllowance = IsOuterwear(product) ? 1.25 : 0.0;
        return Math.Max(0.75, preferredEase + fitAdjustment + outerwearAllowance);
    }

    private static double ChestTargetValue(
        UserProfile profile,
        ProductDto product,
        string measurementKind)
    {
        var body = (double)profile.ChestCircumferenceCm!.Value;
        return measurementKind == Width
            ? body / 2 + ChestEaseWidth(product, profile.FitPreference)
            : body;
    }

    private static (double Min, double Max) PreferredChestEaseBounds(
        FitPreference preference,
        ProductFitKind fit)
    {
        var bounds = preference switch
        {
            FitPreference.Slim => (0.5, 2.75),
            FitPreference.Relaxed => (2.0, 6.0),
            FitPreference.Oversized => (3.5, 8.0),
            _ => (1.0, 4.0)
        };
        var fitAllowance = fit switch
        {
            ProductFitKind.Relaxed or ProductFitKind.Boxy => 0.75,
            ProductFitKind.Oversized => 1.5,
            _ => 0.0
        };
        return (bounds.Item1, bounds.Item2 + fitAllowance);
    }

    private static (double Min, double Max) PreferredWaistEaseBounds(
        FitPreference preference,
        ProductFitKind fit)
    {
        if (fit is ProductFitKind.Oversized or ProductFitKind.Relaxed or ProductFitKind.Boxy)
        {
            return (-2, 16);
        }

        if (fit == ProductFitKind.Slim || preference == FitPreference.Slim)
        {
            return (-3, 5);
        }

        if (preference is FitPreference.Relaxed or FitPreference.Oversized)
        {
            return (-2, 14);
        }

        return (-3, 8);
    }

    private static bool IsBottomProduct(ProductDto product)
    {
        var value = $" {product.Category} {product.Name} {product.FitLabel} "
            .ToLowerInvariant();
        return value.Contains("pantolon", StringComparison.Ordinal) ||
               value.Contains("jean", StringComparison.Ordinal) ||
               value.Contains("denim", StringComparison.Ordinal) ||
               value.Contains("şort", StringComparison.Ordinal) ||
               value.Contains("shorts", StringComparison.Ordinal) ||
               value.Contains("etek", StringComparison.Ordinal) ||
               value.Contains("skirt", StringComparison.Ordinal) ||
               value.Contains("chino", StringComparison.Ordinal) ||
               value.Contains("cargo", StringComparison.Ordinal);
    }

    private static BottomSizeEstimate? EstimateBottomLabelSize(
        UserProfile profile,
        ProductDto product,
        IReadOnlyList<string> availableSizes)
    {
        if (!IsBottomProduct(product) || profile.WaistCircumferenceCm <= 0)
        {
            return null;
        }

        var raw = (int)Math.Round((double)profile.WaistCircumferenceCm / 2);
        if (raw is < 32 or > 52)
        {
            return null;
        }

        var targetEu = raw % 2 == 0 ? raw : raw - 1;
        var numeric = availableSizes
            .Select(size => new
            {
                Label = size.Trim().ToUpperInvariant(),
                Parsed = int.TryParse(size.Trim(), out var value) ? value : (int?)null
            })
            .Where(item => item.Parsed is >= 32 and <= 52 && item.Parsed % 2 == 0)
            .ToArray();
        if (numeric.Length == 0)
        {
            return null;
        }

        var selected = numeric
            .OrderBy(item => Math.Abs(item.Parsed!.Value - targetEu))
            .ThenBy(item => item.Parsed)
            .First();
        return new BottomSizeEstimate(
            selected.Label,
            targetEu,
            (double)profile.WaistCircumferenceCm,
            64);
    }

    private bool HasConfirmedNegativeSizeBoundary(OrderHistoryItem order)
    {
        return order.Outcome.IsNegativeFitFeedback() ||
               regionalFeedback.HasNegativeSignal(order.UserFitNotes);
    }

    private bool ViolatesConfirmedSizeBoundary(
        string candidateSize,
        OrderHistoryItem order)
    {
        if (!TryGetComparableSizeRank(candidateSize, out var candidateRank) ||
            !TryGetComparableSizeRank(order.PurchasedSize, out var orderRank))
        {
            return false;
        }

        var hasLooseSignal = order.Outcome.IsBaggyFeedback() ||
            regionalFeedback.Parse(order.UserFitNotes)
                .Any(signal => signal.State == RegionalFitState.Loose);
        if (hasLooseSignal && candidateRank >= orderRank)
        {
            return true;
        }

        var hasTightSignal = order.Outcome.IsTightFeedback() ||
            regionalFeedback.Parse(order.UserFitNotes)
                .Any(signal => signal.State == RegionalFitState.Tight);
        return hasTightSignal && candidateRank <= orderRank;
    }

    private static bool TryGetComparableSizeRank(
        string value,
        out double rank)
    {
        var normalized = Regex.Replace(
            value.Trim().ToUpperInvariant(),
            @"\s+",
            "");
        var alphaRanks = new Dictionary<string, double>(
            StringComparer.OrdinalIgnoreCase)
        {
            ["XXXS"] = 0,
            ["XXS"] = 1,
            ["XS"] = 2,
            ["S"] = 3,
            ["M"] = 4,
            ["L"] = 5,
            ["XL"] = 6,
            ["XXL"] = 7,
            ["XXXL"] = 8
        };
        if (alphaRanks.TryGetValue(normalized, out rank))
        {
            return true;
        }

        return double.TryParse(
            normalized.Replace(',', '.'),
            NumberStyles.Number,
            CultureInfo.InvariantCulture,
            out rank);
    }

    private static ProductFitKind ProductFit(ProductDto product)
    {
        var value =
            $"{product.FitLabel} {product.FitEvidence} {product.Name}"
                .ToLowerInvariant();
        if (value.Contains("boxy", StringComparison.Ordinal) ||
            value.Contains("kutu kalıp", StringComparison.Ordinal) ||
            value.Contains("kutu kalip", StringComparison.Ordinal))
        {
            return ProductFitKind.Boxy;
        }
        if (value.Contains("oversize", StringComparison.Ordinal) ||
            value.Contains("loose", StringComparison.Ordinal) ||
            value.Contains("baggy", StringComparison.Ordinal) ||
            value.Contains("bol kalıp", StringComparison.Ordinal) ||
            value.Contains("bol kalip", StringComparison.Ordinal))
        {
            return ProductFitKind.Oversized;
        }
        if (value.Contains("relax", StringComparison.Ordinal) ||
            value.Contains("comfort", StringComparison.Ordinal) ||
            value.Contains("rahat kalıp", StringComparison.Ordinal))
        {
            return ProductFitKind.Relaxed;
        }
        if (value.Contains("slim", StringComparison.Ordinal) ||
            value.Contains("skinny", StringComparison.Ordinal) ||
            value.Contains("fitted", StringComparison.Ordinal) ||
            value.Contains("dar kalıp", StringComparison.Ordinal))
        {
            return ProductFitKind.Slim;
        }
        if (value.Contains("regular", StringComparison.Ordinal) ||
            value.Contains("standard", StringComparison.Ordinal) ||
            value.Contains("standart", StringComparison.Ordinal))
        {
            return ProductFitKind.Regular;
        }
        return ProductFitKind.Unknown;
    }

    private static string FitKindLabel(ProductFitKind fit)
    {
        return fit switch
        {
            ProductFitKind.Slim => "Slim fit",
            ProductFitKind.Regular => "Regular fit",
            ProductFitKind.Relaxed => "Relaxed fit",
            ProductFitKind.Boxy => "Boxy fit",
            ProductFitKind.Oversized => "Oversize fit",
            _ => "Bilinmeyen"
        };
    }

    private static bool IsOuterwear(ProductDto product)
    {
        var value = $" {product.Category} {product.Name} "
            .ToLowerInvariant();
        return value.Contains("outerwear", StringComparison.Ordinal) ||
               value.Contains("jacket", StringComparison.Ordinal) ||
               value.Contains("coat", StringComparison.Ordinal) ||
               value.Contains("parka", StringComparison.Ordinal) ||
               value.Contains("blazer", StringComparison.Ordinal) ||
               value.Contains("mont", StringComparison.Ordinal) ||
               value.Contains("ceket", StringComparison.Ordinal) ||
               value.Contains("kaban", StringComparison.Ordinal);
    }

    private double ReturnBoundaryPenalty(
        ChartCandidate candidate,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> sameFamilyOrders)
    {
        var penalty = 0.0;
        foreach (var order in orders.Where(order =>
                     order.Outcome.IsNegativeFitFeedback()))
        {
            penalty += BoundaryPenalty(candidate, "Chest", order.ChestWidthCm, Width, order.Outcome, 2.5);
            penalty += BoundaryPenalty(candidate, "Waist", order.WaistWidthCm, Width, order.Outcome, 2.5);
            penalty += BoundaryPenalty(candidate, "Shoulder", StoredShoulderWidth(order.ShoulderWidthCm), Width, order.Outcome, 1.8);
            penalty += BoundaryPenalty(candidate, "Length", order.LengthCm, Linear, order.Outcome, 1.0);
            penalty += BoundaryPenalty(candidate, "Sleeve", order.SleeveLengthCm, Linear, order.Outcome, 1.2);
            penalty += BoundaryPenalty(candidate, "Inseam", order.InseamCm, Linear, order.Outcome, 1.4);
        }

        foreach (var order in sameFamilyOrders)
        {
            foreach (var signal in regionalFeedback.Parse(order.UserFitNotes))
            {
                var outcome = signal.State switch
                {
                    RegionalFitState.Tight => OrderOutcome.KeptTooTight,
                    RegionalFitState.Loose => OrderOutcome.KeptTooBaggy,
                    _ => (OrderOutcome?)null
                };
                if (outcome is null)
                {
                    continue;
                }

                penalty += signal.Metric switch
                {
                    "Chest" => BoundaryPenalty(candidate, "Chest", order.ChestWidthCm, Width, outcome.Value, 3.2),
                    "Waist" => BoundaryPenalty(candidate, "Waist", order.WaistWidthCm, Width, outcome.Value, 3.2),
                    "Shoulder" => BoundaryPenalty(candidate, "Shoulder", StoredShoulderWidth(order.ShoulderWidthCm), Width, outcome.Value, 2.4),
                    "Length" => BoundaryPenalty(candidate, "Length", order.LengthCm, Linear, outcome.Value, 1.8),
                    "Sleeve" => BoundaryPenalty(candidate, "Sleeve", order.SleeveLengthCm, Linear, outcome.Value, 1.6),
                    "Inseam" => BoundaryPenalty(candidate, "Inseam", order.InseamCm, Linear, outcome.Value, 1.8),
                    _ => 0
                };
            }
        }
        return penalty;
    }

    private static double BoundaryPenalty(
        ChartCandidate candidate,
        string metric,
        decimal? boundary,
        string boundaryKind,
        OrderOutcome outcome,
        double weight)
    {
        if (!boundary.HasValue || !candidate.Measurements.TryGetValue(metric, out var measurement))
        {
            return 0;
        }

        var boundaryValue = ConvertKind((double)boundary.Value, boundaryKind, measurement.Kind);
        var violation = outcome switch
        {
            OrderOutcome.ReturnedTooBaggy or
            OrderOutcome.KeptTooBaggy =>
                measurement.Value - (boundaryValue - 0.5),
            OrderOutcome.ReturnedTooTight or
            OrderOutcome.KeptTooTight =>
                boundaryValue + 0.5 - measurement.Value,
            _ => 0
        };
        if (violation <= 0)
        {
            return 0;
        }

        var tolerance = Tolerances.GetValueOrDefault(metric, 4.0);
        var severity = 1.0 + Math.Min(violation / tolerance, 2.5);
        return weight * severity;
    }

    private static double StoredShoulderCircumference(decimal raw)
    {
        var value = (double)raw;
        return value >= ShoulderCircumferenceFloor ? value : value * 2;
    }

    private static double StoredShoulderWidth(decimal raw) =>
        StoredShoulderCircumference(raw) / 2;

    private static decimal? StoredShoulderWidth(decimal? raw) =>
        raw is null ? null : (decimal)StoredShoulderWidth(raw.Value);

    private static double ConvertKind(double value, string from, string to)
    {
        if (from == to)
        {
            return value;
        }
        if (from == Width && to == Circumference)
        {
            return value * 2;
        }
        if (from == Circumference && to == Width)
        {
            return value / 2;
        }
        return value;
    }

    private static int CalculateConfidence(
        CandidateScore best,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyDictionary<string, TargetMetric> targets)
    {
        var keptCount = orders.Count(order => order.Outcome == OrderOutcome.KeptGoodFit);
        var feedbackCount = orders.Count(order =>
            order.Outcome.IsNegativeFitFeedback());
        var historyTargets = targets.Count(target => target.Value.Strength >= 0.9);
        var scorePenalty = (int)Math.Round(Math.Min(best.Score * 7, 22));
        var confidence =
            (best.MatchedMetrics >= 2 ? 74 : 62) +
            Math.Min(keptCount * 4, 12) +
            Math.Min(feedbackCount * 3, 9) +
            Math.Min(historyTargets * 3, 12) +
            Math.Min(best.MatchedMetrics * 2, 8) -
            scorePenalty;
        return Math.Clamp(confidence, 58, 92);
    }

    private static IReadOnlyList<ComparisonDto> BuildComparisons(
        ChartCandidate candidate,
        IReadOnlyDictionary<string, TargetMetric> targets,
        UserProfile profile)
    {
        return candidate.Measurements
            .Where(item => targets.ContainsKey(item.Key))
            .OrderBy(item => MetricPriority(item.Key))
            .Take(4)
            .Select(item =>
            {
                if (item.Key.Equals(
                        "Chest",
                        StringComparison.OrdinalIgnoreCase) &&
                    profile.ChestCircumferenceCm.HasValue)
                {
                    var bodyCircumference =
                        (double)profile.ChestCircumferenceCm.Value;
                    var garmentCircumference = ConvertKind(
                        item.Value.Value,
                        item.Value.Kind,
                        Circumference);
                    var totalEase =
                        garmentCircumference - bodyCircumference;
                    var label = item.Value.Kind == Circumference
                        ? "Göğüs çevresi"
                        : MetricLabel(item.Key);
                    return new ComparisonDto(
                        label,
                        $"Vücut {bodyCircumference:0.#} cm · {candidate.Label} giysi {garmentCircumference:0.#} cm · bolluk {totalEase:+0.#;-0.#;0} cm");
                }

                if (item.Key.Equals("Shoulder", StringComparison.OrdinalIgnoreCase))
                {
                    var bodyCircumference =
                        StoredShoulderCircumference(profile.ShoulderWidthCm);
                    var garmentCircumference = ConvertKind(
                        item.Value.Value,
                        item.Value.Kind,
                        Circumference);
                    var totalEase = garmentCircumference - bodyCircumference;
                    var label = item.Value.Kind == Circumference
                        ? "Omuz çevresi"
                        : MetricLabel(item.Key);
                    return new ComparisonDto(
                        label,
                        $"Vücut {bodyCircumference:0.#} cm · {candidate.Label} giysi {garmentCircumference:0.#} cm · bolluk {totalEase:+0.#;-0.#;0} cm");
                }

                var target = targets[item.Key];
                var targetValue = ConvertKind(target.Value, target.Kind, item.Value.Kind);
                var unit = item.Key == "Weight" ? "kg" : "cm";
                return new ComparisonDto(
                    MetricLabel(item.Key),
                    $"Hedef {targetValue:0.#} {unit} · {candidate.Label}: {item.Value.Value:0.#} {unit}");
            })
            .ToArray();
    }

    private static int MetricPriority(string metric)
    {
        return metric switch
        {
            "FootLength" => 0,
            "Chest" => 0,
            "Waist" => 1,
            "Shoulder" => 2,
            "Hip" => 3,
            "Length" => 4,
            "Sleeve" => 5,
            "Inseam" => 6,
            _ => 10
        };
    }

    private static string BuildExplanation(
        ChartCandidate candidate,
        IReadOnlyList<ComparisonDto> comparisons,
        UserProfile profile,
        ProductDto product,
        IReadOnlyList<OrderHistoryItem> orders)
    {
        var size = candidate.Label;
        var fitLabel = string.IsNullOrWhiteSpace(product.FitLabel)
            ? "bu kalıpta"
            : $"{product.FitLabel} kesiminde";
        var neighbors =
            "Bir küçük beden vücudu sıkıştırır; bir büyük beden belde veya göğüste boşluk bırakır. Bu yüzden önerilen beden, ölçülerinle en dengeli duran seçenek.";
        if (IsBottomProduct(product) && profile.WaistCircumferenceCm > 0)
        {
            return $"{size} bedeni gönül rahatlığıyla alabilirsin. {fitLabel} bel çevrenle örtüşüyor; pantolon belde durmalı, ne kesmeli ne kaymalı. {neighbors} Kesim bol görünse bile bel oturduğu sürece doğru beden budur; kalıbın bolluğu bedeni büyütmek değildir. Ölçü tablosundaki milimler bu kararı taşıyor, tahmin değil.";
        }

        if (profile.ChestCircumferenceCm.HasValue)
        {
            return $"{size} bedeni senin göğüs ve omuz ölçüne göre doğru seçim. {fitLabel} kumaş ve dikiş payı hesaba katıldı; bu beden ne göğüste gerilir ne kol altında toplanır. {neighbors} Açık ölçü panelinden okunan milimler bu kararı taşıyor. İçin rahat olsun: bu, vücut ölçünle ürün tablosunun kesiştiği beden.";
        }

        return $"{size} beden, kayıtlı ölçülerin ve ürünün kalıp etiketine göre bu parçada en güvenilir duruşu verir. {neighbors} Tablo okunduğu için bu bir tahmin değil; aynı kalıpta bir beden küçük veya büyük almak oturuşu bozar.";
    }

    private static IReadOnlyList<string> BuildFitNotes(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> sameFamilyOrders,
        CandidateScore best)
    {
        var notes = new List<string>
        {
            $"Puanlama hedefi {PreferenceLabel(profile.FitPreference)} kalıba göre ayarlandı."
        };
        var baggy = orders.Count(order =>
            order.Outcome.IsBaggyFeedback());
        var tight = orders.Count(order =>
            order.Outcome.IsTightFeedback());
        if (baggy + tight > 0)
        {
            notes.Add($"{baggy + tight} bol/dar geri bildirimi kişisel uyum sınırı oluşturdu.");
        }
        var measuredFeedback = orders.Count(order =>
            order.Outcome.IsNegativeFitFeedback() &&
            HasGarmentMeasurement(order));
        if (measuredFeedback > 0)
        {
            notes.Add(
                $"{measuredFeedback} ölçülü bol/dar geri bildirimi kişisel kalıp sınırlarını yeniden eğitti.");
        }
        var sameFamilyNotes = sameFamilyOrders.Count(order =>
            !string.IsNullOrWhiteSpace(order.UserFitNotes));
        if (sameFamilyNotes > 0)
        {
            notes.Add(
                $"{sameFamilyNotes} bölgesel not yalnız aynı ürün ailesine uygulandı.");
        }
        if (best.MatchedMetrics < 2)
        {
            notes.Add("Yalnız bir uyumlu ölçü bulundu; kumaş esnekliğini ve ürünün kalıp açıklamasını kontrol edin.");
        }
        else
        {
            notes.Add($"Tablodaki {best.MatchedMetrics} ölçü kayıtlı kanıtınızla eşleşti.");
        }
        return notes;
    }

    private static bool HasGarmentMeasurement(OrderHistoryItem order)
    {
        return order.ChestWidthCm.HasValue ||
               order.WaistWidthCm.HasValue ||
               order.ShoulderWidthCm.HasValue ||
               order.LengthCm.HasValue ||
               order.SleeveLengthCm.HasValue ||
               order.InseamCm.HasValue;
    }

    private static string BuildEvidenceSummary(IReadOnlyList<OrderHistoryItem> orders)
    {
        var kept = orders.Count(order => order.Outcome == OrderOutcome.KeptGoodFit);
        var fitFeedback = orders.Count(order =>
            order.Outcome is
                OrderOutcome.KeptTooBaggy or
                OrderOutcome.KeptTooTight);
        var returned = orders.Count(order =>
            order.Outcome.IsReturned());
        var unknown = orders.Count(order => order.Outcome == OrderOutcome.PurchasedUnknownFit);
        return orders.Count == 0
            ? "Yalnız vücut profili"
            : $"{kept} iyi uyum · {fitFeedback} bol/dar · {returned} iade · {unknown} doğrulanmamış";
    }

    private static string PreferenceLabel(FitPreference preference)
    {
        return preference switch
        {
            FitPreference.TrueToSize => "standart",
            FitPreference.Relaxed => "rahat",
            FitPreference.Oversized => "belirgin oversize",
            FitPreference.Slim => "dar",
            _ => "tercih edilen"
        };
    }

    private static string MetricLabel(string metric)
    {
        return metric switch
        {
            "FootLength" => "Ayak uzunluğu",
            "Chest" => "Göğüs",
            "Waist" => "Bel",
            "Shoulder" => "Omuz",
            "Hip" => "Kalça",
            "Length" => "Uzunluk",
            "Sleeve" => "Kol",
            "Inseam" => "İç bacak",
            "Height" => "Boy",
            "Weight" => "Kilo",
            _ => metric
        };
    }

    private static readonly string[] LetterSizes =
        ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL"];

    private static string ApplyMerchantSizeShift(
        string size,
        ProductDto product,
        IReadOnlyList<string> availableSizes)
    {
        var text = Fold(
            $"{product.FitEvidence} {product.Description} {product.Name} {product.MerchantFitAdvice}");
        var delta = 0;
        if (Regex.IsMatch(
                text,
                @"bir beden kucuk|runs large|size down|size smaller"))
        {
            delta = -1;
        }
        else if (Regex.IsMatch(
                     text,
                     @"bir beden buyuk|runs small|size up|size bigger"))
        {
            delta = 1;
        }

        if (delta == 0)
        {
            return size;
        }

        var ordered = availableSizes
            .Select(NormalizeSizeLabel)
            .Where(label => label.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var index = Array.FindIndex(
            ordered,
            label => label.Equals(size, StringComparison.OrdinalIgnoreCase));
        if (index < 0)
        {
            var letterIndex = Array.FindIndex(
                LetterSizes,
                label => label.Equals(size, StringComparison.OrdinalIgnoreCase));
            if (letterIndex < 0)
            {
                return size;
            }

            var neighbor = letterIndex + delta;
            if (neighbor < 0 || neighbor >= LetterSizes.Length)
            {
                return size;
            }

            var match = ordered.FirstOrDefault(label =>
                label.Equals(LetterSizes[neighbor], StringComparison.OrdinalIgnoreCase));
            return match ?? size;
        }

        var shifted = index + delta;
        return shifted >= 0 && shifted < ordered.Length ? ordered[shifted] : size;
    }

    private static string Fold(string? value) => (value ?? "")
        .Trim()
        .ToLowerInvariant()
        .Replace('ı', 'i')
        .Replace('ş', 's')
        .Replace('ğ', 'g')
        .Replace('ç', 'c')
        .Replace('ö', 'o')
        .Replace('ü', 'u');

    private static string NormalizeSizeLabel(string value)
    {
        var label = value.Trim();
        if (label.Length is 0 or > 30 || !SizeLabelRegex().IsMatch(label))
        {
            return "";
        }
        return label.ToUpperInvariant();
    }

    private static string[] ExtractTextSizes(
        string rawText,
        ProductDto? product = null)
    {
        if (product is not null && IsBottomProduct(product))
        {
            var jeanSizes = JeanSizeRegex()
                .Matches(rawText)
                .Select(match => match.Value)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(12)
                .ToArray();
            if (jeanSizes.Length >= 2)
            {
                return jeanSizes;
            }
        }

        var letterSizes = TextSizeRegex()
            .Matches(rawText)
            .Select(match => match.Value.ToUpperInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(12)
            .ToArray();
        if (letterSizes.Length > 0 ||
            product is null ||
            !IsFootwearProduct(product))
        {
            return letterSizes;
        }

        return ShoeSizeRegex()
            .Matches(rawText)
            .Select(match => match.Value.Replace(',', '.'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(20)
            .ToArray();
    }

    [GeneratedRegex(@"\b(?:3[02468]|4[02468]|5[02])\b", RegexOptions.CultureInvariant)]
    private static partial Regex JeanSizeRegex();

    [GeneratedRegex(@"\d+(?:[.,]\d+)?", RegexOptions.CultureInvariant)]
    private static partial Regex DecimalNumberRegex();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9 /+.-]{0,29}$", RegexOptions.CultureInvariant)]
    private static partial Regex SizeLabelRegex();

    [GeneratedRegex(@"\b(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|XXXXL)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex TextSizeRegex();

    [GeneratedRegex(@"\b(?:2[0-9]|3[0-9]|4[0-9]|5[0-5])(?:[.,]5)?\b", RegexOptions.CultureInvariant)]
    private static partial Regex ShoeSizeRegex();

    private readonly record struct ChartMeasurement(double Value, string Kind);

    private sealed record ChartCandidate(
        string Label,
        IReadOnlyDictionary<string, ChartMeasurement> Measurements);

    private readonly record struct TargetMetric(
        double Value,
        string Kind,
        string Source,
        double Strength);

    private sealed record CandidateScore(
        ChartCandidate Candidate,
        double Score,
        int MatchedMetrics,
        bool StructurallyPlausible,
        int Index);

    private sealed record BodySizeEstimate(
        string SelectedSize,
        string BodySize,
        double ChestCm,
        double RangeLow,
        double RangeHigh,
        int Confidence);

    private sealed record BottomSizeEstimate(
        string SelectedSize,
        int TargetEu,
        double WaistCm,
        int Confidence);

    private sealed record ModelReferenceEstimate(
        string Size,
        int ModelHeightCm,
        double HeightDifferenceCm,
        int Confidence);

    private sealed record FootwearSizeEstimate(
        string SelectedSize,
        int Confidence);

    private readonly record struct StructuralFitResult(
        bool IsPlausible,
        double Penalty);

    private enum ProductFitKind
    {
        Unknown,
        Slim,
        Regular,
        Relaxed,
        Boxy,
        Oversized
    }
}
