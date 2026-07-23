using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed record StyleOutfitDraft(
    string Title,
    string Direction,
    IReadOnlyList<int> PieceOrderIds);

public sealed class WardrobeStylistService(
    ProductCategoryService categoryService,
    ProductIdentityService identityService)
{
    private const int MaxOutfits = 48;

    public IReadOnlyList<OrderHistoryItem> SelectRequestedOutfit(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        string userRequest)
    {
        var season = CurrentSeason();
        var request = userRequest.Trim().ToLowerInvariant();
        var ranked = wardrobe
            .Where(order => order.Outcome.IsInCloset())
            .Where(IsReliableStylePiece)
            .Select(order => new RankedItem(
                order,
                EvidenceWeight(order) +
                SeasonWeight(order, season) +
                RequestWeight(order, request)))
            .Where(candidate => candidate.Score > 0)
            .OrderByDescending(candidate => candidate.Score)
            .ThenByDescending(candidate => candidate.Order.UpdatedAt)
            .ToArray();

        var uppers = ranked
            .Where(candidate => StyleSlot(categoryService.GetGroup(candidate.Order)) == "upper")
            .Take(8)
            .ToArray();
        var bottoms = ranked
            .Where(candidate => StyleSlot(categoryService.GetGroup(candidate.Order)) == "bottom")
            .Take(8)
            .ToArray();
        var dresses = ranked
            .Where(candidate => StyleSlot(categoryService.GetGroup(candidate.Order)) == "dress")
            .Take(6)
            .ToArray();
        var footwear = ranked
            .Where(candidate => StyleSlot(categoryService.GetGroup(candidate.Order)) == "footwear")
            .Take(6)
            .ToArray();
        var outerwear = ranked
            .Where(candidate => StyleSlot(categoryService.GetGroup(candidate.Order)) == "outerwear")
            .Where(candidate => SeasonWeight(candidate.Order, season) > -20)
            .Take(6)
            .ToArray();

        var bases = new List<RankedOutfit>();
        foreach (var upper in uppers)
        {
            foreach (var bottom in bottoms)
            {
                bases.Add(new RankedOutfit(
                    [upper.Order, bottom.Order],
                    upper.Score + bottom.Score +
                    PairCompatibilityScore(upper.Order, bottom.Order)));
            }
        }
        foreach (var dress in dresses)
        {
            bases.Add(new RankedOutfit([dress.Order], dress.Score + 8));
        }

        var bestBase = bases
            .OrderByDescending(candidate => candidate.Score)
            .FirstOrDefault();
        if (bestBase is null)
        {
            return [];
        }

        var selected = bestBase.Orders.ToList();
        var asksForOuterwear = ContainsAny(
            request,
            "ceket", "mont", "kaban", "trenç", "trenc", "jacket",
            "coat", "outerwear", "katman", "layer");
        var wantsSeasonalLayer = season.Kind switch
        {
            StyleSeason.Winter => true,
            StyleSeason.Spring or StyleSeason.Autumn => asksForOuterwear,
            _ => false
        };
        if (wantsSeasonalLayer && outerwear.Length > 0)
        {
            var layer = outerwear
                .OrderByDescending(candidate =>
                    candidate.Score + selected.Sum(item =>
                        PairCompatibilityScore(item, candidate.Order)))
                .First();
            selected.Add(layer.Order);
        }

        var asksForFootwear = ContainsAny(
            request,
            "ayakkabı", "ayakkabi", "sneaker", "loafer", "bot", "çizme",
            "cizme", "shoe", "boot", "footwear");
        if (asksForFootwear && footwear.Length > 0)
        {
            var shoe = footwear
                .OrderByDescending(candidate =>
                    candidate.Score + selected.Sum(item =>
                        PairCompatibilityScore(item, candidate.Order)))
                .First();
            selected.Add(shoe.Order);
        }

        if (selected.Count == 1)
        {
            var companion = footwear
                .Concat(outerwear)
                .OrderByDescending(candidate =>
                    candidate.Score + PairCompatibilityScore(
                        selected[0], candidate.Order))
                .FirstOrDefault();
            if (companion is not null)
            {
                selected.Add(companion.Order);
            }
        }

        return selected
            .DistinctBy(order => order.Id)
            .Take(4)
            .ToArray();
    }

    public WardrobeStyleDto BuildLocal(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        ProductDto activeProduct)
    {
        var activeGroup = categoryService.GetGroup(activeProduct);
        var season = CurrentSeason();
        var candidates = EligibleItems(wardrobe, activeProduct)
            .Select(order => new RankedItem(
                order,
                CompatibilityWeight(activeGroup, categoryService.GetGroup(order)) +
                EvidenceWeight(order) +
                SeasonWeight(order, season)))
            .OrderByDescending(candidate => candidate.Score)
            .ThenByDescending(candidate => candidate.Order.UpdatedAt)
            .ToArray();
        var ageContext =
            $"{season.MonthName} · {season.Label}. {BuildAgeContext(profile.Age)}";

        if (candidates.Length == 0)
        {
            return new WardrobeStyleDto(
                0,
                0,
                42,
                $"{season.MonthName} için eşleşme bulunamadı",
                "İade edilmeyen, mevsime ve tamamlayıcı kategoriye uyan bir parça henüz dolabında görünmüyor.",
                ageContext,
                []);
        }

        var outfits = BuildOutfits(
            profile,
            activeProduct,
            activeGroup,
            candidates,
            season);
        var measuredCount = candidates.Count(candidate =>
            candidate.Order.ResearchConfidence >= 60);
        var imageCount = candidates.Count(candidate =>
            !string.IsNullOrWhiteSpace(candidate.Order.ImageUrl));
        var confidence = Math.Clamp(
            50 +
            Math.Min(candidates.Length * 4, 18) +
            Math.Min(measuredCount * 3, 9) +
            Math.Min(imageCount * 2, 8),
            45,
            88);

        return new WardrobeStyleDto(
            candidates.Length,
            outfits.Count,
            confidence,
            $"{season.MonthName} için {outfits.Count} gerçek kombin",
            outfits.Count == 0
                ? $"Dolapta {candidates.Length} uyumlu parça var; fakat tam ve mevsime uygun bir görünüm kurmak için tamamlayıcı kategori eksik."
                : $"{outfits.Count} benzersiz görünüm; {season.Label.ToLowerInvariant()} koşulları, renk ilişkisi, kesim dengesi ve doğrulanmış dolap kayıtlarına göre sıralandı.",
            ageContext,
            outfits);
    }

    public WardrobeStyleDto EnrichWithAi(
        WardrobeStyleDto baseline,
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        ProductDto activeProduct,
        string headline,
        string summary,
        int confidence,
        IReadOnlyList<StyleOutfitDraft> drafts)
    {
        var allowed = EligibleItems(wardrobe, activeProduct)
            .ToDictionary(order => order.Id);
        var baselineSignatures = baseline.Outfits
            .ToDictionary(
                outfit => OutfitSignature(outfit.Pieces),
                outfit => outfit,
                StringComparer.Ordinal);
        var aiDirections = new Dictionary<string, string>(
            StringComparer.Ordinal);

        foreach (var draft in drafts.Take(8))
        {
            var selected = draft.PieceOrderIds
                .Distinct()
                .Where(allowed.ContainsKey)
                .Select(id => allowed[id])
                .GroupBy(
                    order => StyleSlot(categoryService.GetGroup(order)),
                    StringComparer.Ordinal)
                .Select(group => group.First())
                .Take(4)
                .ToArray();
            if (selected.Length == 0 ||
                !HasConcreteStyleRationale(draft.Direction))
            {
                continue;
            }

            var signature = OutfitSignature(
                selected.Select(order => order.Id));
            if (!baselineSignatures.ContainsKey(signature) ||
                aiDirections.ContainsKey(signature))
            {
                continue;
            }
            if (!HasLocalStyleEvidence(activeProduct, selected))
            {
                continue;
            }

            aiDirections[signature] = Limit(
                draft.Direction.Trim(),
                300);
        }

        if (baseline.Outfits.Count == 0)
        {
            return baseline with
            {
                OutfitCount = 0,
                Confidence = Math.Min(baseline.Confidence, 58),
                Headline = "Zorlamadan bekletildi",
                Summary =
                    "Dolapta tamamlayıcı parçalar var; fakat renk, kesim ve siluet ilişkisi yeterince güçlü doğrulanmadığı için sırf sayı tamamlamak adına kombin üretilmedi.",
                Outfits = []
            };
        }

        var outfits = baseline.Outfits
            .Select(outfit =>
            {
                var signature = OutfitSignature(outfit.Pieces);
                return aiDirections.TryGetValue(signature, out var direction)
                    ? outfit with { Direction = direction }
                    : outfit;
            })
            .ToArray();
        var evidenceCap = Math.Clamp(
            56 +
            Math.Min(allowed.Count * 4, 20) +
            Math.Min(
                allowed.Values.Count(order =>
                    !string.IsNullOrWhiteSpace(order.ImageUrl)) * 2,
                10),
            56,
            90);
        var season = CurrentSeason();
        var aiCount = aiDirections.Count;

        return new WardrobeStyleDto(
            baseline.CompatibleItemCount,
            outfits.Length,
            Math.Clamp(Math.Min(confidence, evidenceCap), 40, 90),
            $"{season.MonthName} için {outfits.Length} gerçek kombin",
            Limit(
                $"{outfits.Length} benzersiz görünüm dolabındaki gerçek parçalarla kuruldu. " +
                (aiCount > 0
                    ? $"{aiCount} görünümde görsel renk ve siluet değerlendirmesi AI tarafından ayrıntılandırıldı."
                    : "Renk veya görsel kanıt eksik olduğunda yerel stil motorunun doğrulanabilir eşleşmeleri korundu."),
                500),
            baseline.AgeContext,
            outfits);
    }

    private IReadOnlyList<StyleOutfitDto> BuildOutfits(
        UserProfile profile,
        ProductDto activeProduct,
        ProductCategoryGroup activeGroup,
        IReadOnlyList<RankedItem> candidates,
        SeasonContext season)
    {
        var desiredSlots = DesiredSlots(activeGroup);
        var requiredSlots = RequiredSlots(activeGroup);
        foreach (var required in requiredSlots)
        {
            if (!candidates.Any(candidate =>
                    required.Contains(categoryService.GetGroup(
                        candidate.Order))))
            {
                return [];
            }
        }

        var slotOptions = desiredSlots
            .Select(slot => candidates
                .Where(candidate =>
                    slot.Contains(categoryService.GetGroup(
                        candidate.Order)))
                .Where(candidate =>
                    SeasonWeight(candidate.Order, season) > -40)
                .GroupBy(candidate => candidate.Order.Id)
                .Select(group => group.First())
                .OrderByDescending(candidate => candidate.Score)
                .ToArray())
            .Where(options => options.Length > 0)
            .ToArray();
        if (slotOptions.Length == 0)
        {
            return [];
        }

        var ranked = new List<RankedOutfit>();
        var current = new List<RankedItem>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        void Enumerate(int slotIndex)
        {
            if (ranked.Count >= 5_000)
            {
                return;
            }

            if (slotIndex == slotOptions.Length)
            {
                var selected = current
                    .Select(candidate => candidate.Order)
                    .ToArray();
                if (!IsCoherentSelection(activeGroup, selected) ||
                    !IsWearableSelection(activeProduct, selected, season))
                {
                    return;
                }

                var signature = OutfitSignature(
                    selected.Select(order => order.Id));
                if (!seen.Add(signature))
                {
                    return;
                }

                ranked.Add(new RankedOutfit(
                    selected,
                    OutfitQualityScore(
                        activeProduct,
                        selected,
                        current.Sum(candidate => candidate.Score),
                        season)));
                return;
            }

            foreach (var option in slotOptions[slotIndex])
            {
                current.Add(option);
                Enumerate(slotIndex + 1);
                current.RemoveAt(current.Count - 1);
            }
        }

        Enumerate(0);

        return ranked
            .OrderByDescending(outfit => outfit.Score)
            .ThenByDescending(outfit =>
                outfit.Orders.Sum(order => order.ResearchConfidence))
            .Take(MaxOutfits)
            .Select((outfit, index) => new StyleOutfitDto(
                $"{season.Label} görünüm {index + 1:00}",
                BuildDirection(
                    profile,
                    activeProduct,
                    outfit.Orders,
                    index,
                    season),
                outfit.Orders
                    .Select(order => ToPiece(order, activeProduct))
                    .ToArray()))
            .ToArray();
    }

    private static bool HasConcreteStyleRationale(string direction)
    {
        if (string.IsNullOrWhiteSpace(direction))
        {
            return false;
        }

        var value = direction.ToLowerInvariant();
        var hasColor = new[]
        {
            "siyah", "beyaz", "gri", "füme", "antrasit", "mavi",
            "lacivert", "indigo", "bej", "ekru", "krem",
            "kahverengi", "taba", "yeşil", "haki", "kırmızı",
            "bordo", "pembe", "mor", "sarı", "turuncu",
            "black", "white", "grey", "gray", "blue", "navy",
            "beige", "brown", "green", "khaki", "red"
        }.Any(color => value.Contains(color, StringComparison.Ordinal));
        var hasSilhouette = new[]
        {
            "siluet", "kesim", "hacim", "oran", "paça", "gövde",
            "omuz", "katman", "boy", "fit", "dar", "geniş",
            "rahat", "boxy", "relaxed", "regular", "baggy",
            "straight", "slim", "oversize"
        }.Any(term => value.Contains(term, StringComparison.Ordinal));
        return hasColor && hasSilhouette;
    }

    private static bool HasLocalStyleEvidence(
        ProductDto activeProduct,
        IReadOnlyList<OrderHistoryItem> selected)
    {
        var activeColor = DetectColor(
            $"{activeProduct.Name} {activeProduct.Description}");
        if (activeColor is null && !IsPublicImageUrl(activeProduct.ImageUrl))
        {
            return false;
        }

        return selected.All(order =>
            DetectColor($"{order.ProductName} {order.FitNotes}") is not null ||
            IsPublicImageUrl(order.ImageUrl));
    }

    private IReadOnlyList<OrderHistoryItem> EligibleItems(
        IReadOnlyList<OrderHistoryItem> wardrobe,
        ProductDto activeProduct)
    {
        var activeGroup = categoryService.GetGroup(activeProduct);
        return wardrobe
            .Where(order => order.Outcome.IsInCloset())
            .Where(IsReliableStylePiece)
            .Where(order => !identityService.IsSameFamily(order, activeProduct))
            .Where(order =>
                CompatibilityWeight(
                    activeGroup,
                    categoryService.GetGroup(order)) > 0)
            .GroupBy(order => order.Id)
            .Select(group => group.First())
            .ToArray();
    }

    private static bool IsReliableStylePiece(OrderHistoryItem order)
    {
        return order.Outcome switch
        {
            OrderOutcome.KeptGoodFit => true,
            OrderOutcome.KeptTooBaggy or
            OrderOutcome.KeptTooTight =>
                order.FitScore is >= 55 &&
                order.ResearchConfidence >= 55 &&
                IsPublicImageUrl(order.ImageUrl),
            OrderOutcome.PurchasedUnknownFit =>
                order.FitScore is >= 72 &&
                order.ResearchConfidence >= 65,
            _ => false
        };
    }

    private static bool IsWearableSelection(
        ProductDto activeProduct,
        IReadOnlyList<OrderHistoryItem> selected,
        SeasonContext season)
    {
        if (selected.Any(order =>
                order.Outcome == OrderOutcome.KeptTooTight &&
                ContainsAny(
                    $"{order.UserFitNotes} {order.FitAssessment}"
                        .ToLowerInvariant(),
                    "rahatsız", "rahatsiz", "hareket", "otur",
                    "kapanm", "acı", "aci")))
        {
            return false;
        }

        var volumes = new[]
            {
                SilhouetteVolume(
                    $"{activeProduct.FitLabel} {activeProduct.Name}")
            }
            .Concat(selected.Select(order => SilhouetteVolume(
                $"{order.FitLabel} {order.ProductName}")))
            .ToArray();
        if (volumes.Length >= 3 &&
            volumes.Count(volume => volume >= 2) >= 3)
        {
            return false;
        }

        var outfitText = (
            $"{activeProduct.Name} {activeProduct.Category} {activeProduct.Description} " +
            string.Join(
                " ",
                selected.Select(order =>
                    $"{order.ProductName} {order.Category} {order.FitLabel}")))
            .ToLowerInvariant();
        var hasMiniBottom = ContainsAny(
            outfitText,
            "mini etek", "mini skirt", "mini denim");
        var hasTrench = ContainsAny(
            outfitText,
            "trenç", "trenc", "trench");
        if (hasMiniBottom &&
            hasTrench &&
            season.Kind == StyleSeason.Summer)
        {
            return false;
        }

        var colors = new[]
            {
                DetectColor(
                    $"{activeProduct.Name} {activeProduct.Description}")
            }
            .Concat(selected.Select(order => DetectColor(
                $"{order.ProductName} {order.FitNotes}")))
            .Where(color => color is not null)
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var saturatedColors = colors
            .Where(color => !IsNeutral(color))
            .ToArray();
        return saturatedColors.Length <= 2;
    }

    private static bool IsPublicImageUrl(string? value)
    {
        return Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
               uri.Scheme == Uri.UriSchemeHttps &&
               !uri.IsLoopback;
    }

    private bool IsCoherentSelection(
        ProductCategoryGroup activeGroup,
        IReadOnlyList<OrderHistoryItem> selected)
    {
        var groups = selected
            .Select(categoryService.GetGroup)
            .ToHashSet();
        return activeGroup switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops =>
                groups.Contains(ProductCategoryGroup.Bottoms) ||
                groups.Contains(ProductCategoryGroup.Footwear),
            ProductCategoryGroup.Bottoms =>
                groups.Any(group => group is
                    ProductCategoryGroup.Tees or
                    ProductCategoryGroup.Shirts or
                    ProductCategoryGroup.Knitwear or
                    ProductCategoryGroup.Tops),
            ProductCategoryGroup.Outerwear =>
                groups.Any(group => group is
                    ProductCategoryGroup.Tees or
                    ProductCategoryGroup.Shirts or
                    ProductCategoryGroup.Knitwear or
                    ProductCategoryGroup.Tops) &&
                groups.Contains(ProductCategoryGroup.Bottoms),
            ProductCategoryGroup.Dresses =>
                groups.Contains(ProductCategoryGroup.Footwear) ||
                groups.Contains(ProductCategoryGroup.Outerwear),
            _ => selected.Count > 0
        };
    }

    private StylePieceDto ToPiece(
        OrderHistoryItem order,
        ProductDto activeProduct)
    {
        return new StylePieceDto(
            order.Id,
            order.Brand,
            order.ProductName,
            order.Category,
            order.PurchasedSize,
            order.ImageUrl,
            order.ProductUrl ?? order.ResearchSourceUrl,
            RoleLabel(categoryService.GetGroup(order)),
            BuildCompatibilityReason(activeProduct, order));
    }

    private static int EvidenceWeight(OrderHistoryItem order)
    {
        var outcome = order.Outcome switch
        {
            OrderOutcome.KeptGoodFit => 24,
            OrderOutcome.KeptTooBaggy or
            OrderOutcome.KeptTooTight => 10,
            _ => 7
        };
        var research = Math.Clamp(order.ResearchConfidence / 5, 0, 18);
        var fit = order.FitScore is int score
            ? Math.Clamp(score / 10, 0, 9)
            : 0;
        var media = string.IsNullOrWhiteSpace(order.ImageUrl) ? 0 : 4;
        return outcome + research + fit + media;
    }

    private static int RequestWeight(
        OrderHistoryItem order,
        string request)
    {
        if (string.IsNullOrWhiteSpace(request))
        {
            return 0;
        }

        var product = $"{order.ProductName} {order.Category} {order.FitLabel} {order.MaterialSummary}"
            .ToLowerInvariant();
        var meaningfulTerms = request
            .Split(
                [' ', ',', '.', ';', ':', '/', '\\', '-', '_'],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(term => term.Length >= 4)
            .Distinct(StringComparer.Ordinal)
            .Take(16);
        return meaningfulTerms.Sum(term =>
            product.Contains(term, StringComparison.Ordinal) ? 8 : 0);
    }

    private static int PairCompatibilityScore(
        OrderHistoryItem first,
        OrderHistoryItem second)
    {
        var firstColor = DetectColor(
            $"{first.ProductName} {first.FitNotes} {first.MaterialSummary}");
        var secondColor = DetectColor(
            $"{second.ProductName} {second.FitNotes} {second.MaterialSummary}");
        var firstVolume = SilhouetteVolume(
            $"{first.FitLabel} {first.ProductName} {first.FitAssessment}");
        var secondVolume = SilhouetteVolume(
            $"{second.FitLabel} {second.ProductName} {second.FitAssessment}");
        return ColorPairScore(firstColor, secondColor) +
               SilhouettePairScore(firstVolume, secondVolume);
    }

    private static int CompatibilityWeight(
        ProductCategoryGroup active,
        ProductCategoryGroup candidate)
    {
        if (active == candidate)
        {
            return 0;
        }

        return active switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops => candidate switch
            {
                ProductCategoryGroup.Bottoms => 100,
                ProductCategoryGroup.Footwear => 92,
                ProductCategoryGroup.Outerwear => 78,
                ProductCategoryGroup.Accessories => 55,
                _ => 0
            },
            ProductCategoryGroup.Bottoms => candidate switch
            {
                ProductCategoryGroup.Tees or
                ProductCategoryGroup.Shirts or
                ProductCategoryGroup.Knitwear or
                ProductCategoryGroup.Tops => 100,
                ProductCategoryGroup.Footwear => 92,
                ProductCategoryGroup.Outerwear => 72,
                ProductCategoryGroup.Accessories => 50,
                _ => 0
            },
            ProductCategoryGroup.Outerwear => candidate switch
            {
                ProductCategoryGroup.Tees or
                ProductCategoryGroup.Shirts or
                ProductCategoryGroup.Knitwear or
                ProductCategoryGroup.Tops => 100,
                ProductCategoryGroup.Bottoms => 98,
                ProductCategoryGroup.Footwear => 82,
                ProductCategoryGroup.Accessories => 48,
                ProductCategoryGroup.Dresses => 78,
                _ => 0
            },
            ProductCategoryGroup.Dresses => candidate switch
            {
                ProductCategoryGroup.Footwear => 100,
                ProductCategoryGroup.Outerwear => 90,
                ProductCategoryGroup.Accessories => 82,
                _ => 0
            },
            ProductCategoryGroup.Footwear => candidate switch
            {
                ProductCategoryGroup.Bottoms => 100,
                ProductCategoryGroup.Dresses => 96,
                ProductCategoryGroup.Tees or
                ProductCategoryGroup.Shirts or
                ProductCategoryGroup.Knitwear or
                ProductCategoryGroup.Tops => 84,
                ProductCategoryGroup.Outerwear => 62,
                _ => 0
            },
            ProductCategoryGroup.Accessories => candidate switch
            {
                ProductCategoryGroup.Tees or
                ProductCategoryGroup.Shirts or
                ProductCategoryGroup.Knitwear or
                ProductCategoryGroup.Tops or
                ProductCategoryGroup.Bottoms or
                ProductCategoryGroup.Dresses or
                ProductCategoryGroup.Outerwear => 76,
                _ => 0
            },
            _ => candidate == ProductCategoryGroup.Other ? 0 : 45
        };
    }

    private static IReadOnlyList<IReadOnlyList<ProductCategoryGroup>> DesiredSlots(
        ProductCategoryGroup active)
    {
        return active switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops =>
            [
                [ProductCategoryGroup.Bottoms],
                [ProductCategoryGroup.Outerwear],
                [ProductCategoryGroup.Footwear],
                [ProductCategoryGroup.Accessories]
            ],
            ProductCategoryGroup.Bottoms =>
            [
                [
                    ProductCategoryGroup.Tees,
                    ProductCategoryGroup.Shirts,
                    ProductCategoryGroup.Knitwear,
                    ProductCategoryGroup.Tops
                ],
                [ProductCategoryGroup.Outerwear],
                [ProductCategoryGroup.Footwear],
                [ProductCategoryGroup.Accessories]
            ],
            ProductCategoryGroup.Outerwear =>
            [
                [
                    ProductCategoryGroup.Tees,
                    ProductCategoryGroup.Shirts,
                    ProductCategoryGroup.Knitwear,
                    ProductCategoryGroup.Tops
                ],
                [ProductCategoryGroup.Bottoms],
                [ProductCategoryGroup.Footwear],
                [ProductCategoryGroup.Accessories]
            ],
            ProductCategoryGroup.Dresses =>
            [
                [ProductCategoryGroup.Outerwear],
                [ProductCategoryGroup.Footwear],
                [ProductCategoryGroup.Accessories]
            ],
            ProductCategoryGroup.Footwear =>
            [
                [ProductCategoryGroup.Bottoms],
                [
                    ProductCategoryGroup.Tees,
                    ProductCategoryGroup.Shirts,
                    ProductCategoryGroup.Knitwear,
                    ProductCategoryGroup.Tops
                ],
                [ProductCategoryGroup.Outerwear],
                [ProductCategoryGroup.Accessories]
            ],
            _ =>
            [
                [
                    ProductCategoryGroup.Tees,
                    ProductCategoryGroup.Shirts,
                    ProductCategoryGroup.Knitwear,
                    ProductCategoryGroup.Tops
                ],
                [ProductCategoryGroup.Bottoms],
                [
                    ProductCategoryGroup.Outerwear,
                    ProductCategoryGroup.Dresses
                ],
                [ProductCategoryGroup.Footwear],
                [ProductCategoryGroup.Accessories]
            ]
        };
    }

    private static IReadOnlyList<IReadOnlyList<ProductCategoryGroup>> RequiredSlots(
        ProductCategoryGroup active)
    {
        IReadOnlyList<ProductCategoryGroup> upper =
        [
            ProductCategoryGroup.Tees,
            ProductCategoryGroup.Shirts,
            ProductCategoryGroup.Knitwear,
            ProductCategoryGroup.Tops
        ];

        return active switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops =>
            [
                [ProductCategoryGroup.Bottoms]
            ],
            ProductCategoryGroup.Bottoms =>
            [
                upper
            ],
            ProductCategoryGroup.Outerwear =>
            [
                upper,
                [ProductCategoryGroup.Bottoms]
            ],
            ProductCategoryGroup.Dresses =>
            [
                [
                    ProductCategoryGroup.Footwear,
                    ProductCategoryGroup.Outerwear
                ]
            ],
            ProductCategoryGroup.Footwear or
            ProductCategoryGroup.Accessories =>
            [
                upper,
                [ProductCategoryGroup.Bottoms]
            ],
            _ => []
        };
    }

    private int SeasonWeight(
        OrderHistoryItem order,
        SeasonContext season)
    {
        var text =
            $"{order.ProductName} {order.Category} {order.FitLabel} {order.SizeEvidence}"
                .ToLowerInvariant();
        var group = categoryService.GetGroup(order);
        var isHeavy = ContainsAny(
            text,
            "şişme", "sisme", "puffer", "kaban", "coat", "parka",
            "yün", "yun", "wool", "kalın", "thick", "termal", "thermal");
        var isLight = ContainsAny(
            text,
            "keten", "linen", "ince", "lightweight", "hafif",
            "kısa kollu", "kisa kollu", "short sleeve", "şort", "sort",
            "sandal", "mesh");
        var isColdWeather = group is
            ProductCategoryGroup.Outerwear or
            ProductCategoryGroup.Knitwear ||
            ContainsAny(text, "bot", "boot", "çizme", "cizme", "atkı", "atki");

        return season.Kind switch
        {
            StyleSeason.Winter when isLight => -48,
            StyleSeason.Winter when isHeavy => 28,
            StyleSeason.Winter when isColdWeather => 18,
            StyleSeason.Summer when isHeavy => -55,
            StyleSeason.Summer when
                group == ProductCategoryGroup.Knitwear => -45,
            StyleSeason.Summer when
                group == ProductCategoryGroup.Outerwear && !isLight => -42,
            StyleSeason.Summer when isLight => 28,
            StyleSeason.Summer when
                group is ProductCategoryGroup.Tees or
                    ProductCategoryGroup.Shirts => 16,
            StyleSeason.Spring when isHeavy => -24,
            StyleSeason.Spring when isLight => 12,
            StyleSeason.Spring when
                group == ProductCategoryGroup.Outerwear => 10,
            StyleSeason.Autumn when isLight => -8,
            StyleSeason.Autumn when isHeavy => 8,
            StyleSeason.Autumn when
                group is ProductCategoryGroup.Outerwear or
                    ProductCategoryGroup.Knitwear => 18,
            _ => 4
        };
    }

    private static int OutfitQualityScore(
        ProductDto activeProduct,
        IReadOnlyList<OrderHistoryItem> selected,
        int evidenceScore,
        SeasonContext season)
    {
        var score = evidenceScore;
        var activeColor = DetectColor(
            $"{activeProduct.Name} {activeProduct.Description}");
        var activeVolume = SilhouetteVolume(
            $"{activeProduct.FitLabel} {activeProduct.Name} {activeProduct.Description}");

        foreach (var order in selected)
        {
            var color = DetectColor(
                $"{order.ProductName} {order.FitNotes} {order.SizeEvidence}");
            score += ColorPairScore(activeColor, color);

            var volume = SilhouetteVolume(
                $"{order.FitLabel} {order.ProductName} {order.FitAssessment}");
            score += SilhouettePairScore(activeVolume, volume);
        }

        for (var first = 0; first < selected.Count; first++)
        {
            for (var second = first + 1; second < selected.Count; second++)
            {
                score += ColorPairScore(
                    DetectColor(selected[first].ProductName),
                    DetectColor(selected[second].ProductName)) / 2;
            }
        }

        if (selected.All(order => IsPublicImageUrl(order.ImageUrl)))
        {
            score += 12;
        }
        if (season.Kind is StyleSeason.Spring or StyleSeason.Autumn &&
            selected.Any(order => ContainsAny(
                $"{order.ProductName} {order.Category}".ToLowerInvariant(),
                "ceket", "jacket", "overshirt", "hırka", "hirka", "cardigan")))
        {
            score += 8;
        }

        return score;
    }

    private static int ColorPairScore(string? first, string? second)
    {
        if (first is null || second is null)
        {
            return 0;
        }
        if (first == second)
        {
            return 12;
        }
        if (IsNeutral(first) || IsNeutral(second))
        {
            return 10;
        }

        var pair = new HashSet<string>(
            [first, second],
            StringComparer.Ordinal);
        if (pair.SetEquals(["mavi", "kahverengi"]) ||
            pair.SetEquals(["mavi", "turuncu"]) ||
            pair.SetEquals(["lacivert", "kırmızı"]) ||
            pair.SetEquals(["yeşil", "bej"]) ||
            pair.SetEquals(["yeşil", "kahverengi"]) ||
            pair.SetEquals(["mor", "sarı"]) ||
            pair.SetEquals(["pembe", "mavi"]))
        {
            return 8;
        }

        return -8;
    }

    private static int SilhouettePairScore(int first, int second)
    {
        if (first >= 2 && second >= 2)
        {
            return -10;
        }
        if (first >= 1 && second <= 0 ||
            second >= 1 && first <= 0)
        {
            return 10;
        }
        if (Math.Abs(first - second) <= 1)
        {
            return 5;
        }
        return 0;
    }

    private static int SilhouetteVolume(string value)
    {
        var text = value.ToLowerInvariant();
        if (ContainsAny(
                text,
                "super baggy", "ultra baggy", "oversize", "oversized"))
        {
            return 2;
        }
        if (ContainsAny(
                text,
                "baggy", "wide leg", "relaxed", "boxy", "loose"))
        {
            return 1;
        }
        if (ContainsAny(
                text,
                "skinny", "slim", "muscle", "fitted", "dar kesim"))
        {
            return -1;
        }
        return 0;
    }

    private static string BuildDirection(
        UserProfile profile,
        ProductDto activeProduct,
        IReadOnlyList<OrderHistoryItem> selected,
        int variant,
        SeasonContext season)
    {
        var colors = new[]
            {
                DetectColor(
                    $"{activeProduct.Name} {activeProduct.Description}")
            }
            .Concat(selected.Select(order => DetectColor(
                $"{order.ProductName} {order.FitNotes}")))
            .Where(color => color is not null)
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .Take(3)
            .ToArray();
        var palette = colors.Length switch
        {
            0 => "ürün görsellerindeki doğrulanmış palet",
            1 => $"{colors[0]} ton sür ton palet",
            _ => string.Join("–", colors) + " paleti"
        };

        var activeVolume = SilhouetteVolume(
            $"{activeProduct.FitLabel} {activeProduct.Name} {activeProduct.Description}");
        var selectedVolumes = selected
            .Select(order => SilhouetteVolume(
                $"{order.FitLabel} {order.ProductName} {order.FitAssessment}"))
            .ToArray();
        var silhouette = activeVolume switch
        {
            >= 2 when selectedVolumes.Any(volume => volume <= 0) =>
                "oversize/baggy ana hacmi daha kontrollü tamamlayıcı kesimlerle dengeler",
            >= 1 when selectedVolumes.Any(volume => volume <= 0) =>
                "rahat ana kesimi daha düz bir karşı siluetle dengeler",
            >= 1 =>
                "hacimli streetwear oranını bilinçli biçimde baştan ayağa sürdürür",
            <= 0 when selectedVolumes.Any(volume => volume >= 1) =>
                "temiz ana hattı rahat alt veya katman hacmiyle hareketlendirir",
            _ =>
                "regular ve düz kesimleri sakin, tekrar giyilebilir bir oranda tutar"
        };
        var ageLead = profile.Age is int age
            ? $"{age} yaş kullanım bağlamında"
            : "Günlük kullanım bağlamında";
        var footwearText =
            $"{activeProduct.Category} {activeProduct.Name} " +
            string.Join(" ", selected.Select(order =>
                $"{order.Category} {order.ProductName}"));
        var hasFootwear = ContainsAny(
            footwearText.ToLowerInvariant(),
            "ayakkabı", "ayakkabi", "shoe", "sneaker", "bot", "boot", "loafer");
        var sequence = (variant % 3) switch
        {
            1 => "katmanlar açık bırakıldığında",
            2 when hasFootwear => "seçili ayakkabı görünümün hacmiyle yarışmadığında",
            2 => "renk tekrarları kontrollü tutulduğunda",
            _ => "ana parça görünür merkezde kaldığında"
        };
        var outfitText = (
            $"{activeProduct.Name} {activeProduct.Category} " +
            string.Join(
                " ",
                selected.Select(order =>
                    $"{order.ProductName} {order.Category}")))
            .ToLowerInvariant();
        var proportionGuard =
            ContainsAny(outfitText, "mini etek", "mini skirt", "mini denim") &&
            ContainsAny(outfitText, "trenç", "trenc", "trench")
                ? " İnce trenç açık kullanılmalı ve mini etek katmanın altında kaybolmamalı."
                : "";

        return Limit(
            $"{season.MonthName} için {season.Guidance}; {palette} ve {silhouette}. " +
            $"{ageLead} {sequence} görünüm dengeli kalır.{proportionGuard}",
            300);
    }

    private static string BuildAgeContext(int? age)
    {
        if (age is null)
        {
            return "Yaş bilgisi eklendiğinde stil yönü kullanım bağlamına göre daha kişisel hale gelir.";
        }

        var direction = age switch
        {
            <= 17 => "rahat hareket, güncel oranlar ve kolay katmanlama",
            <= 24 => "güncel siluetler, enerjik detaylar ve tekrar giyilebilirlik",
            <= 34 => "trend ile uzun ömürlü parçalar arasında dengeli bir görünüm",
            <= 49 => "modern, rafine ve farklı ortamlara uyarlanabilen bir görünüm",
            _ => "modern çizgi, iyi oran ve konforu birlikte koruyan bir görünüm"
        };
        return
            $"{age} yaş bilgisi kural veya sınır olarak değil, {direction} için stil bağlamı olarak kullanıldı.";
    }

    private static string AgeLead(int? age)
    {
        return age is int value
            ? $"{value} yaş stil bağlamında"
            : "Yaş bilgisi olmadan, genel kullanım bağlamında";
    }

    private static string BuildCompatibilityReason(
        ProductDto activeProduct,
        OrderHistoryItem order)
    {
        if (order.Outcome == OrderOutcome.KeptTooTight)
        {
            return "Bu parça dolabında ancak dar geldi notun var; kombin görsel olarak çalışsa da konfor sınırı korunmalı.";
        }
        if (order.Outcome == OrderOutcome.KeptTooBaggy)
        {
            return "Bu parça dolabında ancak bol geldi notun var; ikinci hacimli parçayla birlikte kullanırken oran dengesi korunmalı.";
        }

        var activeColor = DetectColor(activeProduct.Name);
        var pieceColor = DetectColor(order.ProductName);
        if (activeColor is not null && activeColor == pieceColor)
        {
            return $"Ton sür ton {activeColor} ilişkisi ve tamamlayıcı kategori.";
        }

        if (activeColor is not null &&
            pieceColor is not null &&
            (IsNeutral(activeColor) || IsNeutral(pieceColor)))
        {
            return $"{pieceColor} ile {activeColor} arasında güvenli nötr renk dengesi.";
        }

        if (activeColor is not null && pieceColor is not null)
        {
            return $"{pieceColor} ve {activeColor} birlikte kontrollü renk kontrastı kurar.";
        }

        return "Tamamlayıcı ürün kategorisi ve dolabındaki doğrulanmış parça bilgisi.";
    }

    private static string? DetectColor(string value)
    {
        var text = value.ToLowerInvariant();
        var colors = new (string Canonical, string[] Terms)[]
        {
            ("siyah", ["siyah", "black"]),
            ("beyaz", ["beyaz", "white", "ekru", "ecru"]),
            ("gri", ["gri", "gray", "grey", "antrasit"]),
            ("bej", ["bej", "beige", "kum", "stone"]),
            ("lacivert", ["lacivert", "navy"]),
            ("mavi", ["mavi", "blue", "indigo"]),
            ("kahverengi", ["kahverengi", "brown", "taba"]),
            ("yeşil", ["yeşil", "yesil", "green", "haki", "khaki"]),
            ("kırmızı", ["kırmızı", "kirmizi", "red", "bordo", "burgundy"]),
            ("pembe", ["pembe", "pink"]),
            ("mor", ["mor", "purple", "lila"]),
            ("sarı", ["sarı", "sari", "yellow"]),
            ("turuncu", ["turuncu", "orange"])
        };
        return colors
            .FirstOrDefault(color => color.Terms.Any(term =>
                text.Contains(term, StringComparison.Ordinal)))
            .Canonical;
    }

    private static bool IsNeutral(string color)
    {
        return color is "siyah" or "beyaz" or "gri" or "bej" or
            "lacivert" or "kahverengi";
    }

    private static string RoleLabel(ProductCategoryGroup group)
    {
        return group switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops => "Üst katman",
            ProductCategoryGroup.Bottoms => "Alt parça",
            ProductCategoryGroup.Outerwear => "Dış katman",
            ProductCategoryGroup.Dresses => "Ana parça",
            ProductCategoryGroup.Footwear => "Ayakkabı",
            ProductCategoryGroup.Accessories => "Aksesuar",
            _ => "Tamamlayıcı parça"
        };
    }

    private static string StyleSlot(ProductCategoryGroup group)
    {
        return group switch
        {
            ProductCategoryGroup.Tees or
            ProductCategoryGroup.Shirts or
            ProductCategoryGroup.Knitwear or
            ProductCategoryGroup.Tops => "upper",
            ProductCategoryGroup.Bottoms => "bottom",
            ProductCategoryGroup.Outerwear => "outerwear",
            ProductCategoryGroup.Dresses => "dress",
            ProductCategoryGroup.Footwear => "footwear",
            ProductCategoryGroup.Accessories => "accessory",
            _ => "other"
        };
    }

    private static SeasonContext CurrentSeason()
    {
        var turkeyNow = DateTimeOffset.UtcNow.ToOffset(
            TimeSpan.FromHours(3));
        var monthName = turkeyNow.Month switch
        {
            1 => "Ocak",
            2 => "Şubat",
            3 => "Mart",
            4 => "Nisan",
            5 => "Mayıs",
            6 => "Haziran",
            7 => "Temmuz",
            8 => "Ağustos",
            9 => "Eylül",
            10 => "Ekim",
            11 => "Kasım",
            _ => "Aralık"
        };

        return turkeyNow.Month switch
        {
            12 or 1 or 2 => new SeasonContext(
                StyleSeason.Winter,
                monthName,
                "Kış",
                "ısıyı koruyan katman ve kapalı ayakkabı önceliği"),
            3 or 4 or 5 => new SeasonContext(
                StyleSeason.Spring,
                monthName,
                "İlkbahar",
                "değişken hava için çıkarılabilir hafif katman önceliği"),
            6 or 7 or 8 => new SeasonContext(
                StyleSeason.Summer,
                monthName,
                "Yaz",
                "nefes alan hafif parça ve az katman önceliği"),
            _ => new SeasonContext(
                StyleSeason.Autumn,
                monthName,
                "Sonbahar",
                "geçiş havasına uygun doku ve hafif dış katman önceliği")
        };
    }

    private static bool ContainsAny(
        string value,
        params string[] terms)
    {
        return terms.Any(term =>
            value.Contains(term, StringComparison.Ordinal));
    }

    private static string OutfitSignature(
        IEnumerable<StylePieceDto> pieces)
    {
        return OutfitSignature(pieces.Select(piece => piece.OrderId));
    }

    private static string OutfitSignature(IEnumerable<int> orderIds)
    {
        return string.Join(
            "-",
            orderIds
                .Distinct()
                .Order());
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private sealed record RankedItem(OrderHistoryItem Order, int Score);

    private sealed record RankedOutfit(
        IReadOnlyList<OrderHistoryItem> Orders,
        int Score);

    private sealed record SeasonContext(
        StyleSeason Kind,
        string MonthName,
        string Label,
        string Guidance);

    private enum StyleSeason
    {
        Winter,
        Spring,
        Summer,
        Autumn
    }
}
