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
    public bool IsConfigured()
    {
        var settings = options.Value;
        return !string.IsNullOrWhiteSpace(settings.Host) &&
               !string.IsNullOrWhiteSpace(settings.FromAddress);
    }

    public async Task<bool> TrySendCodeAsync(
        string recipient,
        string code,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured())
        {
            logger.LogWarning("SMTP is not configured; password reset code will be shown in the app.");
            return false;
        }

        var settings = options.Value;
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
            Timeout = 20_000,
            UseDefaultCredentials = false,
            Credentials = string.IsNullOrWhiteSpace(settings.Username)
                ? CredentialCache.DefaultNetworkCredentials
                : new NetworkCredential(settings.Username, settings.Password)
        };
        try
        {
            await client.SendMailAsync(message).WaitAsync(
                TimeSpan.FromSeconds(25),
                cancellationToken);
            return true;
        }
        catch (Exception exception) when (exception is SmtpException or TimeoutException)
        {
            logger.LogError(exception, "Password reset email could not be delivered.");
            return false;
        }
    }
}
