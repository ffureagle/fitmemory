using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class OpenAiRecommendationClient(
    HttpClient httpClient,
    IOptions<OpenAiOptions> options,
    LocalFitRecommendationEngine localEngine,
    ProductIdentityService productIdentityService,
    ProductFitTaxonomyService fitTaxonomy,
    WardrobeStylistService wardrobeStylistService)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<RecommendationResult> GenerateAsync(
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        AnalyzeRecommendationRequest request,
        RecommendationResult localBaseline,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        var availableSizes = localEngine.GetAvailableSizes(
            request.SizeChart,
            request.Product);
        var payload = CreatePayload(
            settings,
            profile,
            orders,
            wardrobe,
            request,
            localBaseline,
            availableSizes);

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, settings.Endpoint)
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);

        using var response = await httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new OpenAiApiException(response.StatusCode, ExtractApiError(responseBody));
        }

        var outputText = ExtractOutputText(responseBody);
        var aiResult = JsonSerializer.Deserialize<AiRecommendation>(outputText, JsonOptions)
            ?? throw new InvalidOperationException("OpenAI boş bir beden önerisi döndürdü.");
        ValidateAiResult(aiResult, availableSizes);
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
            Math.Clamp(aiResult.Confidence, 35, 92),
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
            "openai")
        {
            Style = style
        };
    }

    private object CreatePayload(
        OpenAiOptions settings,
        UserProfile profile,
        IReadOnlyList<OrderHistoryItem> orders,
        IReadOnlyList<OrderHistoryItem> wardrobe,
        AnalyzeRecommendationRequest request,
        RecommendationResult localBaseline,
        IReadOnlyList<string> availableSizes)
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
                    sameProductFamily,
                    fitSemantics = fitTaxonomy.Describe(order),
                    fitCompatibilityToActive = fitCompatibility,
                    usableAsSizingBoundary =
                        fitTaxonomy.IsSizingEvidenceEligible(
                            order,
                            request.Product,
                            sameProductFamily),
                    order.ProductUrl,
                    order.ProductFamilyKey,
                    order.ChestWidthCm,
                    order.ShoulderWidthCm,
                    order.WaistWidthCm,
                    order.LengthCm,
                    order.SleeveLengthCm,
                    order.InseamCm,
                    order.FitLabel,
                    order.SizeEvidence
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
            wardrobeSizeSupport = orders
                .Where(order =>
                    productIdentityService.IsSameFamily(
                        order,
                        request.Product) ||
                    fitTaxonomy.Compatibility(
                        order,
                        request.Product) >= 0.95)
                .Select(order =>
                {
                    var howItFit = order.Outcome.ToTurkishFitSummary();
                    var theirNote = string.IsNullOrWhiteSpace(order.UserFitNotes)
                        ? null
                        : order.UserFitNotes.Trim();
                    return new
                    {
                        useAs = "support_only_not_a_size_lock",
                        sameProductFamily = productIdentityService.IsSameFamily(
                            order,
                            request.Product),
                        brand = order.Brand,
                        productName = order.ProductName,
                        sizeTheyWore = order.PurchasedSize,
                        outcome = order.Outcome.ToString(),
                        howItFit,
                        theirNote,
                        fitLabel = order.FitLabel,
                        fitAssessment = order.FitAssessment,
                        briefing =
                            $"Şu ürünü {order.PurchasedSize} almıştı: {order.ProductName}. Sonuç: {howItFit}." +
                            (theirNote is null ? "" : $" Kullanıcı notu: {theirNote}")
                    };
                })
                .ToArray(),
            controllerRole = new
            {
                youAreTheFinalSizeController = true,
                localEngineIsDraftOnly = true,
                mustReDecideUsingFitLabelCutConstructionAndChart = true,
                productName = request.Product.Name,
                productFitLabel = request.Product.FitLabel,
                productFitEvidence = request.Product.FitEvidence,
                merchantFitAdvice = request.Product.MerchantFitAdvice,
                titleCutHints = request.Product.Name,
                howItSitsOnAPerson = request.Product.FitEvidence,
                fabricStretch = request.Product.MaterialSummary,
                materialSummary = request.Product.MaterialSummary,
                materialEvidence = request.Product.MaterialEvidence,
                description = request.Product.Description,
                promptJob =
                    "Bu isteği kapsamlı bir beden karar prompt'u olarak oku: dolap geçmişi, " +
                    "kullanıcı geri bildirimi, ürün başlığındaki kalıp (baggy/slim/boxy), " +
                    "insan üzerindeki duruş, kumaş esnekliği ve beden tablosunu birlikte tart."
            },
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

            Evidence:
            {JsonSerializer.Serialize(evidence, JsonOptions)}

            Karar kuralları:
            -1.07 Sayfadaki mağaza uyarılarını oku (merchantFitAdvice, FitEvidence): "büyük beden / bir beden küçük al",
                  "runs large", "runs small". Ürün ölçüleri varsa bunu komşu beden kaydırması olarak uygula.
                  Ölçü yoksa beden uydurma.
            -1.08 SizeChart satırlarında giysi milimi yoksa asla XS-XXL etiketinden veya göğüs çevresinden
                  beden uydurma. recommendedSize "Bilinmiyor" kalsın; kullanıcıya ölçü tablosunu açmasını söyle.
            -1.06 Yerel motor yalnız sayısal taslak üretir. Sen ürün başlığındaki kalıbı (Baggy, Super Baggy,
                  Slim, Boxy, Relaxed, Straight), kumaşın esnekliğini (elastan/elastane/spandex yüzdesi,
                  pamuk/polyester/keten rijitliği), modelin üzerindeki duruş kanıtını (FitEvidence,
                  modelWornSize, howItFit) ve dolaptaki aynı kesim geri bildirimini birlikte tartarak
                  nihai bedeni seç. Esnemeyen dokuma + slim/straight ise taslağı küçültmeye daha yatkın ol;
                  yüksek elastan + baggy/super baggy ise bel otururken hacmi koru, gereksiz büyütme.
                  explanation'da kalıp + kumaş + duruşten en az birini somut söyle.
            -1.05 Sen son denetleyici ve karar vericisin. deterministicBaseline yerel ölçü motorunun
                  taslağıdır; nihai beden değildir. wardrobeSizeSupport dolaptaki aynı kesim deneyimidir
                  ("M almıştı, şöyle olmuştu") — destek atarsın, kopyalamazsın. Product.FitLabel,
                  FitEvidence, Description, MaterialSummary, kesim/dikiş/kalıp anahtar kelimeleri,
                  beden tablosu ve vücut ölçüleriyle taslağı yeniden tart. Kalıp, kumaş veya dikiş
                  kanıtı taslağı çürütüyorsa availableSizes içinden doğru bedeni seç; yalnız yorum
                  yazıp taslağı olduğu gibi bırakma. Beden değişiyorsa explanation'da tek somut
                  gerekçe söyle. Emin değilsen taslağı koru ve güveni düşür.
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
            -0.9 Göğüs eni ile omuz ölçüsü farklıdır; birbirleriyle karşılaştırma. Profildeki omuz
                 değeri çevre ölçüsüdür (eski kayıtlarda 70 cm altı omuz eni olarak okunur). Giysi omuz
                 eni yalnız omuz çevresi/2 ile karşılaştırılabilir. Giysi göğüs eni yalnız
                 ChestCircumferenceCm/2 ve hareket payıyla ya da doğrulanmış giysi göğüs eniyle
                 karşılaştırılabilir. ChestCircumferenceCm null ise boy ve kilodan göğüs ölçüsü uydurma.
            -0.85 FitLabel ürünün bitmiş siluetini zaten anlatır; bu etikete ek olarak ikinci kez bolluk veya
                  beden artışı uygulama. Boxy, düz ve geniş gövdeli bir siluettir fakat Oversized ile aynı
                  sınıf değildir ve tek başına beden büyütme talimatı sayılmaz. Relaxed da normal bedende
                  daha gevşek kesimdir. Düz göğüs eni varsa toplam bolluğu
                  (2 × giysi göğüs eni) - ChestCircumferenceCm formülüyle hesapla.
            -0.84 Aynı modelde doğrulanmış iyi uyum yoksa tişört/üst/gömlekte toplam göğüs bolluğu Boxy için
                  17 cm'yi, Relaxed için 19 cm'yi, Regular için 14 cm'yi gerekçesiz aşma.
                  Bu tavan fiziksel kılavuzdur. Taslak tavanı aşıyorsa küçült. Taslak tavanın altındaysa
                  ve FitLabel, kumaş esnemesi veya dikiş/kesim kanıtı başka bir komşu bedeni işaret ediyorsa
                  o bedeni seç; tavanı gerekçesiz aşma.
            -0.8 deterministicBaseline kaynak kodu taslağın zayıf olduğunu gösterir, seni o bedene kilitlemez.
                 Sırf kullanıcı Relaxed/Oversized tercih ediyor diye gerekçesiz büyütme. FitLabel, kesim,
                 kumaş veya tablo gerekçesi varsa bedeni değiştir.
            -0.79 Product.ModelHeightCm ve Product.ModelWornSize ürün açıklamasından doğrudan okunmuşsa
                  gerçek ürün kanıtıdır. Kullanıcı modelden daha kısa veya benzer boydaysa ve giysi ölçüsü
                  yoksa, yalnız genel vücut beden aralığına dayanarak model bedeninin üstüne çıkma.
            0. wardrobeSizeSupport aynı kesim/model geçmişidir. Her taramada AI'ya sorulur; bu dizi
               bedeni kilitlemez. "Şu ürünü M almıştı, sende şöyle olmuştu" şeklinde destek kanıtıdır.
               Kullanıcı notunu ve howItFit cümlesini gerekçede kullan. Aktif ürünün tablosu, FitLabel'ı
               veya kumaşı farklıysa başka beden seçebilirsin; o zaman neden önceki bedenin bu üründe
               birebir taşınmadığını bir cümlede söyle.
            0.1 UserFitNotes yalnız aynı ürün veya aktif kalıpla yeterince uyumlu kayıtlarda verilir.
               Bölgesel notu başka kalıp ailesine veya tüm kategoriye taşıma.
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
            9.3 Her kombin için renk uyumu, üst-alt hacim dengesi, paça/gövde kesimi ve katman oranının
                neden birlikte iyi durduğunu açıkla. Kombin sayısını doldurmak zorunda değilsin.
            9.4 Görsel erişilemiyor ve ürün adı renk/kalıp kanıtı vermiyorsa tahmin yürütme; daha az
                kombin veya sıfır kombin döndür. Aynı parçayı yalnız başlık değiştirerek tekrar etme.
                direction içinde en az bir gerçek renk adını ve bir kesim/siluet terimini açıkça yaz;
                “renkler uyumlu” gibi genel cümle kullanma.
            9.5 KeptTooBaggy ve KeptTooTight parçalar iade edilmediyse dolapta kalır. UserFitNotes ve
                FitAssessment bilgisini siluet kararında kullan; rahatsız edici kullanımı iyi kombin diye sunma.
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
                 Hedef, cm formülü, bolluk hesabı veya teknik karşılaştırma yazma. Kullanıcıyı ikna eden
                 sade dil kullan. İç sistem adlarını ve hesap günlüğünü yazma.
            11. Güven puanı kesinlik değildir. Asla 100 verme; ölçülü ve doğrulanmış kategori kanıtı
                sınırlıysa 50-70 aralığını kullan.
            """;

        return new
        {
            model = settings.Model,
            instructions = $"""
                You are FitMemory's final size controller and wardrobe stylist. Write every user-facing field in {responseLanguage}.
                Yerel ölçü motoru yalnızca bir taslak üretir. Nihai bedeni sen seçersin.
                Perakendecinin aktif beden tablosunu kullanıcının açık vücut ölçüleri, doğrulanmış giysi
                ölçüleri, iade nedenleri, kalıp tercihi ve ürünün FitLabel / kesim / dikiş / kumaş
                etiketleriyle karşılaştır. Yalnız sağlanan kanıta dayalı, kısa ve kararlı bir beden
                kararı üret. Asla ölçü uydurma. Kombin yorumu ikincildir; asıl işin doğru bedeni seçmektir.
                Aynı beden etiketini farklı kalıplarda eşit sayma: Straight ile Super Baggy, Slim ile
                Wide Leg, Boxy ile Oversized ayrı kanıt aileleridir. Boxy'yi Oversized sayma; ürün
                kalıbının kendi bolluğunu kullanıcı tercihine ekleyerek iki kez büyütme.
                Beden analizinde kategorileri kesin biçimde izole et. Stil analizinde ise yalnız wardrobe
                listesindeki gerçek, iade edilmemiş parçalarla yaş bağlamını nazikçe dikkate alan
                giyilebilir kombinler kur. Dolap parçalarını beden kararının ölçü kanıtı olarak kullanma.
                """,
            input,
            reasoning = new
            {
                effort = settings.ReasoningEffort
            },
            text = new
            {
                format = new
                {
                    type = "json_schema",
                    name = "fit_recommendation",
                    strict = true,
                    schema = new
                    {
                        type = "object",
                        additionalProperties = false,
                        properties = new
                        {
                            recommendedSize = new { type = "string" },
                            confidence = new { type = "integer", minimum = 0, maximum = 100 },
                            verdict = new { type = "string" },
                            explanation = new { type = "string" },
                            fitNotes = new
                            {
                                type = "array",
                                items = new { type = "string" },
                                maxItems = 5
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
                    }
                }
            },
            max_output_tokens = 2800,
            store = false
        };
    }

    private static string ExtractOutputText(string responseBody)
    {
        using var document = JsonDocument.Parse(responseBody);
        var root = document.RootElement;
        if (root.TryGetProperty("output_text", out var outputText) &&
            outputText.ValueKind == JsonValueKind.String)
        {
            return outputText.GetString()
                ?? throw new InvalidOperationException("OpenAI null çıktı döndürdü.");
        }

        if (root.TryGetProperty("output", out var output) &&
            output.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in output.EnumerateArray())
            {
                if (!item.TryGetProperty("content", out var content) ||
                    content.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                foreach (var contentItem in content.EnumerateArray())
                {
                    if (contentItem.TryGetProperty("text", out var text) &&
                        text.ValueKind == JsonValueKind.String)
                    {
                        return text.GetString()
                            ?? throw new InvalidOperationException("OpenAI null çıktı döndürdü.");
                    }
                }
            }
        }

        throw new InvalidOperationException("OpenAI metin çıktısı döndürmedi.");
    }

    private static string ExtractApiError(string responseBody)
    {
        try
        {
            var node = JsonNode.Parse(responseBody);
            return node?["error"]?["message"]?.GetValue<string>() ?? Limit(responseBody, 500);
        }
        catch (JsonException)
        {
            return Limit(responseBody, 500);
        }
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
            throw new InvalidOperationException("OpenAI eksik bir beden önerisi döndürdü.");
        }

        if (availableSizes.Count > 0 &&
            !availableSizes.Contains(result.RecommendedSize.Trim(), StringComparer.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"OpenAI'ın önerdiği '{result.RecommendedSize}' bedeni taranan tabloda bulunmuyor.");
        }
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
