using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TTRMap.Api.Services;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;

namespace TTRMap.Api.Controllers;

/// <summary>Un punct de pe traseu, așa cum vine din client.</summary>
public sealed record RoutingWaypointRequest(double Latitude, double Longitude);

/// <summary>Cererea de rutare: punctele în ordine și profilul de mers.</summary>
public sealed record RoutingRequestBody(
    IReadOnlyList<RoutingWaypointRequest>? Points,
    string? Profile);

/// <summary>
/// Planificatorul de traseu — ruta dintre punctele alese.
///
/// <para>
/// **De ce trece prin server.** Pînă acum, ecranul chema direct `router.project-osrm.org` cu profilul
/// `foot`, iar pe trasee montane reale rezultatul era ocolul: măsurat pe 2026-09-24, 41 km în loc de
/// 6,2 km între Azuga și Cabana Diham. Acum ruta vine de la motorul nostru (Valhalla), iar clientul
/// nu are nevoie să știe unde stă: îl putem muta, îl putem reconstruege tile-urile, putem pune un
/// cache în față — fără o nouă versiune de aplicație (`ttrmap/docs/STUDY-MAP.md` §5.3).
/// </para>
/// </summary>
[ApiController]
[Route("api/routing")]
public class RoutingController(
    IRoutingProvider provider,
    ILogger<RoutingController> logger) : ControllerBase
{
    /// <summary>
    /// Ruta prin punctele date. Cînd motorul nu poate răspunde, întoarce **503**, nu o linie dreaptă:
    /// o linie dreaptă desenată tăcut arată ca o rută și e o minciună mult mai scumpă decît un mesaj
    /// de eroare (`ttrmap/docs/STUDY-MAP.md` §3.1.2).
    /// </summary>
    [HttpPost("route")]
    [EnableRateLimiting(RateLimitPolicies.Routing)]
    public async Task<IActionResult> Route([FromBody] RoutingRequestBody? body, CancellationToken ct)
    {
        if (body?.Points is null || body.Points.Count == 0)
            return BadRequest("Lipsește lista de puncte (points).");

        if (!RoutePlanPolicy.TryParseProfile(body.Profile, out var profile))
            return BadRequest(RoutePlanPolicy.ProfileHint);

        var waypoints = body.Points
            .Select(point => new GeoPoint(point.Latitude, point.Longitude))
            .ToList();

        if (!RoutePlanPolicy.TryValidate(waypoints, out var error))
            return BadRequest(error);

        var path = await provider.FindRouteAsync(new RouteRequest(waypoints, profile), ct);
        if (path is null)
        {
            logger.LogWarning("Rutarea a eșuat pentru {Count} puncte, profil {Profile}.",
                waypoints.Count, profile);
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                "Rutarea nu e disponibilă acum. Traseul poate fi trasat, dar fără urmărirea drumurilor.");
        }

        return Ok(new
        {
            distanceMeters = path.DistanceMeters,
            durationSeconds = path.DurationSeconds,
            profile = profile.ToString().ToLowerInvariant(),
            geometry = ToCoordinates(path.Geometry),
            // Etapa cu etapă: planificatorul are nevoie să știe ce segment cade la „anulează ultimul".
            legs = path.Legs.Select(leg => new
            {
                distanceMeters = leg.DistanceMeters,
                durationSeconds = leg.DurationSeconds,
                geometry = ToCoordinates(leg.Geometry),
            }),
        });
    }

    private static IEnumerable<double[]> ToCoordinates(IReadOnlyList<GeoPoint> geometry) =>
        geometry.Select(point => new[] { point.Longitude, point.Latitude });
}
