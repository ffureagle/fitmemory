using System.ComponentModel.DataAnnotations;

namespace FitMemory.Api.Models;

public sealed class UserAccount
{
    public int Id { get; set; }

    [MaxLength(128)]
    public required string PublicId { get; set; }

    [MaxLength(254)]
    public required string Email { get; set; }

    [MaxLength(254)]
    public required string NormalizedEmail { get; set; }

    [MaxLength(60)]
    public required string DisplayName { get; set; }

    [MaxLength(1000)]
    public required string PasswordHash { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public UserProfile? Profile { get; set; }

    public ICollection<UserSession> Sessions { get; set; } =
        new List<UserSession>();
}
