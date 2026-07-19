using FitMemory.Api.Contracts;
using FitMemory.Api.Models;

namespace FitMemory.Api.Services;

public sealed class ProductCategoryService(
    ProductIdentityService productIdentityService)
{
    public IReadOnlyList<OrderHistoryItem> SelectForProduct(
        IReadOnlyList<OrderHistoryItem> orders,
        ProductDto product)
    {
        if (orders.Count == 0)
        {
            return orders;
        }

        var activeGroup = GetGroup(product);
        if (activeGroup == ProductCategoryGroup.Other)
        {
            return orders
                .Where(order => productIdentityService.IsSameFamily(
                    order,
                    product))
                .ToArray();
        }

        return orders
            .Where(order => GetGroup(order) == activeGroup)
            .ToArray();
    }

    public ProductCategoryGroup GetGroup(ProductDto product)
    {
        return Classify($"{product.Category} {product.Name}");
    }

    public ProductCategoryGroup GetGroup(OrderHistoryItem order)
    {
        return Classify($"{order.Category} {order.ProductName}");
    }

    public string GetTurkishLabel(ProductDto product)
    {
        return GetGroup(product) switch
        {
            ProductCategoryGroup.Tees => "Tişört",
            ProductCategoryGroup.Shirts => "Gömlek",
            ProductCategoryGroup.Outerwear => "Mont ve dış giyim",
            ProductCategoryGroup.Knitwear => "Sweat ve triko",
            ProductCategoryGroup.Bottoms => "Pantolon ve alt giyim",
            ProductCategoryGroup.Dresses => "Elbise ve tulum",
            ProductCategoryGroup.Footwear => "Ayakkabı",
            ProductCategoryGroup.Accessories => "Aksesuar",
            ProductCategoryGroup.Tops => "Üst giyim",
            _ => "Aynı model"
        };
    }

    private static ProductCategoryGroup Classify(string value)
    {
        var normalized = value.ToLowerInvariant();

        if (ContainsAny(
                normalized,
                "tişört",
                "tisort",
                "t-shirt",
                "t shirt",
                " tee ",
                "tee-shirt"))
        {
            return ProductCategoryGroup.Tees;
        }

        if (ContainsAny(
                normalized,
                "mont",
                "ceket",
                "kaban",
                "parka",
                "coat",
                "jacket",
                "outerwear",
                "şişme",
                "sisme",
                "blazer",
                "trençkot",
                "trenckot"))
        {
            return ProductCategoryGroup.Outerwear;
        }

        if (ContainsAny(
                normalized,
                "sweat",
                "hoodie",
                "kazak",
                "triko",
                "knit",
                "hırka",
                "hirka",
                "cardigan",
                "jumper",
                "pullover"))
        {
            return ProductCategoryGroup.Knitwear;
        }

        if (ContainsAny(
                normalized,
                "gömlek",
                "gomlek",
                "shirt",
                "overshirt"))
        {
            return ProductCategoryGroup.Shirts;
        }

        if (ContainsAny(
                normalized,
                "pantolon",
                "jean",
                "denim",
                "trouser",
                "pants",
                "bottom",
                "şort",
                "sort",
                "short",
                "etek",
                "skirt"))
        {
            return ProductCategoryGroup.Bottoms;
        }

        if (ContainsAny(
                normalized,
                "elbise",
                "tulum",
                "dress",
                "jumpsuit"))
        {
            return ProductCategoryGroup.Dresses;
        }

        if (ContainsAny(
                normalized,
                "ayakkabı",
                "ayakkabi",
                "sneaker",
                "trainer",
                "loafer",
                "sandal",
                "terlik",
                "slipper",
                "bot",
                "çizme",
                "cizme",
                "shoe",
                "footwear"))
        {
            return ProductCategoryGroup.Footwear;
        }

        if (ContainsAny(
                normalized,
                "aksesuar",
                "accessory",
                "çanta",
                "canta",
                "bag",
                "kemer",
                "belt",
                "şapka",
                "sapka",
                "hat",
                "atkı",
                "atki",
                "scarf"))
        {
            return ProductCategoryGroup.Accessories;
        }

        if (ContainsAny(
                normalized,
                "tops",
                " top",
                "bluz",
                "blouse",
                "polo",
                "üst",
                "ust"))
        {
            return ProductCategoryGroup.Tops;
        }

        return ProductCategoryGroup.Other;
    }

    private static bool ContainsAny(
        string value,
        params string[] candidates)
    {
        var padded = $" {value} ";
        return candidates.Any(candidate =>
            padded.Contains(candidate, StringComparison.Ordinal));
    }
}

public enum ProductCategoryGroup
{
    Other,
    Tees,
    Shirts,
    Outerwear,
    Knitwear,
    Bottoms,
    Dresses,
    Footwear,
    Accessories,
    Tops
}
