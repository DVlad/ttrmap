using Microsoft.EntityFrameworkCore;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;
using TTRMap.Domain.Entities;
using TTRMap.Domain.Enums;
using TTRMap.Infrastructure.Data;

namespace TTRMap.Infrastructure.Repositories;

/// <summary>
/// Punctele montane, citite și scrise de harta.
///
/// <para>
/// Importul scrie **în loturi idempotente**: upsert pe (`Source`, `SourceRef`), nu pe id. E condiția
/// ca aceeași zonă să poată fi reimportată după o lună fără să dubleze cabanele și — mai important —
/// fără să șteargă corecturile făcute de un om. De aceea rîndurile actualizate își **păstrează**
/// verificarea și notele: un import nu are voie să anuleze ce a confirmat un om.
/// </para>
/// </summary>
public class MountainPoiRepository(MapDbContext db) : IMountainPoiRepository
{
    public async Task<IReadOnlyList<MountainPoi>> GetInBboxAsync(
        GeoBbox bbox,
        IReadOnlyList<MountainPoiCategory> categories,
        int limit,
        CancellationToken ct = default)
    {
        var query = db.MountainPois.Where(p =>
            p.Latitude >= bbox.South && p.Latitude <= bbox.North &&
            p.Longitude >= bbox.West && p.Longitude <= bbox.East);

        // Listă goală = fără filtru (clientul nu a cerut categorii anume).
        if (categories.Count > 0)
        {
            query = query.Where(p => categories.Contains(p.Category));
        }

        return await query
            .OrderBy(p => p.Category)
            .ThenBy(p => p.Name)
            .Take(limit)
            .ToListAsync(ct);
    }

    public Task<MountainPoi?> GetByIdAsync(int id, CancellationToken ct = default) =>
        db.MountainPois.FirstOrDefaultAsync(p => p.Id == id, ct);

    public async Task<IReadOnlyList<MountainPoi>> SearchByNameAsync(
        string query, int limit, CancellationToken ct = default)
    {
        // `ESCAPE` e obligatoriu: fără el, escaping-ul făcut de politică ar fi tratat ca text obișnuit,
        // iar căutarea după „50%" ar căuta literal `\%`, adică nimic.
        var pattern = $"%{query}%";

        return await db.MountainPois
            .Where(p => EF.Functions.ILike(p.Name, pattern, MountainPoiPolicy.LikeEscapeCharacter.ToString()))
            // Numele scurte întîi: cine scrie „Omu" vrea Cabana Omu, nu „Fosta cabană de lîngă Omu".
            .OrderBy(p => p.Name.Length)
            .ThenBy(p => p.Name)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task<MountainPoiUpsertResult> UpsertManyAsync(
        IReadOnlyList<MountainPoi> pois, CancellationToken ct = default)
    {
        if (pois.Count == 0) return new MountainPoiUpsertResult(0, 0);

        // O singură interogare pentru tot lotul: un import de 5 000 de rînduri nu are voie să facă
        // 5 000 de căutări.
        var refs = pois.Select(p => p.SourceRef).Distinct().ToList();
        var sources = pois.Select(p => p.Source).Distinct().ToList();
        var existing = await db.MountainPois
            .Where(p => sources.Contains(p.Source) && refs.Contains(p.SourceRef))
            .ToDictionaryAsync(p => $"{p.Source}|{p.SourceRef}", ct);

        var inserted = 0;
        var updated = 0;

        foreach (var poi in pois)
        {
            if (existing.TryGetValue($"{poi.Source}|{poi.SourceRef}", out var current))
            {
                current.Name = poi.Name;
                current.Category = poi.Category;
                current.Latitude = poi.Latitude;
                current.Longitude = poi.Longitude;
                current.ElevationM = poi.ElevationM;
                current.ReadAt = poi.ReadAt;
                current.AttributesJson = poi.AttributesJson;
                // `VerifiedAt`/`VerifiedBy`/`Notes` NU se ating: sînt ale oamenilor, nu ale importului.
                updated++;
                continue;
            }

            db.MountainPois.Add(poi);
            existing[$"{poi.Source}|{poi.SourceRef}"] = poi;
            inserted++;
        }

        await db.SaveChangesAsync(ct);
        return new MountainPoiUpsertResult(inserted, updated);
    }

    public Task<int> CountAsync(CancellationToken ct = default) => db.MountainPois.CountAsync(ct);
}
