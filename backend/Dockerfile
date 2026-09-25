FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src

# Restaurarea se face pe csproj-uri, înaintea copierii sursei: un `docker build` după o modificare de
# cod nu mai reia restaurarea de pachete.
COPY TTRMap.Domain/TTRMap.Domain.csproj TTRMap.Domain/
COPY TTRMap.Application/TTRMap.Application.csproj TTRMap.Application/
COPY TTRMap.Infrastructure/TTRMap.Infrastructure.csproj TTRMap.Infrastructure/
COPY TTRMap.Api/TTRMap.Api.csproj TTRMap.Api/
RUN dotnet restore TTRMap.Api/TTRMap.Api.csproj

COPY . .
RUN dotnet publish TTRMap.Api/TTRMap.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
WORKDIR /app
COPY --from=build /app .

# `curl` e folosit de healthcheck-ul din compose; imaginea de runtime nu îl are implicit.
RUN apk add --no-cache curl

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "TTRMap.Api.dll"]
