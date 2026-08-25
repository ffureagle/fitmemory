FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props FitMemory.sln ./
COPY backend/FitMemory.Api.csproj backend/
COPY migration/FitMemory.Migrate/FitMemory.Migrate.csproj migration/FitMemory.Migrate/
RUN dotnet restore FitMemory.sln

COPY backend/ backend/
COPY migration/ migration/
RUN dotnet publish backend/FitMemory.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/api \
    /p:UseAppHost=false
RUN dotnet publish migration/FitMemory.Migrate/FitMemory.Migrate.csproj \
    --configuration Release \
    --no-restore \
    --output /app/migrate \
    /p:UseAppHost=false

# Official ASP.NET 10 runtime. Do not overlay .NET 10 onto the Playwright
# image: mixed hostfxr/OpenSSL native libraries segfault (Render status 139)
# on the 512 MB free instance. Product scanning runs in the extension/mobile
# clients; server-side Chromium is optional and fails softly if missing.
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app/api
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
ENV ASPNETCORE_ENVIRONMENT=Production
ENV DOTNET_EnableDiagnostics=0
ENV DOTNET_SYSTEM_NET_DISABLEIPV6=1
ENV SQLITE_PATH=/app/data/fitmemory.db
EXPOSE 8080

COPY --from=build /app/api /app/api
COPY --from=build /app/migrate /app/migrate
RUN mkdir -p /app/data && chown "$APP_UID":"$APP_UID" /app/data
USER $APP_UID
ENTRYPOINT ["dotnet", "FitMemory.Api.dll"]
