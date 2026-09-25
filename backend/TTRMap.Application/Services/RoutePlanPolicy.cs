using TTRMap.Domain.Enums;

namespace TTRMap.Application.Services;

/// <summary>O cerere de rutare, deja validată: punctele în ordine și profilul de cost.</summary>
public sealed record RouteRequest(IReadOnlyList<GeoPoint> Waypoints, TravelProfile Profile);

/// <summary>
/// O etapă a traseului: ce e între două puncte alese de utilizator. Motorul le întoarce separat, iar
/// planificatorul le ține separat — „anulează ultimul punct" are nevoie să știe ce segment cade.
/// </summary>
public sealed record RouteLeg(
    double DistanceMeters,
    double DurationSeconds,
    IReadOnlyList<GeoPoint> Geometry);

/// <summary>
/// Rezultatul unei rutări reușite. Distanța și durata vin **de la motor**, nu se recalculează din
/// geometrie: motorul știe de pante, de trepte de dificultate și de viteze pe tip de drum, iar o
/// recalculare „din linie" ar da o cifră mai puțin adevărată, doar ca să pară a noastră.
/// </summary>
public sealed class RoutePath(IReadOnlyList<RouteLeg> legs)
{
    /// <summary>Etapa dintre fiecare două puncte consecutive, în ordine.</summary>
    public IReadOnlyList<RouteLeg> Legs { get; } = legs;

    public double DistanceMeters { get; } = legs.Sum(leg => leg.DistanceMeters);

    public double DurationSeconds { get; } = legs.Sum(leg => leg.DurationSeconds);

    /// <summary>
    /// Geometria întreagă, fără punctele de legătură scrise de două ori: capătul unei etape e și
    /// începutul următoarei, iar repetarea lui ar face o buclă de zero metri (vizibilă ca un vîrf
    /// fals în profilul altimetric).
    /// </summary>
    public IReadOnlyList<GeoPoint> Geometry { get; } = JoinLegs(legs);

    private static IReadOnlyList<GeoPoint> JoinLegs(IReadOnlyList<RouteLeg> legs)
    {
        var joined = new List<GeoPoint>();

        foreach (var leg in legs)
        {
            var start = joined.Count > 0 ? 1 : 0;
            for (var i = start; i < leg.Geometry.Count; i++) joined.Add(leg.Geometry[i]);
        }

        return joined;
    }
}

/// <summary>
/// Regulile cererii de rutare, verificate **înainte** de a atinge motorul. Motorul e un serviciu
/// separat (Valhalla), deci fiecare cerere validă costă un proces de rutare pe serverul nostru; o
/// cerere absurdă nu are voie să ajungă acolo.
/// </summary>
public static class RoutePlanPolicy
{
    /// <summary>
    /// Cîte puncte de oprire acceptăm într-o cerere. Planificatorul are nevoie de cîteva (start, cîteva
    /// popasuri, sosire); peste atît, drumul se planifică în etape, iar o singură cerere ar ține un
    /// proces de rutare ocupat degeaba.
    /// </summary>
    public const int MaxWaypoints = 25;

    /// <summary>
    /// Cît de aproape pot fi două puncte consecutive. Sub atît, motorul nu are ce rută să caute (sînt
    /// practic același loc), iar Valhalla întoarce eroare — mai bine o spunem noi, cu un mesaj clar.
    /// </summary>
    public const double MinLegMeters = 5;

    public const string ProfileHint = "Profilurile acceptate: foot, bike, mtb.";

    /// <summary>
    /// Citește profilul din textul cererii. Implicit `foot`: un traseu de munte se merge pe jos dacă
    /// clientul nu spune altceva, iar un implicit greșit ar ruina tăcut rutele celor care nu trimit
    /// cîmpul.
    /// </summary>
    public static bool TryParseProfile(string? raw, out TravelProfile profile)
    {
        profile = TravelProfile.Foot;
        if (string.IsNullOrWhiteSpace(raw)) return true;

        switch (raw.Trim().ToLowerInvariant())
        {
            case "foot":
            case "walk":
            case "pedestrian":
                profile = TravelProfile.Foot;
                return true;
            case "bike":
            case "bicycle":
            case "trekking":
                profile = TravelProfile.Bike;
                return true;
            case "mtb":
            case "mountain":
            case "mountainbike":
                profile = TravelProfile.Mtb;
                return true;
            default:
                return false;
        }
    }

    /// <summary>
    /// Validează lista de puncte. Întoarce `false` cu un mesaj citibil pentru orice formă greșită —
    /// inclusiv pentru puncte care se suprapun, unde motorul ar răspunde cu o eroare pe care nimeni
    /// nu ar ști s-o explice.
    /// </summary>
    public static bool TryValidate(
        IReadOnlyList<GeoPoint>? waypoints, out string? error)
    {
        error = null;

        if (waypoints is null || waypoints.Count < 2)
        {
            error = "Rutarea are nevoie de cel puțin două puncte (plecare și sosire).";
            return false;
        }

        if (waypoints.Count > MaxWaypoints)
        {
            error = $"Se acceptă cel mult {MaxWaypoints} puncte într-o cerere (au venit {waypoints.Count}).";
            return false;
        }

        foreach (var point in waypoints)
        {
            if (double.IsNaN(point.Latitude) || double.IsNaN(point.Longitude) ||
                double.IsInfinity(point.Latitude) || double.IsInfinity(point.Longitude))
            {
                error = "Coordonatele trebuie să fie numere finite.";
                return false;
            }

            if (point.Latitude is < -90 or > 90 || point.Longitude is < -180 or > 180)
            {
                error = "Coordonatele trebuie să fie latitudini (−90…90) și longitudini (−180…180).";
                return false;
            }
        }

        for (var i = 1; i < waypoints.Count; i++)
        {
            if (HaversineMeters(waypoints[i - 1], waypoints[i]) < MinLegMeters)
            {
                error = $"Punctele {i} și {i + 1} sînt practic în același loc; mută unul dintre ele.";
                return false;
            }
        }

        return true;
    }

    /// <summary>Distanța în metri între două puncte, pe sfera medie. Doar pentru validare, nu pentru afișare.</summary>
    public static double HaversineMeters(GeoPoint a, GeoPoint b)
    {
        const double EarthRadiusMeters = 6371008.8;

        var lat1 = DegreesToRadians(a.Latitude);
        var lat2 = DegreesToRadians(b.Latitude);
        var deltaLat = lat2 - lat1;
        var deltaLon = DegreesToRadians(b.Longitude - a.Longitude);

        var h = Math.Sin(deltaLat / 2) * Math.Sin(deltaLat / 2) +
                Math.Cos(lat1) * Math.Cos(lat2) * Math.Sin(deltaLon / 2) * Math.Sin(deltaLon / 2);

        return 2 * EarthRadiusMeters * Math.Asin(Math.Min(1, Math.Sqrt(h)));
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180;
}
