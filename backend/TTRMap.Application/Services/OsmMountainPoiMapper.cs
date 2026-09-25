using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using TTRMap.Domain.Entities;
using TTRMap.Domain.Enums;

namespace TTRMap.Application.Services;

/// <summary>
/// Traduce un răspuns Overpass în puncte montane — funcție **pură**, fără rețea și fără bază de date,
/// ca regulile de clasificare să poată fi testate pe cazuri reale fără să pornească nimic.
///
/// <para>
/// De ce contează clasificarea: aceleași două tag-uri pot însemna lucruri diferite pe teren. Un
/// <c>amenity=shelter</c> e cel mai adesea un adăpost de stație de autobuz — dacă intră în stratul de
/// refugii montane, harta se umple de puncte inutile exact acolo unde omul caută ceva serios. De aceea
/// refugiile cer și <c>shelter_type</c>, iar ordinea de mai jos e explicită, nu „primul tag găsit".
/// </para>
/// </summary>
public static class OsmMountainPoiMapper
{
    public const string Source = "osm";

    /// <summary>Atributele păstrate în listă albă (restul tag-urilor se ignoră deliberat).</summary>
    private static readonly string[] KeptAttributes =
    [
        "phone", "website", "opening_hours", "operator", "capacity",
        "shelter_type", "access", "description", "emergency",
    ];

    /// <summary>
    /// Interogarea pentru o zonă. <c>out center tags</c> e esențial: multe cabane și refugii sînt
    /// desenate ca **suprafață** (<c>way</c>), nu ca punct, iar `center` dă coordonata lor fără să
    /// trebuie să cerem geometria completă.
    /// </summary>
    public static string BuildQuery(GeoBbox bbox)
    {
        var box = string.Join(',', new[]
        {
            bbox.South.ToString("0.#####", CultureInfo.InvariantCulture),
            bbox.West.ToString("0.#####", CultureInfo.InvariantCulture),
            bbox.North.ToString("0.#####", CultureInfo.InvariantCulture),
            bbox.East.ToString("0.#####", CultureInfo.InvariantCulture),
        });

        return $"""
            [out:json][timeout:180];
            (
              nwr["tourism"~"^(alpine_hut|wilderness_hut|chalet)$"]({box});
              nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|lean_to)$"]({box});
              nwr["emergency"="mountain_rescue"]({box});
              nwr["natural"="spring"]["drinking_water"="yes"]({box});
              nwr["tourism"="viewpoint"]({box});
              nwr["information"="guidepost"]({box});
            );
            out center tags;
            """;
    }

    /// <summary>
    /// Răspunsul Overpass → puncte montane. Elementele fără coordonate, fără categorie cunoscută sau
    /// duplicate se **sar** (nu se inventează un punct la (0,0)).
    /// </summary>
    public static IReadOnlyList<MountainPoi> Map(string overpassJson, DateTime readAt)
    {
        OverpassResponse? response;
        try
        {
            response = JsonSerializer.Deserialize<OverpassResponse>(overpassJson);
        }
        catch (JsonException)
        {
            return [];
        }

        if (response?.Elements is null) return [];

        var pois = new List<MountainPoi>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var element in response.Elements)
        {
            var poi = MapElement(element, readAt);
            if (poi is null) continue;
            if (!seen.Add(poi.SourceRef)) continue;
            pois.Add(poi);
        }

        return pois;
    }

    private static MountainPoi? MapElement(OverpassElement element, DateTime readAt)
    {
        var tags = element.Tags;
        if (tags is null || tags.Count == 0) return null;
        if (string.IsNullOrWhiteSpace(element.Type) || element.Id <= 0) return null;

        var (lat, lon) = Coordinates(element);
        if (lat is null || lon is null) return null;
        if (lat is < -90 or > 90 || lon is < -180 or > 180) return null;

        var category = Classify(tags);
        if (category is null) return null;

        return new MountainPoi
        {
            Name = tags.TryGetValue("name", out var name) ? name.Trim() : string.Empty,
            Category = category.Value,
            Latitude = lat.Value,
            Longitude = lon.Value,
            ElevationM = ParseElevation(tags.GetValueOrDefault("ele")),
            Source = Source,
            SourceRef = $"{element.Type}/{element.Id}",
            ReadAt = readAt,
            AttributesJson = BuildAttributes(tags),
        };
    }

    private static (double? Lat, double? Lon) Coordinates(OverpassElement element)
    {
        if (element.Lat is not null && element.Lon is not null) return (element.Lat, element.Lon);
        if (element.Center is not null) return (element.Center.Lat, element.Center.Lon);
        return (null, null);
    }

    /// <summary>
    /// Categoria, în ordine de prioritate. Ordinea nu e arbitrară: un post Salvamont care are și
    /// <c>tourism=wilderness_hut</c> rămîne Salvamont (e informația de siguranță), iar un refugiu care
    /// e și belvedere rămîne refugiu (e informația de care ai nevoie ca să rămîi în viață peste noapte).
    ///
    /// <see cref="MountainPoiCategory.Warning"/> nu se produce niciodată aici: nu există tag OSM pe
    /// care să te bazezi pentru „porțiune expusă". Avertismentele vin din catalog, cu verificare umană.
    /// </summary>
    private static MountainPoiCategory? Classify(IReadOnlyDictionary<string, string> tags)
    {
        if (tags.GetValueOrDefault("emergency") == "mountain_rescue") return MountainPoiCategory.Rescue;

        var tourism = tags.GetValueOrDefault("tourism");

        // Cabană = loc cu gazdă, unde te poți aștepta la un pat și la curent.
        if (tourism is "alpine_hut" or "chalet") return MountainPoiCategory.Hut;

        // `wilderness_hut` NU e o cabană: e un refugiu de urgență, nemodernizat, de multe ori fără
        // curent și fără gazdă. Verificat pe date reale (Bucegi, 2026-09-23): `node/430758331` e
        // „Refugiul Coștila" — pus la cabane, ar fi mințit exact în cazul în care contează.
        if (tourism == "wilderness_hut") return MountainPoiCategory.Shelter;

        // `amenity=shelter` singur e, în marea majoritate a cazurilor, un adăpost de transport public.
        // Refugiul montan cere `shelter_type` explicit.
        var shelterType = tags.GetValueOrDefault("shelter_type");
        if (tags.GetValueOrDefault("amenity") == "shelter"
            && shelterType is "basic_hut" or "lean_to")
        {
            return MountainPoiCategory.Shelter;
        }

        if (tags.GetValueOrDefault("natural") == "spring"
            && tags.GetValueOrDefault("drinking_water") == "yes")
        {
            return MountainPoiCategory.Water;
        }

        if (tourism == "viewpoint") return MountainPoiCategory.Viewpoint;
        if (tags.GetValueOrDefault("information") == "guidepost") return MountainPoiCategory.Guidepost;

        return null;
    }

    /// <summary>
    /// Altitudinea din tag-ul `ele`, care în OSM vine neregulat: „1234", „1234 m", „1 234", „1234,5".
    /// Se ia **primul număr** din text, iar o valoare în afara intervalului locuibil întoarce `null`:
    /// un `ele` care conține altceva (o dată, un număr de etaj, un cod) nu are voie să ajungă pe hartă
    /// ca altitudine.
    /// </summary>
    public static double? ParseElevation(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var cleaned = raw
            .Replace('\u00a0', ' ')
            .Replace(" ", string.Empty)
            .Replace(',', '.');

        var match = Regex.Match(cleaned, @"-?\d+(\.\d+)?");
        if (!match.Success) return null;
        if (!double.TryParse(match.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)) return null;

        // Cel mai înalt punct de pe Pămînt e ~8849 m, iar Marea Moartă e la ~-430 m: în afara
        // intervalului, cifra nu e o altitudine.
        return value is < -500 or > 9000 ? null : value;
    }

    private static string? BuildAttributes(IReadOnlyDictionary<string, string> tags)
    {
        // Dicționar sortat: același element produce exact același JSON la fiecare import, deci un
        // re-import nu rescrie rîndul doar pentru că ordinea cheilor s-a schimbat.
        var kept = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var key in KeptAttributes)
        {
            if (tags.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value))
            {
                kept[key] = value.Trim();
            }
        }

        // Encoder relaxat: JSON-ul se citește doar de API-ul nostru, niciodată injectat în HTML, iar
        // escaping-ul implicit ar transforma un telefon normal („+40 123") în „\u002B40 123" — corect
        // tehnic, ilizibil la depanare și imposibil de căutat în bază.
        var json = JsonSerializer.Serialize(kept, AttributesJsonOptions);
        return kept.Count == 0 ? null : json;
    }

    private static readonly JsonSerializerOptions AttributesJsonOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    // ── Forma răspunsului Overpass (doar ce ne trebuie) ─────────────────────

    private sealed record OverpassResponse(
        [property: JsonPropertyName("elements")] List<OverpassElement>? Elements);

    private sealed record OverpassElement(
        [property: JsonPropertyName("type")] string? Type,
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("lat")] double? Lat,
        [property: JsonPropertyName("lon")] double? Lon,
        [property: JsonPropertyName("center")] OverpassCenter? Center,
        [property: JsonPropertyName("tags")] Dictionary<string, string>? Tags);

    private sealed record OverpassCenter(
        [property: JsonPropertyName("lat")] double Lat,
        [property: JsonPropertyName("lon")] double Lon);
}
