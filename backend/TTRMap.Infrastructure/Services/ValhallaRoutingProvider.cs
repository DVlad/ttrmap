using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;
using TTRMap.Domain.Enums;

namespace TTRMap.Infrastructure.Services;

/// <summary>Setările motorului de rutare (Valhalla, găzduit de noi).</summary>
public sealed class ValhallaOptions
{
    public const string SectionName = "Valhalla";

    /// <summary>
    /// Adresa serviciului Valhalla. Implicit `localhost`, fiindcă dezvoltarea zilnică se face cu
    /// `dotnet run` pe gazdă; în stivele cu containere se suprascrie cu numele serviciului
    /// (`Valhalla__BaseUrl`), ca imaginea să nu depindă de un nume de container.
    /// </summary>
    public string BaseUrl { get; set; } = "http://localhost:8002";

    /// <summary>
    /// Cît așteptăm un răspuns. Măsurat pe 2026-09-24, pe tile-uri de România: 2–263 ms pentru o
    /// rută, deci 15 s e un plafon larg care prinde doar un motor blocat, nu o rută grea.
    /// </summary>
    public int TimeoutSeconds { get; set; } = 15;

    /// <summary>
    /// Cea mai grea treaptă de traseu pe care o acceptă profilul „pe jos". Scara e cea SAC, în
    /// numerotarea Valhalla: 1 = T1 (hiking), 3 = T3, 5 = T5 (`demanding_alpine_hiking`),
    /// 6 = T6.
    ///
    /// <para>
    /// **Măsurat, nu presupus** (2026-09-24, `ttrmap/docs/F0-MAP-IMPLEMENTATION.md` §4): pe un traseu T5 din
    /// Bucegi, cu valoarea implicită 1, motorul ocolea 22,25 km ca să evite poteca; cu 3, ruta scădea
    /// la 5,18 km. Deci opțiunea e respectată și contează. Valoarea 6 e deliberată: aplicația nu are
    /// de unde să știe cît de experimentat e utilizatorul, iar a refuza o potecă pe care omul o vede
    /// pe hartă e mai rău decît a i-o arăta cu avertizare.
    /// </para>
    /// </summary>
    public int MaxHikingDifficulty { get; set; } = 6;

    /// <summary>
    /// Cît de mult contează o potecă nemarcată. Valhalla penalizează căutarea pe poteci cînd e 0; pe
    /// munte, poteca e exact ce căutăm, deci implicit o preferăm.
    /// </summary>
    public double UseTrails { get; set; } = 1;

    /// <summary>
    /// Cît ținem minte o rută. Planificatorul recalculează la fiecare atingere a hărții, iar o
    /// atingere în același loc dă exact aceeași rută — dar motorul o recalculează de fiecare dată.
    /// TTL scurt: geometria drumurilor se schimbă rar, dar nu vrem să servim o rută veche toată ziua.
    /// </summary>
    public int CacheMinutes { get; set; } = 30;

    public int MaxCachedRoutes { get; set; } = 256;

    public string UserAgent { get; set; } = "TTR/1.0 (+https://ttr.quest; rutare)";
}

/// <summary>
/// Rutare prin Valhalla, găzduit de noi (`ttrmap/docs/STUDY-MAP.md` §5.3, măsurătorile din
/// `ttrmap/docs/F0-MAP-IMPLEMENTATION.md` §4).
///
/// <para>
/// De ce nu OSRM-ul public care era în client: pe trei trasee montane reale măsurate pe 2026-09-24,
/// OSRM a ocolit 41 km în loc de 6,2 km, 38 km în loc de 1,2 km și 37 km în loc de 3 km (0% din rută
/// pe traseul marcat). Valhalla a stat pe traseu 100% în primele două cazuri. El e și backend-ul de
/// rutare al variantei de navigare (§8.3).
/// </para>
/// </summary>
public sealed class ValhallaRoutingProvider(
    IHttpClientFactory httpClientFactory,
    IMemoryCache cache,
    IOptions<ValhallaOptions> options,
    ILogger<ValhallaRoutingProvider> logger) : IRoutingProvider
{
    public const string HttpClientName = "valhalla";

    public async Task<RoutePath?> FindRouteAsync(RouteRequest request, CancellationToken ct = default)
    {
        if (!RoutePlanPolicy.TryValidate(request.Waypoints, out var error))
        {
            logger.LogWarning("Cerere de rutare respinsă înainte de motor: {Error}", error);
            return null;
        }

        var settings = options.Value;
        var key = CacheKey(request, settings);

        if (cache.TryGetValue(key, out RoutePath? cached) && cached is not null) return cached;

        var body = BuildRequest(request, settings);
        var url = $"{settings.BaseUrl.TrimEnd('/')}/route";

        try
        {
            var client = httpClientFactory.CreateClient(HttpClientName);
            using var response = await client.PostAsJsonAsync(url, body, ct);

            if (response.StatusCode is HttpStatusCode.BadRequest)
            {
                // Valhalla răspunde 400 cu un mesaj propriu cînd nu poate lega punctele de rețea
                // (în afara hărții acoperite, sau pe o insulă fără drum). Nu e o eroare a noastră,
                // dar nici nu trebuie să ajungă la client ca „500".
                var detail = await ReadErrorAsync(response, ct);
                logger.LogInformation("Motorul de rutare a refuzat ruta: {Detail}", detail);
                return null;
            }

            response.EnsureSuccessStatusCode();

            var payload = await response.Content.ReadFromJsonAsync<ValhallaResponse>(ct);
            var trip = payload?.Trip;
            if (trip?.Legs is null || trip.Legs.Count == 0) return null;

            var legs = new List<RouteLeg>(trip.Legs.Count);
            foreach (var leg in trip.Legs)
            {
                var geometry = Polyline6
                    .Decode(leg.Shape)
                    .Select(point => new GeoPoint(point.Latitude, point.Longitude))
                    .ToList();

                if (geometry.Count < 2) return null;

                legs.Add(new RouteLeg(
                    (leg.Summary?.Length ?? 0) * 1000,
                    leg.Summary?.Time ?? 0,
                    geometry));
            }

            var path = new RoutePath(legs);
            cache.Set(key, path, new MemoryCacheEntryOptions
            {
                Size = 1,
                AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(settings.CacheMinutes),
            });

            return path;
        }
        catch (Exception ex) when (
            ex is HttpRequestException or TaskCanceledException or JsonException
            && !ct.IsCancellationRequested)
        {
            // Motorul e o componentă separată: cînd cade, planificatorul trebuie să poată spune
            // „rutarea nu e disponibilă acum", nu să deseneze o linie dreaptă ca și cum ar fi rută.
            logger.LogWarning(ex, "Motorul de rutare nu a răspuns pentru {Count} puncte.",
                request.Waypoints.Count);
            return null;
        }
    }

    private static object BuildRequest(RouteRequest request, ValhallaOptions settings)
    {
        var locations = request.Waypoints
            .Select(point => new ValhallaLocation(point.Latitude, point.Longitude))
            .ToArray();

        var (costing, costingOptions) = CostingFor(request.Profile, settings);

        return new
        {
            locations,
            costing,
            costing_options = new Dictionary<string, object> { [costing] = costingOptions },
            directions_options = new { units = "kilometers" },
        };
    }

    /// <summary>
    /// Traducerea profilului nostru în costul Valhalla. Stă într-un singur loc, ca o schimbare de
    /// motor să nu însemne căutarea prin tot codul.
    /// </summary>
    private static (string Costing, Dictionary<string, object> Options) CostingFor(
        TravelProfile profile, ValhallaOptions settings) => profile switch
    {
        TravelProfile.Bike => ("bicycle", new Dictionary<string, object>
        {
            ["bicycle_type"] = "hybrid",
            ["use_trails"] = 0,
        }),
        TravelProfile.Mtb => ("bicycle", new Dictionary<string, object>
        {
            ["bicycle_type"] = "mountain",
            ["use_trails"] = settings.UseTrails,
            ["max_hiking_difficulty"] = settings.MaxHikingDifficulty,
        }),
        _ => ("pedestrian", new Dictionary<string, object>
        {
            ["use_trails"] = settings.UseTrails,
            ["max_hiking_difficulty"] = settings.MaxHikingDifficulty,
        }),
    };

    private static string CacheKey(RouteRequest request, ValhallaOptions settings)
    {
        // Punctele se rotunjesc la ~1 m înainte de a intra în cheie: două atingeri pe hartă în același
        // loc nu trebuie să fie două rute diferite, dar nici n-o rută veche pentru alt loc.
        var points = string.Join('|', request.Waypoints.Select(point =>
            string.Create(CultureInfo.InvariantCulture, $"{Math.Round(point.Latitude, 5):0.#####},{Math.Round(point.Longitude, 5):0.#####}")));

        return $"route:{request.Profile}:{settings.MaxHikingDifficulty}:{settings.UseTrails}:{points}";
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var payload = await response.Content.ReadFromJsonAsync<ValhallaError>(ct);
            return payload?.Error ?? payload?.ErrorCode.ToString(CultureInfo.InvariantCulture) ?? "fără detaliu";
        }
        catch (Exception ex) when (ex is JsonException or HttpRequestException or TaskCanceledException)
        {
            return "răspuns de eroare ilizibil";
        }
    }

    private sealed record ValhallaLocation(
        [property: JsonPropertyName("lat")] double Latitude,
        [property: JsonPropertyName("lon")] double Longitude);

    private sealed record ValhallaResponse(
        [property: JsonPropertyName("trip")] ValhallaTrip? Trip);

    private sealed record ValhallaTrip(
        [property: JsonPropertyName("legs")] List<ValhallaLeg>? Legs);

    private sealed record ValhallaLeg(
        [property: JsonPropertyName("shape")] string? Shape,
        [property: JsonPropertyName("summary")] ValhallaSummary? Summary);

    private sealed record ValhallaSummary(
        [property: JsonPropertyName("length")] double Length,
        [property: JsonPropertyName("time")] double Time);

    private sealed record ValhallaError(
        [property: JsonPropertyName("error")] string? Error,
        [property: JsonPropertyName("error_code")] int ErrorCode);
}
