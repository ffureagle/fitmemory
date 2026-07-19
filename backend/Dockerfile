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

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app/api
ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

COPY --from=build /app/api /app/api
COPY --from=build /app/migrate /app/migrate
USER $APP_UID
ENTRYPOINT ["dotnet", "FitMemory.Api.dll"]
