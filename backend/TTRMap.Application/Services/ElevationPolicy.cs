using System.Globalization;

namespace TTRMap.Application.Services;

/// <summary>Un punct pentru care se cere altitudinea.</summary>
public readonly record struct GeoPoint(double Latitude, double Longitude);

/// <summary>
/// Regulile cererii de altitudine. Același tipar ca la punctele montane: parametrul se validează
/// **înainte** de a atinge vreun serviciu extern, altfel un client stricat ne costă trafic la AWS.
/// </summary>
public static class ElevationPolicy
{
    /// <summary>
    /// Cîte puncte se acceptă într-o cerere. Un traseu de planificator are cîteva sute de puncte, dar
    /// D+/D− se calculează dintr-un eșantion: peste atîta, detaliul nu se mai vede în cifră, iar
    /// citirea din DEM devine vizibil mai lentă.
    /// </summary>
    public const int MaxLocations = 100;

    public const string FormatHint =
        "Punctele se scriu „lat,lon|lat,lon\" (ex. 45.4456,25.4544|45.4028,25.4645).";

    /// <summary>
    /// Citește lista de puncte din textul cererii. Întoarce `false` cu un mesaj citibil pentru orice
    /// formă greșită — inclusiv pentru liste goale sau prea lungi, ca granița să fie aici, nu în
    /// furnizor.
    /// </summary>
    public static bool TryParseLocations(
        string? raw, out IReadOnlyList<GeoPoint> points, out string? error)
    {
        points = [];
        error = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            error = "Lipsește lista de puncte (locations).";
            return false;
        }

        var parts = raw.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0)
        {
            error = FormatHint;
            return false;
        }

        if (parts.Length > MaxLocations)
        {
            error = $"Se acceptă cel mult {MaxLocations} puncte într-o cerere (au venit {parts.Length}).";
            return false;
        }

        var parsed = new List<GeoPoint>(parts.Length);
        foreach (var part in parts)
        {
            var pair = part.Split(',', StringSplitOptions.TrimEntries);
            if (pair.Length != 2)
            {
                error = FormatHint;
                return false;
            }

            if (!double.TryParse(pair[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude) ||
                !double.TryParse(pair[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude) ||
                double.IsNaN(latitude) || double.IsNaN(longitude) ||
                double.IsInfinity(latitude) || double.IsInfinity(longitude))
            {
                error = FormatHint;
                return false;
            }

            if (latitude is < -90 or > 90 || longitude is < -180 or > 180)
            {
                error = "Coordonatele trebuie să fie latitudini (−90…90) și longitudini (−180…180).";
                return false;
            }

            parsed.Add(new GeoPoint(latitude, longitude));
        }

        points = parsed;
        return true;
    }

    /// <summary>
    /// O altitudine din DEM e utilă? Zero e o valoare legitimă (nivelul mării), dar un DEM fără date
    /// scrie tot zero, iar un `NaN` nu are ce căuta într-un D+.
    /// </summary>
    public static double? Sanitize(double raw)
    {
        if (double.IsNaN(raw) || double.IsInfinity(raw)) return null;
        if (raw is < -500 or > 9000) return null;
        return raw;
    }
}
