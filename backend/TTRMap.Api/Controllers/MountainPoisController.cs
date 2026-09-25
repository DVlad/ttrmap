using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using TTRMap.Api.Services;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;
using TTRMap.Domain.Entities;

namespace TTRMap.Api.Controllers;

/// <summary>
/// Un punct montan, așa cum ajunge la hartă.
///
/// <para>
/// Categoria se trimite ca **text** („hut", „shelter"), nu ca număr: clientul o folosește direct în
/// stiluri și filtre, iar un număr ar însemna că o reordonare a enum-ului schimbă în tăcere ce vede
/// omul pe hartă. `IsVerified` se trimite calculat, ca ecranul să poată arăta distinct un punct
/// confirmat de un om — regula din `ttrmap/docs/STUDY-MAP.md` §7.2.
/// </para>
/// </summary>
public record MountainPoiDto(
    int Id,
    string Name,
    string Category,
    double Latitude,
    double Longitude,
    double? ElevationM,
    string Source,
    string SourceRef,
    DateTime ReadAt,
    DateTime? VerifiedAt,
    bool IsVerified,
    string? Notes,
    IReadOnlyDictionary<string, string>? Attributes);

public record MountainPoiImportResponse(int Fetched, int Accepted, int Inserted, int Updated, string Endpoint);

/// <summary>
/// Punctele de interes montane — cabane, refugii, posturi Salvamont, izvoare, belvedere, indicatoare
/// (`ttrmap/docs/STUDY-MAP.md` §7).
///
/// <para>
/// Citirea se face din **baza noastră**, nu din Overpass: măsurat pe 2026-09-23, o singură cerere
/// Overpass pentru un masiv a luat ~178 de secunde, iar mirror-ul principal a răspuns 504. Importul
/// (<c>POST /import</c>, doar administrator) e singurul loc care atinge sursa externă.
/// </para>
/// </summary>
[ApiController]
[Route("api/mountain-pois")]
public class MountainPoisController(
    IMountainPoiRepository repository,
    IOsmMountainPoiImporter importer) : ControllerBase
{
    /// <summary>Punctele dintr-un dreptunghi, opțional filtrate pe categorii.</summary>
    [HttpGet]
    public async Task<IActionResult> Get(
        [FromQuery] string? bbox,
        [FromQuery] string? categories,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        if (!MountainPoiPolicy.TryParseBbox(bbox, out var area, out var bboxError))
            return BadRequest(bboxError);

        if (!MountainPoiPolicy.TryParseCategories(categories, out var parsedCategories, out var categoryError))
            return BadRequest(categoryError);

        var pois = await repository.GetInBboxAsync(
            area, parsedCategories, MountainPoiPolicy.ClampLimit(limit), ct);

        return Ok(pois.Select(ToDto));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id, CancellationToken ct)
    {
        var poi = await repository.GetByIdAsync(id, ct);
        return poi is null ? NotFound() : Ok(ToDto(poi));
    }

    /// <summary>
    /// Caută puncte după nume, în toată baza — nu doar în ce e pe ecran. De aceea e utilă: poți găsi
    /// „Cabana Omu" fără să știi în ce parte a țării e.
    ///
    /// Un text mai scurt de <see cref="MountainPoiPolicy.MinSearchLength"/> întoarce **listă goală**,
    /// nu eroare: clientul cere la fiecare tastă apăsată, iar „n-am găsit încă nimic" e răspunsul
    /// corect la „c".
    /// </summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] int? limit,
        CancellationToken ct)
    {
        var raw = q?.Trim() ?? "";
        if (raw.Length < MountainPoiPolicy.MinSearchLength) return Ok(Array.Empty<MountainPoiDto>());

        if (!MountainPoiPolicy.TryNormalizeSearchQuery(raw, out var normalized, out var error))
            return BadRequest(error);

        var pois = await repository.SearchByNameAsync(
            normalized, MountainPoiPolicy.ClampSearchLimit(limit), ct);

        return Ok(pois.Select(ToDto));
    }

    /// <summary>
    /// Importă punctele unei zone din OSM. **Doar administrator** și plafonat: operația durează zeci
    /// de secunde pînă la cîteva minute, iar sursa e publică și nerăbdătoare.
    ///
    /// Idempotent: se poate rula de mai multe ori pe aceeași zonă fără să dubleze rînduri, iar
    /// verificările făcute de un om nu se pierd la re-import.
    /// </summary>
    [HttpPost("import")]
    [AdministratorOnly]
    [EnableRateLimiting(RateLimitPolicies.MountainPoiImport)]
    public async Task<IActionResult> Import([FromQuery] string? bbox, CancellationToken ct)
    {
        if (!MountainPoiPolicy.TryParseBbox(bbox, out var area, out var bboxError))
            return BadRequest(bboxError);

        try
        {
            var result = await importer.ImportAsync(area, ct);
            return Ok(new MountainPoiImportResponse(
                result.Fetched, result.Accepted, result.Inserted, result.Updated, result.Endpoint));
        }
        catch (OverpassUnavailableException ex)
        {
            // 502, nu 500: problema e la sursa externă, iar clientul poate reîncerca mai tîrziu.
            return StatusCode(StatusCodes.Status502BadGateway, ex.Message);
        }
    }

    private static MountainPoiDto ToDto(MountainPoi poi) => new(
        poi.Id,
        poi.Name,
        poi.Category.ToString().ToLowerInvariant(),
        poi.Latitude,
        poi.Longitude,
        poi.ElevationM,
        poi.Source,
        poi.SourceRef,
        poi.ReadAt,
        poi.VerifiedAt,
        poi.IsVerified,
        poi.Notes,
        ParseAttributes(poi.AttributesJson));

    /// <summary>Atributele se întorc desfăcute; un JSON stricat nu are voie să strice lista întreagă.</summary>
    private static IReadOnlyDictionary<string, string>? ParseAttributes(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, string>>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
