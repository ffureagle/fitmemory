namespace FitMemory.Api.Models;

public enum OrderOutcome
{
    PurchasedUnknownFit,
    KeptGoodFit,
    ReturnedTooBaggy,
    ReturnedTooTight,
    KeptTooBaggy,
    KeptTooTight
}

public static class OrderOutcomeExtensions
{
    public static bool IsReturned(this OrderOutcome outcome)
    {
        return outcome is
            OrderOutcome.ReturnedTooBaggy or
            OrderOutcome.ReturnedTooTight;
    }

    public static bool IsInCloset(this OrderOutcome outcome)
    {
        return !outcome.IsReturned();
    }

    public static bool IsBaggyFeedback(this OrderOutcome outcome)
    {
        return outcome is
            OrderOutcome.KeptTooBaggy or
            OrderOutcome.ReturnedTooBaggy;
    }

    public static bool IsTightFeedback(this OrderOutcome outcome)
    {
        return outcome is
            OrderOutcome.KeptTooTight or
            OrderOutcome.ReturnedTooTight;
    }

    public static bool IsNegativeFitFeedback(this OrderOutcome outcome)
    {
        return outcome.IsBaggyFeedback() ||
               outcome.IsTightFeedback();
    }

    public static string ToTurkishFitSummary(this OrderOutcome outcome)
    {
        return outcome switch
        {
            OrderOutcome.KeptGoodFit => "sende iyi olmuştu",
            OrderOutcome.KeptTooBaggy => "bol gelmişti, dolapta kaldı",
            OrderOutcome.KeptTooTight => "dar gelmişti, dolapta kaldı",
            OrderOutcome.ReturnedTooBaggy => "bol geldiği için iade edilmişti",
            OrderOutcome.ReturnedTooTight => "dar geldiği için iade edilmişti",
            _ => "uyum notu henüz belirsizdi"
        };
    }
}
