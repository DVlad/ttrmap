using TTRMap.Domain.Entities;
using TTRMap.Domain.Enums;
using TTRMap.Application.Services;

namespace TTRMap.Application.Interfaces;

/// <summary>
/// Punctele de interes montane (cabane, refugii, Salvamont, izvoare, belvedere, indicatoare).
///
/// Scrierea se face **pe perechi** (`Source` + `SourceRef`), nu pe id: un re-import al aceleiași zone
/// trebuie să actualizeze cabana, nu să adauge încă una. Idempotența e chiar condiția ca importul să
/// poată fi rulat de mai multe ori fără să strice corecturile făcute de un om.
/// </summary>
public interface IMountainPoiRepository
{
    Task<IReadOnlyList<MountainPoi>> GetInBboxAsync(
        GeoBbox bbox,
        IReadOnlyList<MountainPoiCategory> categories,
        int limit,
        CancellationToken ct = default);

    Task<MountainPoi?> GetByIdAsync(int id, CancellationToken ct = default);

    /// <summary>
    /// Caută după nume, fără să țină cont de majuscule. `query` trebuie să vină deja normalizat de
    /// <c>MountainPoiPolicy.TryNormalizeSearchQuery</c> (metacaracterele `LIKE` escapate).
    /// </summary>
    Task<IReadOnlyList<MountainPoi>> SearchByNameAsync(
        string query, int limit, CancellationToken ct = default);

    /// <summary>Adaugă sau actualizează după (`Source`, `SourceRef`) și spune cîte au fost noi.</summary>
    Task<MountainPoiUpsertResult> UpsertManyAsync(
        IReadOnlyList<MountainPoi> pois, CancellationToken ct = default);

    Task<int> CountAsync(CancellationToken ct = default);
}

/// <summary>Cîte rînduri au intrat și cîte au fost actualizate la un import.</summary>
public readonly record struct MountainPoiUpsertResult(int Inserted, int Updated);
