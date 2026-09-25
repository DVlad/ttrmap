using TTRMap.Application.Services;

namespace TTRMap.Application.Interfaces;

/// <summary>
/// Motorul de rutare. Interfață proprie din două motive, amîndouă practice:
/// <list type="number">
/// <item>ecranul nu are voie să vorbească direct cu motorul — altfel fiecare client ar avea nevoie de
/// acces la serverul de rutare, iar schimbarea motorului ar însemna o nouă versiune de aplicație;</item>
/// <item>motorul e o componentă separată, care poate lipsi (nedeployată, căzută, în curs de
/// reconstruire a tile-urilor). Atunci întoarcem `null` și spunem asta, în loc să desenăm o linie
/// dreaptă care pare o rută.</item>
/// </list>
///
/// Vezi `ttrmap/docs/STUDY-MAP.md` §5.3.
/// </summary>
public interface IRoutingProvider
{
    /// <summary>
    /// Ruta prin toate punctele date, în ordine. `null` cînd motorul nu poate răspunde (indisponibil,
    /// timeout, puncte în afara hărții acoperite) — niciodată o aproximare tăcută.
    /// </summary>
    Task<RoutePath?> FindRouteAsync(RouteRequest request, CancellationToken ct = default);
}
