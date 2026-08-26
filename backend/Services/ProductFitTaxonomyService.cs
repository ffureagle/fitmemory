using System.Globalization;
using System.Text;
using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed class ProductFitTaxonomyService
{
    private const double SizingEvidenceThreshold = 0.95;

    public ProductFitSemantics Describe(ProductDto product)
    {
        var fromName = Describe(product.Name ?? "");
        if (fromName.Family != ProductFitFamily.Unknown)
        {
            return fromName;
        }

        var fromLabel = Describe(product.FitLabel ?? "");
        if (fromLabel.Family != ProductFitFamily.Unknown)
        {
            return fromLabel;
        }

        return Describe(
            $"{product.FitLabel} {product.FitEvidence} {product.Name} {product.Description}");
    }

    public ProductFitSemantics Describe(OrderHistoryItem order)
    {
        var fromName = Describe(order.ProductName ?? "");
        if (fromName.Family != ProductFitFamily.Unknown)
        {
            return fromName;
        }

        return Describe(
            $"{order.FitLabel} {order.ProductName} {order.FitNotes} {order.SizeEvidence}");
    }

    public double Compatibility(OrderHistoryItem order, ProductDto product)
    {
        return Compatibility(Describe(order).Family, Describe(product).Family);
    }

    public bool IsSizingEvidenceEligible(
        OrderHistoryItem order,
        ProductDto product,
        bool sameProductFamily)
    {
        var archived = Describe(order);
        var active = Describe(product);

        if (sameProductFamily)
        {
            return archived.Family == active.Family ||
                   archived.Family == ProductFitFamily.Unknown ||
                   active.Family == ProductFitFamily.Unknown;
        }

        return Compatibility(archived.Family, active.Family) >=
               SizingEvidenceThreshold;
    }

    public bool AreFitLabelsCompatible(
        string? activeFitLabel,
        IEnumerable<string?> archivedFitLabels)
    {
        var active = Describe(activeFitLabel ?? "");
        var archived = archivedFitLabels
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => Describe(value!))
            .ToArray();

        if (active.Family == ProductFitFamily.Unknown ||
            archived.Length == 0)
        {
            return true;
        }

        return archived.Any(item => item.Family == active.Family);
    }

    public ProductFitSemantics Describe(string value)
    {
        var normalized = Normalize(value);
        var family = Classify(normalized);
        return family switch
        {
            ProductFitFamily.SuperBaggy => new(
                family,
                "Super Baggy",
                "Bel etiketi sabit kalsa bile ağ, kalça, basen, uyluk ve paçada belirgin ekstra hacim verir.",
                "Straight 40 bedenin bacak veya kalça bölgesinde dar gelmesi, Super Baggy 40 için dar sınırı oluşturmaz. Aktif ürünün bel ve kalça ölçüsü esas alınır.",
                "Aynı nominal beden farklı bitmiş giysi hacmine sahip olabilir."),
            ProductFitFamily.Baggy => new(
                family,
                "Baggy",
                "Kalça, uyluk ve paçada rahat/geniş hacim verir; bel ölçüsü ürün tablosundan ayrıca doğrulanır.",
                "Straight veya Slim sonuçları doğrudan taşınmaz. Yalnız aynı Baggy ailesi ve aktif ölçü tablosu güçlü kanıttır.",
                "Baggy beden etiketi, Straight beden etiketiyle aynı silueti ifade etmez."),
            ProductFitFamily.WideLeg => new(
                family,
                "Wide Leg",
                "Kalçadan veya üst bacaktan paçaya kadar genişleyen/düz geniş bacak silueti verir.",
                "Bel/kalça uyumu aktif tablodan; bacak hacmi yalnız Wide Leg veya çok yakın Baggy kanıtından değerlendirilir.",
                "Straight dar geri bildirimi geniş paça hacmine aktarılmaz."),
            ProductFitFamily.Straight => new(
                family,
                "Straight",
                "Uyluktan paçaya daha sabit genişlikte, vücudu Baggy kadar sarmayan ama ekstra hacim de üretmeyen düz kesimdir.",
                "Straight 40'taki dar veya bol sonuç yalnız Straight ve çok yakın Regular kesimler için sınırdır.",
                "Super Baggy, Baggy veya Wide Leg ile aynı kalıp kanıtı sayılmaz."),
            ProductFitFamily.Skinny => new(
                family,
                "Skinny",
                "Kalça, uyluk ve paçada vücuda en yakın alt giyim siluetidir.",
                "Skinny geri bildirimi yalnız Skinny ve yakın Slim kesimlerde güçlüdür.",
                "Regular, Straight veya Baggy kesime doğrudan beden sınırı oluşturmaz."),
            ProductFitFamily.Slim => new(
                family,
                "Slim",
                "Vücuda yakın ve daraltılmış siluet verir; Skinny kadar sıkı olmak zorunda değildir.",
                "Slim geri bildirimi Slim/Skinny ailesinde kullanılır; geniş kalıplara doğrudan taşınmaz.",
                "Fit etiketi ayrıca beden büyütme talimatı değildir."),
            ProductFitFamily.Loose => new(
                family,
                "Loose Fit",
                "Rahat, düşen bir siluet verir; bel otururken bacak ve gövdede kontrollü bolluk bırakır. Super Baggy veya Baggy değildir.",
                "Loose Fit kanıtı kendi ailesinde ve yakın Relaxed kesimde kullanılır. Super Baggy veya Baggy sonuçlarıyla aynı hacim sayılmaz.",
                "Ürün adı Loose Fit ise kalıbı Super Baggy veya Baggy olarak yükseltme."),
            ProductFitFamily.Relaxed => new(
                family,
                "Relaxed",
                "Normal bedende hareket payı artırılmış, daha gevşek ama kontrollü bir siluet verir.",
                "Regular kanıtı yalnız düşük ağırlıklı komşu kanıttır; Baggy veya Super Baggy ile eşitlenmez.",
                "Relaxed etiketi tek başına bir beden büyütme talimatı değildir."),
            ProductFitFamily.Boxy => new(
                family,
                "Boxy",
                "Kısa veya dengeli boyla birlikte daha düz, geniş gövde ve düşük omuz etkisi verebilir.",
                "Boxy kanıtı kendi ailesinde değerlendirilir; Oversized ile aynı beden kuralı değildir.",
                "Geniş siluet ürünün kesimindedir, otomatik beden büyütülmez."),
            ProductFitFamily.Oversized => new(
                family,
                "Oversized",
                "Omuz, gövde ve/veya boyda tasarlanmış ekstra hacim oluşturur.",
                "Normal bedende zaten bol siluet üretir; yalnız etiket nedeniyle beden büyütülmez.",
                "Boxy, Relaxed ve Baggy ayrı kalıp aileleridir."),
            ProductFitFamily.Regular => new(
                family,
                "Regular",
                "Markanın standart, dengeli hareket payına sahip temel siluetidir.",
                "Regular ve yakın Straight kanıtı ölçü bölgesi eşleştiğinde kullanılabilir.",
                "Baggy veya Oversized sonuçlarıyla aynı sınır kabul edilmez."),
            _ => new(
                ProductFitFamily.Unknown,
                "Kalıp doğrulanmadı",
                "Resmi kesim etiketi veya güvenilir kalıp ifadesi bulunamadı.",
                "Başka kalıptaki aynı beden etiketi kanıt olarak taşınmaz; aktif ürün tablosu ve aynı ürün ailesi esas alınır.",
                "Kalıp bilinmiyorsa güven düşürülür, varsayım yapılmaz.")
        };
    }

    private static double Compatibility(
        ProductFitFamily archived,
        ProductFitFamily active)
    {
        if (archived == active && archived != ProductFitFamily.Unknown)
        {
            return 1.0;
        }
        if (archived == ProductFitFamily.Unknown ||
            active == ProductFitFamily.Unknown)
        {
            return 0.25;
        }

        return (archived, active) switch
        {
            (ProductFitFamily.Skinny, ProductFitFamily.Slim) or
            (ProductFitFamily.Slim, ProductFitFamily.Skinny) => 0.76,
            (ProductFitFamily.Straight, ProductFitFamily.Regular) or
            (ProductFitFamily.Regular, ProductFitFamily.Straight) => 0.70,
            (ProductFitFamily.Regular, ProductFitFamily.Relaxed) or
            (ProductFitFamily.Relaxed, ProductFitFamily.Regular) => 0.62,
            (ProductFitFamily.Loose, ProductFitFamily.Relaxed) or
            (ProductFitFamily.Relaxed, ProductFitFamily.Loose) => 0.80,
            (ProductFitFamily.Loose, ProductFitFamily.Regular) or
            (ProductFitFamily.Regular, ProductFitFamily.Loose) => 0.55,
            (ProductFitFamily.Loose, ProductFitFamily.Baggy) or
            (ProductFitFamily.Baggy, ProductFitFamily.Loose) => 0.38,
            (ProductFitFamily.Loose, ProductFitFamily.SuperBaggy) or
            (ProductFitFamily.SuperBaggy, ProductFitFamily.Loose) => 0.12,
            (ProductFitFamily.WideLeg, ProductFitFamily.Baggy) or
            (ProductFitFamily.Baggy, ProductFitFamily.WideLeg) => 0.69,
            (ProductFitFamily.Baggy, ProductFitFamily.SuperBaggy) or
            (ProductFitFamily.SuperBaggy, ProductFitFamily.Baggy) => 0.58,
            (ProductFitFamily.Boxy, ProductFitFamily.Oversized) or
            (ProductFitFamily.Oversized, ProductFitFamily.Boxy) => 0.48,
            (ProductFitFamily.Straight, ProductFitFamily.Baggy) or
            (ProductFitFamily.Baggy, ProductFitFamily.Straight) => 0.18,
            (ProductFitFamily.Straight, ProductFitFamily.SuperBaggy) or
            (ProductFitFamily.SuperBaggy, ProductFitFamily.Straight) => 0.08,
            (ProductFitFamily.Slim, ProductFitFamily.SuperBaggy) or
            (ProductFitFamily.SuperBaggy, ProductFitFamily.Slim) => 0.04,
            _ => 0.30
        };
    }

    private static ProductFitFamily Classify(string value)
    {
        if (ContainsAny(value, "super baggy", "superbaggy", "ultra baggy", "extra baggy"))
        {
            return ProductFitFamily.SuperBaggy;
        }
        if (ContainsAny(value, "skinny", "super skinny"))
        {
            return ProductFitFamily.Skinny;
        }
        if (ContainsAny(value, "wide leg", "wide-leg", "genis paca", "genis bacak"))
        {
            return ProductFitFamily.WideLeg;
        }
        if (ContainsAny(value, "loose fit", "loose-fit", "loose kalip", "bol kalip", "bol kesim"))
        {
            return ProductFitFamily.Loose;
        }
        if (ContainsAny(value, "baggy", "balon kalip", "balloon fit"))
        {
            return ProductFitFamily.Baggy;
        }
        if (ContainsAny(value, "straight", "duz kesim", "duz kalip"))
        {
            return ProductFitFamily.Straight;
        }
        if (ContainsAny(value, "muscle", "slim", "fitted", "dar kalip"))
        {
            return ProductFitFamily.Slim;
        }
        if (ContainsAny(value, "boxy", "kutu kalip"))
        {
            return ProductFitFamily.Boxy;
        }
        if (ContainsAny(value, "oversize", "oversized", "asiri bol"))
        {
            return ProductFitFamily.Oversized;
        }
        if (ContainsAny(value, "relaxed", "relax fit", "rahat kalip"))
        {
            return ProductFitFamily.Relaxed;
        }
        if (ContainsAny(value, "regular", "standard fit", "standart kalip"))
        {
            return ProductFitFamily.Regular;
        }
        return ProductFitFamily.Unknown;
    }

    private static bool ContainsAny(string value, params string[] terms)
    {
        return terms.Any(term =>
            value.Contains(term, StringComparison.Ordinal));
    }

    private static string Normalize(string value)
    {
        var decomposed = value
            .ToLowerInvariant()
            .Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) !=
                UnicodeCategory.NonSpacingMark)
            {
                builder.Append(character);
            }
        }
        return builder
            .ToString()
            .Normalize(NormalizationForm.FormC)
            .Replace('ı', 'i');
    }
}

public enum ProductFitFamily
{
    Unknown,
    Skinny,
    Slim,
    Straight,
    Regular,
    Relaxed,
    Loose,
    WideLeg,
    Baggy,
    SuperBaggy,
    Boxy,
    Oversized
}

public sealed record ProductFitSemantics(
    ProductFitFamily Family,
    string Label,
    string Silhouette,
    string SizingRule,
    string CrossFitRule);
