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
        var availableSizes = candidates.Select(candidate => candidate.Label).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (availableSizes.Length == 0)
        {
            availableSizes = ExtractTextSizes(
                request.SizeChart.RawText,
                request.Product);
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
            var historySize = FindConfirmedCategorySize(
                relevantOrders,
                availableSizes);
            if (!string.IsNullOrWhiteSpace(historySize))
            {
                var historyCount = relevantOrders.Count(order =>
                    order.Outcome == OrderOutcome.KeptGoodFit &&
                    order.PurchasedSize.Equals(
                        historySize,
                        StringComparison.OrdinalIgnoreCase) &&
                    !regionalFeedback.HasNegativeSignal(
                        order.UserFitNotes));
                return new RecommendationResult(
                    historySize.ToUpperInvariant(),
                    Math.Clamp(
                        (hasComparableMeasurements ? 40 : 46) +
                        historyCount * 4,
                        40,
                        58),
                    $"{historySize.ToUpperInvariant()}, aynı kategoride sende doğrulanmış beden.",
                    hasComparableMeasurements
                        ? $"Aktif tablodaki ölçüler okundu; ancak ayrıştırılan bedenlerin hiçbiri göğüs veya omuz fiziksel uygunluk sınırından geçmedi. Bu nedenle FitMemory ölçüyü yok saymak veya güven uydurmak yerine, aynı kategoride iyi uyduğunu belirttiğin {historySize.ToUpperInvariant()} bedenini yalnız geçici referans olarak korudu."
                        : $"Aktif tablodan beden etiketleri okundu fakat göğüs, omuz, bel veya uzunluk değerleri yapılandırılmış ölçüye dönüşmedi. Bu nedenle FitMemory, aynı kategoride iyi uyduğunu belirttiğin {historySize.ToUpperInvariant()} bedenini sınırlı güvenle korudu.",
                    hasComparableMeasurements
                        ? [
                            "Tablo değerleri profilinle karşılaştırıldı; sorun profil eksikliği değil, ölçülerin fiziksel uygunluk sınırının dışında kalmasıdır.",
                            "Beden düğmelerini ve santimetre sütununu açık tutarak yeniden tarayın.",
                            "Relaxed/oversize tercihi tek başına bir beden büyütme gerekçesi sayılmadı."
                        ]
                        : [
                            "Profilindeki göğüs çevresi mevcut; yeniden girmen gerekmiyor.",
                            "Beden düğmelerini ve santimetre sütununu açık tutarak yeniden tarayın.",
                            "Boy veya kilodan göğüs ölçüsü tahmin edilmedi."
                        ],
                    [
                        new ComparisonDto(
                            "Kategori geçmişi",
                            $"{historyCount} iyi uyum kaydı · {historySize.ToUpperInvariant()}")
                    ],
                    BuildEvidenceSummary(relevantOrders),
                    "local-category-history");
            }

            var footwearEstimate = EstimateFootwearLabelSize(
                profile,
                request.Product,
                availableSizes);
            if (footwearEstimate is not null)
            {
                return new RecommendationResult(
                    footwearEstimate.SelectedSize,
                    footwearEstimate.Confidence,
                    $"{footwearEstimate.SelectedSize}, kayıtlı EU ayakkabı numarana en yakın başlangıç.",
                    $"Resmi tabloda ayak uzunluğuyla doğrudan eşleşen bir satır okunamadı. Bu nedenle sayfadaki seçenekler arasından alıştığın EU {profile.UsualShoeSizeEu:0.#} numaraya en yakın {footwearEstimate.SelectedSize} korundu. Marka kalıbı ve ayakkabının iç yapısı değişebileceği için bu sonuç düşük güvenlidir; ayak uzunluğu sütunu açıldığında yeniden hesaplanmalıdır.",
                    [
                        "Boy, kilo, göğüs ve omuz ölçüleri ayakkabı numarası hesabına katılmadı.",
                        profile.FootLengthCm.HasValue
                            ? $"{profile.FootLengthCm:0.#} cm ayak uzunluğun kayıtlı; ancak aktif marka tablosunda karşılaştırılabilir ayak uzunluğu satırı bulunmadı."
                            : "Daha güçlü sonuç için topuktan en uzun parmağa ayak uzunluğunu profile ekle.",
                        "EU numarası markalar arasında kesin iç uzunluk garantisi değildir."
                    ],
                    [
                        new ComparisonDto(
                            "Alışılan EU numarası",
                            $"Profil {profile.UsualShoeSizeEu:0.#} · sayfada {string.Join(", ", availableSizes)}")
                    ],
                    BuildEvidenceSummary(relevantOrders),
                    "local-footwear-size");
            }

            var modelEstimate = EstimateFromModelReference(
                profile,
                request.Product,
                availableSizes);
            if (modelEstimate is not null)
            {
                var fitText = string.IsNullOrWhiteSpace(
                    request.Product.FitLabel)
                    ? "Sayfada ayrı bir kalıp etiketi doğrulanmadı."
                    : $"Resmi ürün açıklamasındaki kalıp {request.Product.FitLabel}.";
                return new RecommendationResult(
                    modelEstimate.Size,
                    modelEstimate.Confidence,
                    $"{modelEstimate.Size}, ürünün model referansına göre en mantıklı başlangıç.",
                    $"Ürün açıklamasında {modelEstimate.ModelHeightCm} cm modelin {modelEstimate.Size} beden giydiği yazıyor. Sen {profile.HeightCm:0.#} cm olduğun için, ürün ölçüsü okunmadan {modelEstimate.Size} bedenin üstüne çıkmak desteklenmiyor. {fitText} Modelin göğüs ve kilo bilgisi verilmediğinden bu sonuç kesinlik değil, fakat L seçmekten daha güçlü ürün kanıtına dayanıyor.",
                    [
                        "Model boyu ve giydiği beden doğrudan ürün açıklamasından okundu.",
                        "Modelin bilinmeyen göğüs ölçüsü uydurulmadı.",
                        "Ürün ölçü paneli açıldığında göğüs eni bu model referansından daha güçlü kanıt sayılır."
                    ],
                    [
                        new ComparisonDto(
                            "Model referansı",
                            $"{modelEstimate.ModelHeightCm} cm model · {modelEstimate.Size} beden"),
                        new ComparisonDto(
                            "Boy karşılaştırması",
                            $"Sen {profile.HeightCm:0.#} cm · modelden {Math.Abs(modelEstimate.HeightDifferenceCm):0.#} cm {(modelEstimate.HeightDifferenceCm <= 0 ? "kısasın" : "uzunsun")}")
                    ],
                    BuildEvidenceSummary(relevantOrders),
                    "local-model-reference");
            }

            var bodySizeEstimate = EstimateUpperBodyLabelSize(
                profile,
                request.Product,
                availableSizes);
            if (bodySizeEstimate is not null)
            {
                var fit = ProductFit(request.Product);
                var fitContext = fit == ProductFitKind.Unknown
                    ? "Resmi kalıp etiketi okunamadığı için ayrıca beden büyütülmedi."
                    : $"{FitKindLabel(fit)} kesim ürünün siluetini değiştirir; beden etiketi tek başına büyütülmedi.";
                return new RecommendationResult(
                    bodySizeEstimate.SelectedSize,
                    bodySizeEstimate.Confidence,
                    $"{bodySizeEstimate.SelectedSize}, vücut ölçüne göre başlangıç tahmini.",
                    $"Ürünün parça ölçüleri henüz okunamadı. {bodySizeEstimate.ChestCm:0.#} cm göğüs çevren {bodySizeEstimate.BodySize} üst giyim aralığına denk geliyor; sayfadaki mevcut seçeneklerden {bodySizeEstimate.SelectedSize} seçildi. {fitContext} Bu, ürün ölçü tablosu açıldığında yeniden hesaplanması gereken düşük güvenli bir tahmindir.",
                    [
                        "Boy veya kilodan göğüs ölçüsü üretilmedi; profile girdiğin gerçek göğüs çevresi kullanıldı.",
                        "Tişört, mont veya pantolon geçmişi bu kategoriye taşınmadı.",
                        "Ürün ölçülerini açıp yeniden taramak göğüs eni ve omuz karşılaştırmasını etkinleştirir."
                    ],
                    [
                        new ComparisonDto(
                            "Göğüs çevresi",
                            $"Profil {bodySizeEstimate.ChestCm:0.#} cm · {bodySizeEstimate.BodySize} referans aralığı {bodySizeEstimate.RangeLow:0}-{bodySizeEstimate.RangeHigh:0} cm"),
                        new ComparisonDto(
                            "Mevcut beden",
                            $"Sayfada {string.Join(", ", availableSizes)} · başlangıç seçimi {bodySizeEstimate.SelectedSize}")
                    ],
                    BuildEvidenceSummary(relevantOrders),
                    "local-body-label-estimate");
            }

            return new RecommendationResult(
                "Bilinmiyor",
                22,
                "Bu tabloyla güvenilir beden çıkarılamadı.",
                "Ürün tablosundaki ölçüler profilindeki ölçülerle aynı türde değil. FitMemory artık ortadaki bedeni seçmiyor ve boy/kilodan göğüs genişliği uydurmuyor.",
                [
                    "Göğüs eni ile omuz genişliği birbirinin yerine kullanılmadı.",
                    "Göğüs çevreni profile ekleyin veya aynı kategoriden ölçülü bir iyi uyum kaydı oluşturun."
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
        var explanation = BuildExplanation(best.Candidate, comparisons, profile, relevantOrders);
        var fitNotes = BuildFitNotes(
            profile,
            relevantOrders,
            sameFamilyOrders,
            best);

        return new RecommendationResult(
            best.Candidate.Label,
            confidence,
            $"{best.Candidate.Label}, ölçülerinize en güçlü eşleşme.",
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
            var normalized = headers[index].ToLowerInvariant();
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
        var normalized = header.ToLowerInvariant();
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
        if (metric is not ("Chest" or "Waist" or "Hip"))
        {
            return Linear;
        }
        if (header.Contains("width", StringComparison.Ordinal) ||
            header.Contains("flat", StringComparison.Ordinal) ||
            header.Contains("half", StringComparison.Ordinal) ||
            header.Contains("1/2", StringComparison.Ordinal))
        {
            return Width;
        }
        if (header.Contains("circum", StringComparison.Ordinal) ||
            header.Contains("body", StringComparison.Ordinal) ||
            value >= 78)
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
        AddHistoryTarget(targets, "Shoulder", kept, order => order.ShoulderWidthCm, Linear, profile.FitPreference);
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
            AddUnverifiedTarget(targets, "Shoulder", unverified, order => order.ShoulderWidthCm, Linear);
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
            (double)profile.ShoulderWidthCm,
            Linear,
            "Vücut profili",
            0.65));
        if (profile.ChestCircumferenceCm.HasValue)
        {
            targets.TryAdd("Chest", new TargetMetric(
                (double)profile.ChestCircumferenceCm.Value / 2 +
                ChestEaseWidth(product, profile.FitPreference),
                Width,
                "Göğüs çevresi + hareket payı",
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
            var tolerance = Tolerances.GetValueOrDefault(metric, 4.0);
            score += Math.Abs(measurement.Value - targetValue) / tolerance * target.Strength;
            matched++;
        }

        var structuralFit = EvaluateStructuralFit(
            candidate,
            profile,
            product);
        score += structuralFit.Penalty;
        score += ReturnBoundaryPenalty(
            candidate,
            orders,
            sameFamilyOrders);
        return new CandidateScore(
            candidate,
            score / Math.Max(matched, 1),
            matched,
            structuralFit.IsPlausible,
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
                shoulder.Value - (double)profile.ShoulderWidthCm;
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
                out var chest) &&
            chest.Kind == Width)
        {
            var bodyHalfChest =
                (double)profile.ChestCircumferenceCm.Value / 2;
            var garmentEase = chest.Value - bodyHalfChest;
            var chestBounds = fit switch
            {
                ProductFitKind.Slim => (1.0, 5.0),
                ProductFitKind.Regular => (2.0, 7.0),
                ProductFitKind.Relaxed => (3.5, 9.5),
                ProductFitKind.Boxy => (3.5, 8.5),
                ProductFitKind.Oversized => (5.0, 12.0),
                _ => (1.5, 8.5)
            };
            var categoryAllowance = IsOuterwear(product) ? 2.5 : 0.0;
            if (garmentEase < chestBounds.Item1 ||
                garmentEase > chestBounds.Item2 + categoryAllowance)
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
        var fit = ProductFit(product);
        if (fit != ProductFitKind.Unknown)
        {
            var officialFitEase = fit switch
            {
                ProductFitKind.Slim => 3.0,
                ProductFitKind.Regular => 4.5,
                ProductFitKind.Relaxed => 6.0,
                ProductFitKind.Boxy => 6.0,
                ProductFitKind.Oversized => 8.5,
                _ => 5.0
            };
            return officialFitEase + (IsOuterwear(product) ? 2.5 : 0.0);
        }

        return preference switch
        {
            FitPreference.Slim => 3.0,
            FitPreference.Relaxed => 6.0,
            FitPreference.Oversized => 8.0,
            _ => 5.0
        };
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
            penalty += BoundaryPenalty(candidate, "Shoulder", order.ShoulderWidthCm, Linear, order.Outcome, 1.8);
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
                    "Shoulder" => BoundaryPenalty(candidate, "Shoulder", order.ShoulderWidthCm, Linear, outcome.Value, 2.4),
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
        var scorePenalty = (int)Math.Round(Math.Min(best.Score * 7, 28));
        var confidence =
            48 +
            Math.Min(keptCount * 6, 18) +
            Math.Min(feedbackCount * 3, 9) +
            Math.Min(historyTargets * 3, 12) +
            Math.Min(best.MatchedMetrics * 2, 8) -
            scorePenalty;
        return Math.Clamp(confidence, 35, 92);
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
                    item.Value.Kind == Width &&
                    profile.ChestCircumferenceCm.HasValue)
                {
                    var bodyCircumference =
                        (double)profile.ChestCircumferenceCm.Value;
                    var garmentCircumference = item.Value.Value * 2;
                    var totalEase =
                        garmentCircumference - bodyCircumference;
                    return new ComparisonDto(
                        MetricLabel(item.Key),
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
        IReadOnlyList<OrderHistoryItem> orders)
    {
        if (comparisons.Count > 0)
        {
            var primary = comparisons[0];
            var evidence = orders.Any(order => order.Outcome == OrderOutcome.KeptGoodFit)
                ? "iyi uyduğu doğrulanmış ürün tabanınıza"
                : "vücut profilinize";
            return $"{primary.Detail}. Bu değer, {PreferenceLabel(profile.FitPreference)} kalıp için {evidence} en yakın seçenektir.";
        }

        return $"{candidate.Label}, kayıtlı profilinize ve {PreferenceLabel(profile.FitPreference)} tercihinize en yakın seçenektir.";
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
