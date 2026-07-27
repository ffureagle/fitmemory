using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class GeminiRecommendationClient(
    HttpClient httpClient,
    IOptions<GeminiOptions> options,
    LocalFitRecommendationEngine localEngine,
    ProductIdentityService productIdentityService,
    ProductFitTaxonomyService fitTaxonomy,
    WardrobeStylistService wardrobeStylistService)
{
    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web);

    public async Task<RecommendationResult> GenerateAsync(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        AnalyzeRecommendationRequest request,
        RecommendationResult localBaseline,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            throw new InvalidOperationException(
                "Gemini API anahtarı yapılandırılmamış. Backend User Secrets ayarını kontrol edin.");
        }

        var availableSizes = localEngine.GetAvailableSizes(
            request.SizeChart,
            request.Product);
        var useUrlContext =
            settings.UseUrlContext &&
            HasPublicStyleUrls(wardrobe, request.Product);
        var payload = CreatePayload(
            profile,
            orders,
            wardrobe,
            request,
            localBaseline,
            availableSizes,
            useUrlContext);
        string responseBody;
        try
        {
            responseBody = await SendAsync(
                settings,
                payload,
                cancellationToken);
        }
        catch (GeminiApiException exception)
            when (useUrlContext &&
                  settings.FallbackWithoutWebTools &&
                  exception.StatusCode == System.Net.HttpStatusCode.BadRequest)
        {
            payload = CreatePayload(
                profile,
                orders,
                wardrobe,
                request,
                localBaseline,
                availableSizes,
                useUrlContext: false);
            responseBody = await SendAsync(
                settings,
                payload,
                cancellationToken);
        }

        var outputText = GeminiResponseReader.ExtractText(responseBody);
        var aiResult = JsonSerializer.Deserialize<AiRecommendation>(
            NormalizeJson(outputText),
            JsonOptions)
            ?? throw new InvalidOperationException(
                "Gemini boş bir beden önerisi döndürdü.");
        ValidateAiResult(aiResult, availableSizes);
        var calibratedConfidence = CalibrateConfidence(
            aiResult.Confidence,
            localBaseline.Confidence,
            orders,
            availableSizes.Count);
        var style = wardrobeStylistService.EnrichWithAi(
            localBaseline.Style,
            profile,
            wardrobe,
            request.Product,
            aiResult.Style.Headline,
            aiResult.Style.Summary,
            aiResult.Style.Confidence,
            aiResult.Style.Outfits
                .Select(outfit => new StyleOutfitDraft(
                    outfit.Title,
                    outfit.Direction,
                    outfit.PieceOrderIds))
                .ToArray());

        return new RecommendationResult(
            aiResult.RecommendedSize.Trim().ToUpperInvariant(),
            calibratedConfidence,
            Limit(aiResult.Verdict.Trim(), 240),
            Limit(aiResult.Explanation.Trim(), 1600),
            aiResult.FitNotes
                .Where(note => !string.IsNullOrWhiteSpace(note))
                .Select(note => Limit(note.Trim(), 240))
                .Take(5)
                .ToArray(),
            aiResult.Comparisons
                .Where(comparison =>
                    !string.IsNullOrWhiteSpace(comparison.Label) &&
                    !string.IsNullOrWhiteSpace(comparison.Detail))
                .Select(comparison => new ComparisonDto(
                    Limit(comparison.Label.Trim(), 60),
                    Limit(comparison.Detail.Trim(), 240)))
                .Take(5)
                .ToArray(),
            Limit(aiResult.EvidenceSummary.Trim(), 120),
            "gemini")
        {
            Style = style
        };
    }

    private object CreatePayload(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        AnalyzeRecommendationRequest request,
        RecommendationResult localBaseline,
        IReadOnlyList<string> availableSizes,
        bool useUrlContext)
    {
        var styleNow = DateTimeOffset.UtcNow.ToOffset(
            TimeSpan.FromHours(3));
        var evidence = new
        {
            profile = new
            {
                profile.Age,
                profile.HeightCm,
                profile.WeightKg,
                profile.ShoulderWidthCm,
                profile.ChestCircumferenceCm,
                profile.WaistCircumferenceCm,
                profile.FootLengthCm,
                profile.UsualShoeSizeEu,
                fitPreference = profile.FitPreference.ToString()
            },
            activeFitSemantics = fitTaxonomy.Describe(request.Product),
            currentProductUserNote = request.UserAdjustmentNote,
            styleCalendar = new
            {
                month = styleNow.Month,
                season = styleNow.Month switch
                {
                    12 or 1 or 2 => "Kış",
                    3 or 4 or 5 => "İlkbahar",
                    6 or 7 or 8 => "Yaz",
                    _ => "Sonbahar"
                },
                hemisphere = "Kuzey",
                locale = "Türkiye"
            },
            sizeHistory = orders.Select(order =>
            {
                var sameProductFamily =
                    productIdentityService.IsSameFamily(
                        order,
                        request.Product);
                var fitCompatibility =
                    fitTaxonomy.Compatibility(
                        order,
                        request.Product);
                return new
                {
                    order.Brand,
                    order.ProductName,
                    order.Category,
                    order.PurchasedSize,
                    outcome = order.Outcome.ToString(),
                    order.FitNotes,
                    UserFitNotes =
                        sameProductFamily || fitCompatibility >= 0.95
                            ? order.UserFitNotes
                            : null,
                    order.ProductUrl,
                    order.ProductFamilyKey,
                    sameProductFamily,
                    fitSemantics = fitTaxonomy.Describe(order),
                    fitCompatibilityToActive = fitCompatibility,
                    usableAsSizingBoundary =
                        fitTaxonomy.IsSizingEvidenceEligible(
                            order,
                            request.Product,
                            sameProductFamily),
                    order.ChestWidthCm,
                    order.ShoulderWidthCm,
                    order.WaistWidthCm,
                    order.LengthCm,
                    order.SleeveLengthCm,
                    order.InseamCm,
                    order.FitLabel,
                    order.SizeEvidence,
                    order.ResearchConfidence,
                    order.FitScore,
                    order.FitAssessment,
                    order.FitAssessmentConfidence
                };
            }),
            wardrobe = wardrobe
                .Where(order => order.Outcome.IsInCloset())
                .Select(order => new
                {
                    order.Id,
                    order.Brand,
                    order.ProductName,
                    order.Category,
                    order.PurchasedSize,
                    outcome = order.Outcome.ToString(),
                    order.ImageUrl,
                    order.ProductUrl,
                    order.FitLabel,
                    order.ResearchConfidence,
                    order.FitScore,
                    order.UserFitNotes,
                    order.FitAssessment
                }),
            request.Product,
            request.SizeChart,
            availableSizes,
            deterministicBaseline = new
            {
                localBaseline.RecommendedSize,
                localBaseline.Confidence,
                localBaseline.Explanation,
                localBaseline.Comparisons,
                localBaseline.DataSource
            }
        };

        var responseLanguage = request.Language.Equals("en", StringComparison.OrdinalIgnoreCase)
            ? "English"
            : "Turkish";
        var input = $"""
            Aşağıdaki beden kanıtını ve dolap envanterini analiz et. Beden kararını ve stil önerisini
            birbirinden bağımsız kanıt alanları olarak değerlendir.

            Kanıt:
            {JsonSerializer.Serialize(evidence, JsonOptions)}

            Karar kuralları:
            -1. sizeHistory dizisi backend tarafından yalnız aktif ürünün kanonik kategorisinden seçildi.
                Aktif ürün tişörtse mont, gömlek, pantolon veya başka bir kategori hakkında hiçbir
                beden açıklaması, örnek ya da çıkarım yazma. Dolaptaki başka kategorileri yalnız stil
                kombininde kullan; beden kararına kesinlikle taşıma.
            -0.99 Aynı "40" beden etiketi farklı kalıp ailelerinde aynı bitmiş giysi hacmi demek değildir.
                  activeFitSemantics ürünün kesim sözlüğüdür. Straight, Skinny, Slim, Regular, Relaxed,
                  Wide Leg, Baggy ve Super Baggy ayrı siluetlerdir; bunları tek beden hafızasında birleştirme.
            -0.98 sizeHistory içindeki usableAsSizingBoundary=false kayıtları beden büyütme/küçültme sınırı
                  olarak kullanma. Özellikle Straight 40'ın bacak, kalça veya uylukta dar gelmesi,
                  Super Baggy 40'ın dar geleceği anlamına gelmez. Super Baggy; ağ, kalça, uyluk ve paçada
                  tasarlanmış ekstra hacimdir. Aktif ürünün bel/kalça tablosu varsa onu doğrudan değerlendir.
            -0.97 fitCompatibilityToActive yalnız kalıp yakınlığını gösterir. Nominal beden aynı olsa bile
                  uyumsuz kalıplardaki outcome bilgisini o beden aleyhine oy sayma. Bel notu bile ancak
                  aktif üründe karşılaştırılabilir gerçek bel ölçüsü varsa zayıf uyarı olabilir.
            -0.96 currentProductUserNote doluysa bu, kullanıcının mevcut öneriye itirazı veya ek bağlamıdır.
                  Notu arşivlenmiş bir deneme sonucu gibi sunma. Önceki kararı yeniden tart, beden değişiyorsa
                  aktif tablo ve kalıp semantiğiyle nedenini açıkla; değişmiyorsa notun neden sonucu
                  değiştirmediğini somut biçimde söyle.
            -0.9 Göğüs eni ile omuz genişliği farklı ölçülerdir; birbirleriyle karşılaştırma. Giysi göğüs
                 eni yalnız ChestCircumferenceCm/2 ve gerekli hareket payıyla ya da doğrulanmış giysi göğüs
                 eniyle karşılaştırılabilir. ChestCircumferenceCm null ise boy ve kilodan göğüs ölçüsü uydurma.
            -0.85 FitLabel ürünün bitmiş siluetini zaten anlatır; bu etikete ek olarak ikinci kez bolluk veya
                  beden artışı uygulama. Boxy, düz ve geniş gövdeli bir siluettir fakat Oversized ile aynı
                  sınıf değildir ve tek başına beden büyütme talimatı sayılmaz. Relaxed da normal bedende
                  daha gevşek kesimdir. Düz göğüs eni varsa toplam bolluğu
                  (2 × giysi göğüs eni) - ChestCircumferenceCm formülüyle hesapla.
            -0.84 Aynı modelde doğrulanmış iyi uyum yoksa tişört/üst/gömlekte toplam göğüs bolluğu Boxy için
                  17 cm'yi, Relaxed için 19 cm'yi, Regular için 14 cm'yi aşan bedeni seçme.
                  Deterministik baseline bu fiziksel sınırı uygulamıştır; AI ile daha büyük bedene geçme.
            -0.8 Deterministik sonuç "local-category-history", "local-model-reference", "local-body-label-estimate" veya "local-insufficient" ise ölçü kanıtı
                 yetersizdir. Sırf Relaxed/Oversized tercihi yüzünden bir beden büyütme ve baseline bedeni değiştirme.
            -0.79 Product.ModelHeightCm ve Product.ModelWornSize ürün açıklamasından doğrudan okunmuşsa
                  gerçek ürün kanıtıdır. Kullanıcı modelden daha kısa veya benzer boydaysa ve giysi ölçüsü
                  yoksa, yalnız genel vücut beden aralığına dayanarak model bedeninin üstüne çıkma.
            0. sameProductFamily=true olan ve iyi uyduğu doğrulanan kayıt farklı renk olsa bile en güçlü
               kanıttır. Resmi kalıp etiketi değişmediyse ve bu beden aktif tabloda varsa önceki
               iyi-uyum bedenini koru.
            0.1 UserFitNotes yalnız aynı ürün veya aktif kalıpla yeterince uyumlu kayıtlarda verilir.
                “Belden dar”, “boydan tam”, “omuzdan bol” gibi bölgesel geri bildirimi yalnız ilgili
                ölçüye uygula; başka kalıp ailesine veya tüm kategoriye kesinlikle taşıma.
            1. İyi uyduğu doğrulanmış giysi ölçüleri en güçlü kanıttır. Aynı kategorideki ürünler daha önemlidir.
            2. KeptTooBaggy/KeptTooTight parçaları dolaptadır fakat bol/dar uyum sınırı oluşturur.
               ReturnedTooBaggy/ReturnedTooTight yalnız kullanıcının açıkça doğruladığı iadelerdir.
            3. PurchasedUnknownFit kayıtlarını yalnızca zayıf kanıt olarak kullan; iyi uyduğunu varsayma.
            4. İki beden yakınsa kullanıcının siluet tercihini uygula.
            5. Giysi enini vücut çevresinden ayır. Düz göğüs veya bel eni genellikle çevrenin yarısıdır.
            6. availableSizes doluysa önerilen etiketi listedeki yazımıyla aynen döndür.
            7. Yalnız sağlanan verinin desteklediği sayısal karşılaştırmaları yaz.
            8. Birim, ölçü türü, kategori veya tablo yapısı belirsizse güveni düşür.
            9. profile.Age kullanıcının açıkça verdiği yaştır. Yaşı yalnız kombinlerin kullanım bağlamı,
               güncelliği ve siluet dengesi için yumuşak bir stil sinyali olarak kullan; yaşa göre yasak,
               küçümseyici kalıp veya cinsiyet varsayımı üretme. Age null ise yaş tahmini yapma.
            9.1 wardrobe yalnız kullanıcının dolabındaki iade edilmemiş gerçek ürünleri içerir. Kombinlerde
                sadece bu dizide bulunan Id değerlerini pieceOrderIds alanına yaz. Ürün veya kimlik uydurma.
            9.2 Aktif ürünü ana parça kabul et ve tamamlayıcı kategori seç: üst için alt/ayakkabı/dış katman,
                alt için üst/ayakkabı/dış katman, dış giyim için üst+alt, elbise için ayakkabı/dış katman.
                Aynı kategori yığılmasını ancak gerçek bir katman mantığı varsa kullan.
            9.3 Product.ImageUrl ve wardrobe.ImageUrl içindeki herkese açık görselleri URL Context ile incele.
                Yalnız aynı ürün kimliğiyle eşleşen görseli kullan. Her kombin için renk uyumu, üst-alt
                hacim dengesi, paça/gövde kesimi ve katman oranının neden birlikte iyi durduğunu açıkla.
            9.4 Kombin sayısını doldurmak zorunda değilsin. Görsel erişilemiyor ve ürün adı renk/kalıp
                kanıtı vermiyorsa o kombin hakkında tahmin yürütme; daha az kombin veya sıfır kombin döndür.
                Aynı alt parçayı yalnız başlık değiştirerek tekrar etme. KeptTooBaggy ve KeptTooTight
                parçalar iade edilmediyse dolapta kalır; UserFitNotes ve FitAssessment bilgisini siluet
                kararında açıkça hesaba kat, rahatsız edici kullanımı iyi kombin diye sunma.
            9.5 direction metni reklam cümlesi değil stil kararıdır: doğrulanmış renk paletini, siluet
                karşıtlığını veya uyumunu ve parçaların kesim ilişkisini somut biçimde belirt.
                En az bir gerçek renk adını ve bir kesim/siluet terimini açıkça yaz; “renkler uyumlu”
                gibi doğrulanamayan genel cümle backend kalite filtresinden geçmeyecektir.
            9.6 styleCalendar mevcut ay ve mevsimdir. Yazın ağır kaban/triko, kışın şort veya ince yazlık
                parça önermeyi ancak somut bir katmanlama gerekçesi varsa kabul et. Geçiş mevsimlerinde
                çıkarılabilir hafif katmanları önceliklendir. Aynı gerçek parça setini yeniden adlandırarak
                çoğaltma; mümkün olan farklı, giyilebilir setleri üret.
            9.7 Aktif ürün ayakkabıysa yalnız FootLengthCm, UsualShoeSizeEu, resmi markanın ayak/iç taban
                uzunluğu tablosu ve doğrulanmış aynı ayakkabı kategorisi geçmişini kullan. Boy, kilo, göğüs,
                omuz veya kıyafet bedeni ayakkabı numarası kanıtı değildir. Marka tablosu olmadan santimetreden
                kesin EU dönüşümü uydurma; alışılan EU numarasını yalnız düşük güvenli başlangıç kabul et.
            10. Write every user-facing field in {responseLanguage}.
            10.1 verdict tek ve kısa bir karar cümlesi olsun. explanation 2-4 kısa cümleyi geçmesin:
                 önce önerilen beden ve ana gerekçe, sonra yalnız kullanıcı için önemli kalıp/boy uyarısı.
                 İç sistem adlarını, veri kaynağı kodlarını, hesap günlüğünü, aynı sayının tekrarını ve
                 karar vermeye yardım etmeyen teknik ayrıntıları kullanıcıya yazma.
            11. Güven puanı kesinlik değildir. Kanıt sınırlıysa 50-70 aralığını kullan; birden fazla
                resmi ölçü ve kullanıcı geri bildirimi yoksa 90 üzerine çıkma. Asla 100 verme.
            """;

        return new
        {
            systemInstruction = new
            {
                parts = new[]
                {
                    new
                    {
                        text = $"""
                            You are FitMemory's evidence-led sizing analyst and personal wardrobe stylist. Write every user-facing field in {responseLanguage}.
                            Perakendecinin
                            aktif beden tablosunu kullanıcının açık vücut ölçüleri, doğrulanmış giysi
                            ölçüleri, iade nedenleri, bölgesel kullanıcı notları ve kalıp tercihiyle
                            karşılaştır. Resmi ürün sayfasındaki FitLabel/FitEvidence alanlarını
                            tahminden üstün tut. Aynı beden etiketini farklı kalıplarda eşit sayma:
                            Straight ile Super Baggy, Slim ile Wide Leg, Boxy ile Oversized ayrı kanıt
                            aileleridir. Boxy'yi Oversized sayma; ürün kalıbının kendi bolluğunu
                            kullanıcı tercihine ekleyerek iki kez büyütme. Yalnız sağlanan
                            kanıta dayalı, kısa ve kararlı bir öneri üret. Asla ölçü uydurma.
                            Beden analizinde kategorileri kesin biçimde izole et. Stil analizinde ise
                            yalnız wardrobe listesindeki gerçek, iade edilmemiş parçalarla yaş bağlamını
                            nazikçe dikkate alan giyilebilir kombinler kur. Dolap parçalarını beden
                            kararının ölçü kanıtı olarak kullanma.
                            """
                    }
                }
            },
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new[] { new { text = input } }
                }
            },
            tools = useUrlContext
                ? new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["url_context"] = new { }
                    }
                }
                : [],
            generationConfig = new
            {
                temperature = 0.15,
                maxOutputTokens = 3_000,
                responseMimeType = "application/json",
                responseJsonSchema = RecommendationSchema()
            }
        };
    }

    private async Task<string> SendAsync(
        GeminiOptions settings,
        object payload,
        CancellationToken cancellationToken)
    {
        var endpoint =
            GeminiResponseReader.BuildGenerateContentEndpoint(settings);
        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            endpoint)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        httpRequest.Headers.Add("x-goog-api-key", settings.ApiKey);
        httpRequest.Headers.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));

        using var response = await httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = GeminiResponseReader.ExtractApiError(responseBody);
            throw new GeminiApiException(
                response.StatusCode,
                error.Code,
                error.Message);
        }
        return responseBody;
    }

    private static bool HasPublicStyleUrls(
        IReadOnlyList<OrderHistoryItem> wardrobe,
        ProductDto product)
    {
        return IsPublicUrl(product.Url) ||
               IsPublicUrl(product.ImageUrl) ||
               wardrobe.Any(order =>
                   order.Outcome.IsInCloset() &&
                   (IsPublicUrl(order.ProductUrl) ||
                    IsPublicUrl(order.ImageUrl)));
    }

    private static bool IsPublicUrl(string? value)
    {
        return Uri.TryCreate(
                   value,
                   UriKind.Absolute,
                   out var uri) &&
               uri.Scheme == Uri.UriSchemeHttps &&
               !uri.IsLoopback &&
               !uri.Host.EndsWith(
                   ".local",
                   StringComparison.OrdinalIgnoreCase);
    }

    private static object RecommendationSchema()
    {
        return new
        {
            type = "object",
            additionalProperties = false,
            properties = new
            {
                recommendedSize = new { type = "string" },
                confidence = new
                {
                    type = "integer",
                    minimum = 0,
                    maximum = 100
                },
                verdict = new { type = "string" },
                explanation = new { type = "string" },
                fitNotes = new
                {
                    type = "array",
                    maxItems = 5,
                    items = new { type = "string" }
                },
                comparisons = new
                {
                    type = "array",
                    maxItems = 5,
                    items = new
                    {
                        type = "object",
                        additionalProperties = false,
                        properties = new
                        {
                            label = new { type = "string" },
                            detail = new { type = "string" }
                        },
                        required = new[] { "label", "detail" }
                    }
                },
                evidenceSummary = new { type = "string" },
                style = new
                {
                    type = "object",
                    additionalProperties = false,
                    properties = new
                    {
                        headline = new { type = "string" },
                        summary = new { type = "string" },
                        confidence = new
                        {
                            type = "integer",
                            minimum = 0,
                            maximum = 100
                        },
                        outfits = new
                        {
                            type = "array",
                            maxItems = 8,
                            items = new
                            {
                                type = "object",
                                additionalProperties = false,
                                properties = new
                                {
                                    title = new { type = "string" },
                                    direction = new { type = "string" },
                                    pieceOrderIds = new
                                    {
                                        type = "array",
                                        maxItems = 4,
                                        items = new { type = "integer" }
                                    }
                                },
                                required = new[]
                                {
                                    "title",
                                    "direction",
                                    "pieceOrderIds"
                                }
                            }
                        }
                    },
                    required = new[]
                    {
                        "headline",
                        "summary",
                        "confidence",
                        "outfits"
                    }
                }
            },
            required = new[]
            {
                "recommendedSize",
                "confidence",
                "verdict",
                "explanation",
                "fitNotes",
                "comparisons",
                "evidenceSummary",
                "style"
            }
        };
    }

    private static void ValidateAiResult(
        AiRecommendation result,
        IReadOnlyList<string> availableSizes)
    {
        if (string.IsNullOrWhiteSpace(result.RecommendedSize) ||
            string.IsNullOrWhiteSpace(result.Verdict) ||
            string.IsNullOrWhiteSpace(result.Explanation) ||
            string.IsNullOrWhiteSpace(result.EvidenceSummary))
        {
            throw new InvalidOperationException(
                "Gemini eksik bir beden önerisi döndürdü.");
        }

        if (availableSizes.Count > 0 &&
            !availableSizes.Contains(
                result.RecommendedSize.Trim(),
                StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Gemini'nin önerdiği '{result.RecommendedSize}' bedeni taranan tabloda bulunmuyor.");
        }
    }

    private static int CalibrateConfidence(
        int aiConfidence,
        int localConfidence,
        IReadOnlyList<OrderHistoryItem> orders,
        int availableSizeCount)
    {
        var confirmedFeedback = orders.Count(order =>
            order.Outcome != OrderOutcome.PurchasedUnknownFit);
        var officialMeasuredItems = orders.Count(order =>
            order.ResearchConfidence >= 65 &&
            !string.IsNullOrWhiteSpace(order.ResearchSourceUrl) &&
            new decimal?[]
            {
                order.ChestWidthCm,
                order.ShoulderWidthCm,
                order.WaistWidthCm,
                order.LengthCm,
                order.SleeveLengthCm,
                order.InseamCm
            }.Count(value => value is not null) >= 2);
        var evidenceCap = 68 +
                          Math.Min(confirmedFeedback * 5, 12) +
                          Math.Min(officialMeasuredItems * 4, 8) +
                          (availableSizeCount >= 2 ? 4 : 0);
        evidenceCap = Math.Clamp(evidenceCap, 62, 92);

        var blended = (int)Math.Round(
            Math.Clamp(aiConfidence, 0, 95) * 0.45 +
            Math.Clamp(localConfidence, 0, 94) * 0.55);
        return Math.Clamp(Math.Min(blended, evidenceCap), 35, 92);
    }

    private static string NormalizeJson(string value)
    {
        var trimmed = value.Trim();
        if (!trimmed.StartsWith("```", StringComparison.Ordinal))
        {
            return trimmed;
        }

        var firstNewLine = trimmed.IndexOf('\n');
        var closingFence = trimmed.LastIndexOf("```", StringComparison.Ordinal);
        return firstNewLine >= 0 && closingFence > firstNewLine
            ? trimmed[(firstNewLine + 1)..closingFence].Trim()
            : trimmed;
    }

    private static string Limit(string value, int maxLength)
    {
        return value.Length <= maxLength ? value : value[..maxLength];
    }

    private sealed class AiRecommendation
    {
        public string RecommendedSize { get; init; } = "";

        public int Confidence { get; init; }

        public string Verdict { get; init; } = "";

        public string Explanation { get; init; } = "";

        public IReadOnlyList<string> FitNotes { get; init; } = [];

        public IReadOnlyList<AiComparison> Comparisons { get; init; } = [];

        public string EvidenceSummary { get; init; } = "";

        public AiStyle Style { get; init; } = new();
    }

    private sealed class AiComparison
    {
        public string Label { get; init; } = "";

        public string Detail { get; init; } = "";
    }

    private sealed class AiStyle
    {
        public string Headline { get; init; } = "";

        public string Summary { get; init; } = "";

        public int Confidence { get; init; }

        public IReadOnlyList<AiStyleOutfit> Outfits { get; init; } = [];
    }

    private sealed class AiStyleOutfit
    {
        public string Title { get; init; } = "";

        public string Direction { get; init; } = "";

        public IReadOnlyList<int> PieceOrderIds { get; init; } = [];
    }
}
