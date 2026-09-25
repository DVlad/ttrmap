using TTRMap.Domain.Enums;

namespace TTRMap.Domain.Entities;

/// <summary>
/// Un punct de interes montan: cabană, refugiu, post Salvamont, izvor, belvedere, indicator de traseu
/// sau o zonă semnalizată ca periculoasă.
///
/// <para>
/// **De ce nu stă în cache-ul OSM.** Pînă acum harta lua datele live de la Overpass și le ținea în
/// <see cref="OsmCache"/> — un blob JSON partajat, fără identitate de rînd. Un POI are nevoie de
/// identitate: „cabana de la Bîlea" e același loc anul viitor, iar dacă cineva îi corectează telefonul,
/// corectura trebuie să rămînă. De aceea e rînd în bază, cu cheie stabilă (<see cref="Source"/> +
/// <see cref="SourceRef"/>) și cu proveniență.
/// </para>
///
/// <para>
/// **Proveniența e parte din model, nu un cîmp de audit.** Datele OSM pe cabane sînt neuniforme (o
/// cabană poate fi închisă de zece ani și tot „alpine_hut" apare), iar la munte o informație greșită
/// înseamnă o noapte pe afară. Fiecare rînd spune de unde vine, cînd a fost citit și dacă un om l-a
/// verificat — iar un rînd neverificat se poate afișa distinct.
/// </para>
/// </summary>
public class MountainPoi
{
    public int Id { get; set; }

    /// <summary>Numele de pe teren. Poate fi **gol**: un izvor fără nume e tot un izvor util.</summary>
    public string Name { get; set; } = string.Empty;

    public MountainPoiCategory Category { get; set; }

    public double Latitude { get; set; }
    public double Longitude { get; set; }

    /// <summary>Altitudinea, cînd o știm. `null` înseamnă „nu știm", nu „zero".</summary>
    public double? ElevationM { get; set; }

    // ── Proveniență ─────────────────────────────────────────────────────────

    /// <summary>De unde vine rîndul: `osm`, `salvamont`, `user`.</summary>
    public string Source { get; set; } = string.Empty;

    /// <summary>Identitatea la sursă: pentru OSM, `node/123456` sau `way/123456`. Stabilă în timp.</summary>
    public string SourceRef { get; set; } = string.Empty;

    /// <summary>Cînd am citit datele de la sursă.</summary>
    public DateTime ReadAt { get; set; } = DateTime.UtcNow;

    /// <summary>Cînd a confirmat un om că rîndul e corect. `null` = neverificat.</summary>
    public DateTime? VerifiedAt { get; set; }

    /// <summary>Cine a verificat (cont sau nume).</summary>
    public string? VerifiedBy { get; set; }

    /// <summary>Observațiile noastre — cîmp de om, nu se scrie la import.</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Atribute utile în listă albă (telefon, program, operator, capacitate), ca JSON.
    ///
    /// De ce listă albă și nu toate tag-urile: un element OSM are și cîteva zeci de tag-uri de
    /// import/istoric care nu ajută pe nimeni pe munte și care ar umfla rîndul de zeci de ori.
    /// </summary>
    public string? AttributesJson { get; set; }

    /// <summary>Un om a confirmat rîndul (nu doar l-am citit de la sursă).</summary>
    public bool IsVerified => VerifiedAt is not null;
}
