using System.Net;
using System.Text;

public static class GitHubPastePage
{
    private static readonly (string Path, bool Create, string Title)[] Files =
    [
        ("backend/Dockerfile", false, "1. Sunucunun düşmesini keser"),
        ("backend/Services/ArchivedFitBackfillHostedService.cs", true, "2. Yeni dosya — 4’ten önce kaydet"),
        ("backend/GitHubPastePage.cs", true, "3. Yeni dosya — 4’ten önce kaydet"),
        ("backend/Program.cs", false, "4. Açılış"),
        ("backend/Services/SizeRecommendationService.cs", false, "5. AI bedeni ezmesin"),
        ("backend/Services/LocalFitRecommendationEngine.cs", false, "6. Pantolon 42"),
        ("backend/Services/PlaywrightProductAgentService.cs", false, "7. Tarayıcı yoksa düşmesin"),
        ("backend/Services/GeminiRecommendationClient.cs", false, "8. AI talimatı"),
        ("backend/Services/OpenAiRecommendationClient.cs", false, "9. AI talimatı")
    ];

    public static IResult Page()
    {
        var root = FindRepoRoot();
        if (root is null)
        {
            return Results.NotFound();
        }

        var body = new StringBuilder();
        body.Append("""
            <!doctype html>
            <html lang="tr">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>Yapıştır</title>
              <style>
                body{margin:0;background:#111;color:#fff;font-family:ui-sans-serif,system-ui,sans-serif}
                main{max-width:720px;margin:0 auto;padding:28px 16px 80px}
                h1{font-size:28px;margin:0 0 12px}
                h2{font-size:18px;margin:28px 0 8px;color:#ffe14a}
                p,li{font-size:17px;line-height:1.45;color:#ddd}
                .warn{background:#3a1c12;color:#ffd0c0;padding:12px 14px;border-radius:12px}
                textarea{width:100%;min-height:160px;margin:8px 0;padding:10px;border-radius:10px;background:#1c1c1c;color:#ffe14a;border:1px solid #333;font:12px ui-monospace,monospace;box-sizing:border-box}
                a.btn,button.btn{display:block;text-align:center;margin:8px 0 18px;background:#ffe14a;color:#111;text-decoration:none;padding:14px;border-radius:14px;font-weight:800;border:0;width:100%;font-size:16px}
                a{color:#ffe14a}
              </style>
            </head>
            <body>
              <main>
                <h1>Klasör yok. Kutuları yapıştır.</h1>
                <p class="warn">Her kutu için: Kopyala → GitHub’da aç → sayfadaki eski yazının hepsini sil → yapıştır → yeşil kaydet. Sırayla 1’den 9’a. Kutu 2 ve 3 yeni dosya; kutu 4’ten önce onları kaydet. Kutu 1’den sonra sunucuyu bir kez başlatabilirsin; pantolon 42 için dokuzun da bitmesi gerekir.</p>
            """);

        for (var i = 0; i < Files.Length; i++)
        {
            var (relative, create, title) = Files[i];
            var full = Path.Combine(root, relative);
            if (!System.IO.File.Exists(full))
            {
                continue;
            }

            var encoded = WebUtility.HtmlEncode(System.IO.File.ReadAllText(full));
            var id = $"f{i}";
            var github = create
                ? CreateUrl(relative)
                : $"https://github.com/ffureagle/fitmemory/edit/main/{relative}";
            var action = create ? "GitHub’da yeni dosya aç, yapıştır, kaydet" : "GitHub’da aç, yapıştır, kaydet";
            body.Append($"""
                <h2>{WebUtility.HtmlEncode(title)}</h2>
                <p><code>{WebUtility.HtmlEncode(relative)}</code></p>
                <textarea id="{id}" readonly onclick="this.select()">{encoded}</textarea>
                <button class="btn" type="button" onclick="navigator.clipboard.writeText(document.getElementById('{id}').value)">Kutuyu kopyala</button>
                <a class="btn" href="{github}">{action}</a>
                """);
        }

        body.Append("""
                <p>Bitince sunucu sayfasında Manual Deploy → Deploy latest commit.</p>
              </main>
            </body>
            </html>
            """);
        return Results.Content(body.ToString(), "text/html; charset=utf-8");
    }

    private static string CreateUrl(string relative)
    {
        var slash = relative.LastIndexOf('/');
        var dir = relative[..slash];
        var name = relative[(slash + 1)..];
        return $"https://github.com/ffureagle/fitmemory/new/main/{dir}?filename={Uri.EscapeDataString(name)}";
    }

    private static string? FindRepoRoot()
    {
        foreach (var start in new[]
                 {
                     "/workspace",
                     AppContext.BaseDirectory,
                     Directory.GetCurrentDirectory()
                 })
        {
            var dir = new DirectoryInfo(start);
            while (dir is not null)
            {
                if (System.IO.File.Exists(Path.Combine(dir.FullName, "backend", "Dockerfile")) &&
                    System.IO.File.Exists(Path.Combine(dir.FullName, "render.yaml")))
                {
                    return dir.FullName;
                }

                dir = dir.Parent;
            }
        }

        return null;
    }
}
