using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace FitMemory.Api.Services;

public sealed partial class RegionalFitFeedbackService
{
    private static readonly IReadOnlyDictionary<string, string[]> MetricTerms =
        new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["Chest"] = ["gogus", "gogusten", "chest"],
            ["Waist"] = ["bel", "belden", "waist"],
            ["Shoulder"] = ["omuz", "omuzdan", "shoulder"],
            ["Length"] = ["boy", "boydan", "uzunluk", "length"],
            ["Sleeve"] = ["kol", "koldan", "sleeve"],
            ["Hip"] = ["kalca", "kalcadan", "basen", "hip"],
            ["Inseam"] = ["ic bacak", "bacaktan", "paca", "inseam"]
        };

    private static readonly string[] TightTerms =
        ["dar", "siki", "sikiyor", "kucuk", "geriyor", "tight"];

    private static readonly string[] LooseTerms =
        ["bol", "genis", "buyuk", "saliyor", "loose", "baggy"];

    private static readonly string[] GoodTerms =
        ["tam", "iyi", "ideal", "uygun", "oldu", "oturdu", "good", "perfect"];

    public IReadOnlyList<RegionalFitSignal> Parse(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes))
        {
            return [];
        }

        var normalized = Normalize(notes);
        var signals = new List<RegionalFitSignal>();
        foreach (var (metric, terms) in MetricTerms)
        {
            var positions = terms
                .SelectMany(term => AllIndexes(normalized, term))
                .Distinct()
                .ToArray();
            foreach (var position in positions)
            {
                var state = DetectNearestState(normalized, position);
                if (state is null ||
                    signals.Any(signal =>
                        signal.Metric == metric &&
                        signal.State == state.Value))
                {
                    continue;
                }

                signals.Add(new RegionalFitSignal(metric, state.Value));
            }
        }

        return signals;
    }

    public bool HasNegativeSignal(string? notes)
    {
        return Parse(notes).Any(signal =>
            signal.State is RegionalFitState.Tight or RegionalFitState.Loose);
    }

    public string Summarize(string? notes)
    {
        var signals = Parse(notes);
        if (signals.Count == 0)
        {
            return "";
        }

        return string.Join(
            ", ",
            signals.Select(signal =>
                $"{MetricLabel(signal.Metric)} {StateLabel(signal.State)}"));
    }

    private static RegionalFitState? DetectNearestState(
        string value,
        int metricPosition)
    {
        var candidates = TightTerms
            .SelectMany(term => AllIndexes(value, term))
            .Select(index => (
                Direction: index >= metricPosition ? 0 : 1,
                Distance: Math.Abs(index - metricPosition),
                State: RegionalFitState.Tight))
            .Concat(LooseTerms
                .SelectMany(term => AllIndexes(value, term))
                .Select(index => (
                    Direction: index >= metricPosition ? 0 : 1,
                    Distance: Math.Abs(index - metricPosition),
                    State: RegionalFitState.Loose)))
            .Concat(GoodTerms
                .SelectMany(term => AllIndexes(value, term))
                .Select(index => (
                    Direction: index >= metricPosition ? 0 : 1,
                    Distance: Math.Abs(index - metricPosition),
                    State: RegionalFitState.Good)))
            .Where(candidate => candidate.Distance <= 28)
            .OrderBy(candidate => candidate.Direction)
            .ThenBy(candidate => candidate.Distance)
         .ToArray();
        return candidates.Length > 0 ? candidates[0].State : null;
    }

    private static IEnumerable<int> AllIndexes(string value, string term)
    {
        var index = 0;
        while ((index = value.IndexOf(term, index, StringComparison.Ordinal)) >= 0)
        {
            yield return index;
            index += term.Length;
        }
    }

    private static string Normalize(string value)
    {
        var decomposed = value.ToLowerInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) ==
                UnicodeCategory.NonSpacingMark)
            {
                continue;
            }
            builder.Append(character switch
            {
                'ı' => 'i',
                'ş' => 's',
                'ğ' => 'g',
                'ç' => 'c',
                'ö' => 'o',
                'ü' => 'u',
                _ => character
            });
        }
        return SpaceRegex().Replace(builder.ToString(), " ").Trim();
    }

    private static string MetricLabel(string metric)
    {
        return metric switch
        {
            "Chest" => "göğüs",
            "Waist" => "bel",
            "Shoulder" => "omuz",
            "Length" => "boy",
            "Sleeve" => "kol",
            "Hip" => "kalça",
            "Inseam" => "iç bacak",
            _ => metric
        };
    }

    private static string StateLabel(RegionalFitState state)
    {
        return state switch
        {
            RegionalFitState.Tight => "dar",
            RegionalFitState.Loose => "bol",
            _ => "tam"
        };
    }

    [GeneratedRegex(@"\s+", RegexOptions.CultureInvariant)]
    private static partial Regex SpaceRegex();
}

public enum RegionalFitState
{
    Good,
    Tight,
    Loose
}

public sealed record RegionalFitSignal(string Metric, RegionalFitState State);
