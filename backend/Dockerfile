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

FROM mcr.microsoft.com/playwright/dotnet:v1.60.0-noble AS runtime
RUN curl -sSL https://dot.net/v1/dotnet-install.sh | bash /dev/stdin \
    --install-dir /usr/share/dotnet \
    --channel 10.0 \
    --runtime aspnetcore
WORKDIR /app/api
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

COPY --from=build --chown=pwuser:pwuser /app/api /app/api
COPY --from=build --chown=pwuser:pwuser /app/migrate /app/migrate
USER pwuser
ENTRYPOINT ["dotnet", "FitMemory.Api.dll"]
