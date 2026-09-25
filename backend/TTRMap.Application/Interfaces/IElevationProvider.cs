using TTRMap.Application.Services;

namespace TTRMap.Application.Interfaces;

/// <summary>
/// Sursa de altitudini. Interfață proprie ca ecranul și planificatorul să nu știe **de unde** vine
/// altitudinea — Copernicus azi, un DEM propriu mîine, fără să se schimbe niciun apelant.
/// </summary>
public interface IElevationProvider
{
    /// <summary>
    /// Altitudinea pentru fiecare punct, **în aceeași ordine** ca intrarea. `null` înseamnă „nu o
    /// știm" (punct în afara acoperirii, DEM fără date, sursă indisponibilă) — nu zero, care e o
    /// altitudine reală.
    /// </summary>
    Task<IReadOnlyList<double?>> GetElevationsAsync(
        IReadOnlyList<GeoPoint> points, CancellationToken ct = default);
}
