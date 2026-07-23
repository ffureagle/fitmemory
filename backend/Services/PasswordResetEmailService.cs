using System.Net;
using System.Net.Mail;
using Microsoft.Extensions.Options;

namespace FitMemory.Api.Services;

public sealed class EmailOptions
{
    public const string SectionName = "Email";
    public string Host { get; set; } = "";
    public int Port { get; set; } = 587;
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    public string FromAddress { get; set; } = "";
    public string FromName { get; set; } = "FitMemory";
    public bool EnableSsl { get; set; } = true;
}

public sealed class PasswordResetEmailService(
    IOptions<EmailOptions> options,
    ILogger<PasswordResetEmailService> logger)
{
    public async Task SendCodeAsync(
        string recipient,
        string code,
        CancellationToken cancellationToken)
    {
        var settings = options.Value;
        if (string.IsNullOrWhiteSpace(settings.Host) ||
            string.IsNullOrWhiteSpace(settings.FromAddress))
        {
            logger.LogError("SMTP is not configured; password reset email cannot be sent.");
            throw new AccountFlowException(
                StatusCodes.Status503ServiceUnavailable,
                "E-posta servisi hazır değil",
                "Şifre yenileme e-postası şu anda gönderilemiyor. Lütfen kısa süre sonra tekrar deneyin.");
        }

        using var message = new MailMessage
        {
            From = new MailAddress(settings.FromAddress, settings.FromName),
            Subject = "FitMemory şifre yenileme kodun",
            Body = $"FitMemory şifre yenileme kodun: {code}\n\nBu kod 15 dakika geçerlidir. Bu isteği sen yapmadıysan e-postayı yok say.",
            IsBodyHtml = false
        };
        message.To.Add(recipient);
        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = settings.EnableSsl,
            UseDefaultCredentials = false,
            Credentials = string.IsNullOrWhiteSpace(settings.Username)
                ? CredentialCache.DefaultNetworkCredentials
                : new NetworkCredential(settings.Username, settings.Password)
        };
        await client.SendMailAsync(message).WaitAsync(cancellationToken);
    }
}
