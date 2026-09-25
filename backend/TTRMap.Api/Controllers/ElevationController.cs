using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TTRMap.Api.Services;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;

namespace TTRMap.Api.Controllers;

/// <summary>
/// Altitudini pentru o listă de puncte — de aici vin D+/D− din planificator și, mai tîrziu, banda de
/// pantă.
///
/// <para>
/// **Drumul ăsta a fost mort și acum e viu.** Ecranul chema `/api/elevation` încă de la început, dar
/// endpoint-ul nu exista, iar eșecul era înghițit de un `catch` gol: planificatorul afișa „Urcuș (D+)
/// 0 m" ca și cum ar fi un răspuns. În F1 am scos cifra inventată; aici vine sursa adevărată
/// (`ttrmap/docs/STUDY-MAP.md` §3.1.1).
/// </para>
/// </summary>
[ApiController]
[Route("api/elevation")]
public class ElevationController(IElevationProvider provider) : ControllerBase
{
    /// <summary>
    /// Altitudinea fiecărui punct, în ordinea cerută. `elevation` e `null` cînd nu o știm (în afara
    /// acoperirii DEM sau sursă indisponibilă) — clientul are voie să afișeze „indisponibil", dar nu
    /// are de unde să scoată un zero fals.
    /// </summary>
    [HttpGet]
    [EnableRateLimiting(RateLimitPolicies.Elevation)]
    public async Task<IActionResult> Get([FromQuery] string? locations, CancellationToken ct)
    {
        if (!ElevationPolicy.TryParseLocations(locations, out var points, out var error))
            return BadRequest(error);

        var elevations = await provider.GetElevationsAsync(points, ct);

        return Ok(new
        {
            results = points.Select((point, index) => new
            {
                latitude = point.Latitude,
                longitude = point.Longitude,
                elevation = elevations[index],
            }),
        });
    }
}
