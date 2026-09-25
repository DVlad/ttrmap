using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;

namespace TTRMap.Infrastructure.Services;

/// <summary>Setările sursei OSM (Overpass).</summary>
public sealed class OverpassOptions
{
    public const string SectionName = "Overpass";

    /// <summary>
    /// Mirror-urile, în ordinea încercării. Ordinea e o **măsurătoare**, nu o preferință (2026-09-23):
    /// `overpass-api.de` a răspuns 504 și 406, `kumi.systems` a răspuns în 177 de secunde dar apoi a
    /// dat 429 la cereri repetate, iar `private.coffee` a răspuns imediat. Cînd unul se satură,
    /// următorul preia — de aceea lista are trei, nu unul.
    /// </summary>
    public string[] Endpoints { get; set; } =
    [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ];

    /// <summary>
    /// Numele cu care ne prezentăm la Overpass. **Obligatoriu**: fără `User-Agent`, Overpass răspunde
    /// 406 (verificat la primul import real). Politica lor cere un agent care identifică aplicația, nu
    /// unul gol sau fals.
    /// </summary>
    public string UserAgent { get; set; } = "TTR/1.0 (+https://ttr.quest; import puncte montane)";

    /// <summary>Timeout-ul clientului HTTP: peste limita implicită de 100 s, pentru că sursa e lentă.</summary>
    public int TimeoutSeconds { get; set; } = 240;
}

/// <summary>
/// Importul punctelor montane din Overpass. Citește, clasifică (prin
/// <see cref="OsmMountainPoiMapper"/>, care e pur) și scrie în bază.
/// </summary>
public sealed class OverpassMountainPoiImporter(
    IHttpClientFactory httpClientFactory,
    IMountainPoiRepository repository,
    IOptions<OverpassOptions> options,
    ILogger<OverpassMountainPoiImporter> logger) : IOsmMountainPoiImporter
{
    public const string HttpClientName = "overpass";

    public async Task<MountainPoiImportResult> ImportAsync(GeoBbox bbox, CancellationToken ct = default)
    {
        var query = OsmMountainPoiMapper.BuildQuery(bbox);
        var (json, endpoint) = await FetchAsync(query, ct);

        var readAt = DateTime.UtcNow;
        var mapped = OsmMountainPoiMapper.Map(json, readAt);

        // Plafonul e pe lot, nu pe sursă: dacă zona întoarce mai mult decît acceptăm, luăm primele
        // rînduri și spunem în rezultat cîte au fost lăsate afară — nu tăcem și nu umflăm baza.
        var accepted = mapped.Count > MountainPoiPolicy.MaxImportLimit
            ? mapped.Take(MountainPoiPolicy.MaxImportLimit).ToList()
            : [.. mapped];

        var result = await repository.UpsertManyAsync(accepted, ct);

        logger.LogInformation(
            "Import puncte montane pentru {Bbox}: {Fetched} de la sursă, {Accepted} acceptate, " +
            "{Inserted} noi, {Updated} actualizate, sursa {Endpoint}.",
            bbox.ToString(), mapped.Count, accepted.Count, result.Inserted, result.Updated, endpoint);

        return new MountainPoiImportResult(mapped.Count, accepted.Count, result.Inserted, result.Updated, endpoint);
    }

    private async Task<(string Json, string Endpoint)> FetchAsync(string query, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient(HttpClientName);
        var endpoints = options.Value.Endpoints;
        Exception? lastError = null;

        foreach (var endpoint in endpoints)
        {
            var stopwatch = Stopwatch.StartNew();
            try
            {
                using var content = new FormUrlEncodedContent([new KeyValuePair<string, string>("data", query)]);
                using var response = await client.PostAsync(endpoint, content, ct);

                if (!response.IsSuccessStatusCode)
                {
                    lastError = new HttpRequestException(
                        $"Overpass a răspuns {(int)response.StatusCode} pe {endpoint}.");
                    logger.LogWarning(
                        "Overpass {Endpoint} a răspuns {Status} după {Seconds:0.0} s; încerc următorul mirror.",
                        endpoint, (int)response.StatusCode, stopwatch.Elapsed.TotalSeconds);
                    continue;
                }

                var json = await response.Content.ReadAsStringAsync(ct);
                logger.LogInformation(
                    "Overpass {Endpoint}: răspuns în {Seconds:0.0} s, {Kb:0} KB.",
                    endpoint, stopwatch.Elapsed.TotalSeconds, json.Length / 1024.0);
                return (json, endpoint);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                lastError = ex;
                logger.LogWarning(ex, "Overpass {Endpoint} a eșuat; încerc următorul mirror.", endpoint);
            }
        }

        throw new OverpassUnavailableException(
            $"Niciun mirror Overpass nu a răspuns ({string.Join(", ", endpoints)}).", lastError);
    }
}
