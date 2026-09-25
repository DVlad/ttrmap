using TTRMap.Application.Services;

namespace TTRMap.Application.Interfaces;

/// <summary>
/// Aduce punctele montane dintr-o sursă externă (OSM, prin Overpass) în baza noastră.
///
/// <para>
/// **De ce un import și nu o citire live.** Măsurat pe 2026-09-23: o singură cerere Overpass pentru un
/// masiv (Făgăraș) a luat **177,7 secunde**, iar mirror-ul principal a răspuns `HTTP 504`. Pusă în
/// calea unui ecran, asta înseamnă o hartă care nu se încarcă. Importul rulează rar, ca operație de
/// administrator, iar ecranul citește din baza noastră (`ttrmap/docs/STUDY-MAP.md` §3.2.6).
/// </para>
/// </summary>
public interface IOsmMountainPoiImporter
{
    Task<MountainPoiImportResult> ImportAsync(GeoBbox bbox, CancellationToken ct = default);
}

/// <summary>
/// Ce s-a întîmplat la un import. Se întoarce administratorului, ca să vadă dacă zona a fost deja
/// acoperită (0 noi, multe actualizate) sau chiar era goală.
/// </summary>
public readonly record struct MountainPoiImportResult(
    /// <summary>Cîte elemente a întors sursa (după clasificare, înainte de plafon).</summary>
    int Fetched,
    /// <summary>Cîte au intrat efectiv în lot.</summary>
    int Accepted,
    int Inserted,
    int Updated,
    /// <summary>Endpoint-ul care a răspuns — mirror-urile nu sînt interschimbabile felul lor de a fi.</summary>
    string Endpoint);

/// <summary>
/// Sursa OSM nu a răspuns pe niciun mirror. Tip propriu, ca stratul API să poată întoarce **502**
/// („sursa externă e picată") în loc de 500 („noi sîntem stricați") — pentru client sînt două lucruri
/// diferite, iar al doilea ar trimite pe cineva să caute o eroare care nu există la noi.
/// </summary>
public sealed class OverpassUnavailableException(string message, Exception? inner = null)
    : Exception(message, inner);
