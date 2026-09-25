using System.Net;
using System.Net.Http.Headers;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;

namespace TTRMap.Infrastructure.Services;

/// <summary>Setările sursei DEM (Copernicus GLO-30, găzduit public de AWS Open Data).</summary>
public sealed class CopernicusOptions
{
    public const string SectionName = "Copernicus";

    /// <summary>
    /// Găzduit public, fără cont și fără cheie — măsurat 2026-09-23: HTTP 200, `accept-ranges: bytes`,
    /// ~41 MB pentru un tile de 1°×1°. (Proprietatea e a DLR/Airbus, sub Copernicus; atribuirea e
    /// obligatorie și e afișată pe hartă.)
    /// </summary>
    public string BaseUrl { get; set; } = "https://copernicus-dem-30m.s3.amazonaws.com";

    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// Cîte tile-uri decodate ținem minte. Un tile are 4 MB, iar un traseu de planificator atinge
    /// 1–4 tile-uri, deci atît e suficient ca să nu recitim de la AWS la fiecare editare de traseu.
    /// </summary>
    public int MaxCachedTiles { get; set; } = 6;

    public string UserAgent { get; set; } = "TTR/1.0 (+https://ttr.quest; altitudini DEM)";
}

/// <summary>
/// Altitudini din DEM-ul Copernicus GLO-30, citit direct din arhiva publică prin **cereri parțiale**
/// (`Range`): nu se descarcă niciodată un fișier de 41 MB ca să afli o altitudine, ci doar capul lui
/// și tile-ul de 1024×1024 care conține punctul.
///
/// <para>
/// Cache-ul e pe tile-uri decodate, nu pe puncte: o rută cu 100 de puncte atinge de obicei 1–4
/// tile-uri, deci al doilea punct din același tile nu mai costă nimic. Un cache pe puncte ar păstra
/// mii de valori de 8 octeți și tot ar plăti citirea tile-ului la următoarea rută.
/// </para>
/// </summary>
public sealed class CopernicusElevationProvider(
    IHttpClientFactory httpClientFactory,
    IMemoryCache cache,
    IOptions<CopernicusOptions> options,
    ILogger<CopernicusElevationProvider> logger) : IElevationProvider
{
    public const string HttpClientName = "copernicus-dem";

    /// <summary>Plafon de siguranță: un header stricat nu are voie să ne ceară gigabytes.</summary>
    private const int MaxTileBytes = 20 * 1024 * 1024;

    public async Task<IReadOnlyList<double?>> GetElevationsAsync(
        IReadOnlyList<GeoPoint> points, CancellationToken ct = default)
    {
        var results = new double?[points.Count];

        for (var i = 0; i < points.Count; i++)
        {
            try
            {
                results[i] = await ElevationAtAsync(points[i], ct);
            }
            catch (Exception ex) when (
                ex is HttpRequestException or InvalidDataException or TaskCanceledException
                && !ct.IsCancellationRequested)
            {
                // O sursă externă picată nu are voie să strice toată cererea: punctul rămîne „nu știm",
                // iar ecranul poate spune „altitudinea nu e disponibilă acum" fără să mintă cu 0.
                logger.LogWarning(ex, "Altitudinea pentru {Lat},{Lon} nu a putut fi citită.",
                    points[i].Latitude, points[i].Longitude);
                results[i] = null;
            }
        }

        return results;
    }

    private async Task<double?> ElevationAtAsync(GeoPoint point, CancellationToken ct)
    {
        var name = GeoTiffDem.TileFileName(point.Latitude, point.Longitude);
        var url = $"{options.Value.BaseUrl.TrimEnd('/')}/{name}/{name}.tif";

        var header = await GetHeaderAsync(url, ct);
        if (header is null) return null;

        if (!GeoTiffDem.IsSupported(header))
        {
            logger.LogWarning(
                "DEM-ul de la {Url} nu are forma pe care o citim (bits={Bits}, format={Format}, " +
                "compresie={Compression}, predictor={Predictor}). Se sare peste, nu se ghicește.",
                url, header.BitsPerSample, header.SampleFormat, header.Compression, header.Predictor);
            return null;
        }

        var pixel = GeoTiffDem.Project(header, point.Latitude, point.Longitude);
        if (pixel is null) return null;

        var (column, row) = pixel.Value;
        var tile = await GetTileAsync(url, header, header.TileIndexFor(column, row), ct);
        if (tile is null) return null;

        return ElevationPolicy.Sanitize(GeoTiffDem.ValueAt(header, tile, column, row));
    }

    private async Task<GeoTiffDem.Header?> GetHeaderAsync(string url, CancellationToken ct)
    {
        var key = $"dem-header:{url}";
        if (cache.TryGetValue(key, out GeoTiffDem.Header? cached)) return cached;

        var bytes = await FetchRangeAsync(url, 0, GeoTiffDem.HeaderBytes - 1, ct);
        var header = bytes is null ? null : GeoTiffDem.ParseHeader(bytes);

        if (header is not null)
        {
            cache.Set(key, header, new MemoryCacheEntryOptions { Size = 1, SlidingExpiration = TimeSpan.FromHours(6) });
        }

        return header;
    }

    private async Task<float[]?> GetTileAsync(
        string url, GeoTiffDem.Header header, int tileIndex, CancellationToken ct)
    {
        var key = $"dem-tile:{url}#{tileIndex}";
        if (cache.TryGetValue(key, out float[]? cached)) return cached;

        if (tileIndex < 0 || tileIndex >= header.TileByteCounts.Length) return null;

        var byteCount = header.TileByteCounts[tileIndex];
        if (byteCount is <= 0 or > MaxTileBytes)
        {
            logger.LogWarning("Tile-ul {Index} de la {Url} are {Bytes} octeți; îl sar.", tileIndex, url, byteCount);
            return null;
        }

        var offset = header.TileOffsets[tileIndex];
        var compressed = await FetchRangeAsync(url, offset, offset + byteCount - 1, ct);
        if (compressed is null) return null;

        var expected = header.TileWidth * header.TileHeight * 4;
        var inflated = GeoTiffDem.Inflate(compressed, expected);
        var tile = GeoTiffDem.DecodeTile(inflated, header.TileWidth, header.TileHeight);

        cache.Set(key, tile, new MemoryCacheEntryOptions { Size = 1, SlidingExpiration = TimeSpan.FromHours(2) });
        return tile;
    }

    /// <summary>Citește un interval de octeți. `null` cînd sursa răspunde că nu are ce cerem.</summary>
    private async Task<byte[]?> FetchRangeAsync(string url, long from, long to, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Range = new RangeHeaderValue(from, to);

        using var response = await client.SendAsync(request, ct);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden)
        {
            // În afara acoperirii DEM (ocean, latitudini extreme) — nu e o eroare a noastră.
            return null;
        }

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsByteArrayAsync(ct);
    }
}
