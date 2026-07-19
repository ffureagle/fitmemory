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
}
