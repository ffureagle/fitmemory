using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class UserSession
{
    public int Id { get; set; }

    public int UserAccountId { get; set; }

    public required UserAccount UserAccount { get; set; }

    [MaxLength(64)]
    public required string TokenHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset ExpiresAt { get; set; }
}
