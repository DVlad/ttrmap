using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace TTRMap.Api.Services;

/// <summary>
/// Numele politicilor de rate limiting ale serviciului de hartă.
///
/// <para>
/// Sînt mai puține decît în TTR, fiindcă serviciul are un singur subiect. Plafoanele sînt totuși
/// necesare: fiecare cerere de rutare consumă un proces Valhalla, fiecare cerere de altitudine ajunge
/// la AWS, iar importul pune pe foc un mirror Overpass public.
/// </para>
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>Citirea punctelor montane. Ieftină (o interogare indexată), dar chemată la fiecare pan.</summary>
    public const string MountainPoiRead = "map-poi-read";

    /// <summary>Importul punctelor din OSM — operație de administrator, rară și scumpă (~178 s o zonă).</summary>
    public const string MountainPoiImport = "map-poi-import";

    /// <summary>Altitudinile din DEM-ul Copernicus: fiecare cerere citește de la AWS.</summary>
    public const string Elevation = "map-elevation";

    /// <summary>Rutarea: fiecare cerere consumă un proces pe motorul Valhalla.</summary>
    public const string Routing = "map-routing";
}

/// <summary>
/// Cheile de partiționare. Pe cont cînd există (tokenul validat dă id-ul), pe IP altfel — un client
/// anonim nu are voie să consume plafonul tuturor celor din spatele aceluiași proxy.
/// </summary>
public static class RateLimitKeys
{
    public static string AccountOrIp(HttpContext context) =>
        context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value is { Length: > 0 } userId
            ? $"user:{userId}"
            : $"ip:{ClientIp(context)}";

    public static string ClientIp(HttpContext context) =>
        context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    /// <summary>O partiție cu fereastră fixă, în memoria procesului.</summary>
    /// <remarks>
    /// Fără Redis, deliberat: serviciul de hartă rulează într-o singură instanță (motorul Valhalla de
    /// lîngă el e oricum unul singur), iar contoarele se refac la restart. Dacă vreodată se scalează,
    /// plafoanele devin „per instanță" — deci se înmulțesc; atunci se pune un backend partajat, ca în TTR.
    /// </remarks>
    public static RateLimitPartition<string> FixedWindow(
        HttpContext context, string key, int permitLimit, TimeSpan window) =>
        RateLimitPartition.GetFixedWindowLimiter(
            key,
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = window,
                QueueLimit = 0,
                QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            });
}
