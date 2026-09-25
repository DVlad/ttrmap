namespace TTRMap.Application.Services;

/// <summary>
/// Decodorul formatului „polyline6" — codificarea pe care Valhalla o folosește pentru geometria
/// rutei. E o variantă a clasicului Google polyline cu precizie 1e-6, nu 1e-5: la 1e-5 un punct
/// sare de la cîțiva metri, iar pe o potecă de munte asta mută traseul de pe o creastă pe alta.
///
/// <para>
/// Scris de mînă, deliberat: e ~40 de linii, iar alternativa (un pachet în plus) ar aduce o
/// dependență întreagă pentru o buclă. Are teste, inclusiv pe valorile negative, unde se greșește
/// de obicei (`~` în loc de `>>` pentru complementul lui 1).
/// </para>
/// </summary>
public static class Polyline6
{
    private const double Precision = 1e6;

    /// <summary>
    /// Decodează în perechi (latitudine, longitudine) — așa cum le trimite Valhalla. Întoarce listă
    /// goală pentru text gol, și ignoră un ultim caracter nefolosit, în loc să arunce.
    /// </summary>
    public static List<(double Latitude, double Longitude)> Decode(string? encoded)
    {
        var points = new List<(double, double)>();
        if (string.IsNullOrEmpty(encoded)) return points;

        var index = 0;
        var latitude = 0;
        var longitude = 0;

        while (index < encoded.Length)
        {
            if (!TryReadValue(encoded, ref index, out var latitudeDelta)) return points;
            if (!TryReadValue(encoded, ref index, out var longitudeDelta)) return points;

            latitude += latitudeDelta;
            longitude += longitudeDelta;

            points.Add((latitude / Precision, longitude / Precision));
        }

        return points;
    }

    /// <summary>
    /// Un număr din flux: grupe de 5 biți, bitul 6 (0x20) marchează „mai urmează", iar bitul 0 e
    /// semnul. `false` dacă textul se termină la mijlocul unui număr.
    /// </summary>
    private static bool TryReadValue(string encoded, ref int index, out int value)
    {
        value = 0;
        var shift = 0;
        int chunk;

        do
        {
            if (index >= encoded.Length) return false;

            chunk = encoded[index++] - 63;
            if (chunk < 0) return false;

            value |= (chunk & 0x1f) << shift;
            shift += 5;

            // Un număr mai lung de 6 grupe nu încape într-un int; textul e stricat.
            if (shift > 30) return false;
        }
        while (chunk >= 0x20);

        value = (value & 1) != 0 ? ~(value >> 1) : value >> 1;
        return true;
    }
}
