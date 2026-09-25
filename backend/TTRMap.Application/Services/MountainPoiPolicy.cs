using System.Globalization;
using TTRMap.Domain.Enums;

namespace TTRMap.Application.Services;

/// <summary>Un dreptunghi geografic, în grade zecimale (WGS84).</summary>
public readonly record struct GeoBbox(double South, double West, double North, double East)
{
    public double SpanLatitude => North - South;
    public double SpanLongitude => East - West;

    /// <summary>Cheia folosită în cache-ul OSM și în log-uri: „lat_s,lon_v,lat_n,lon_e".</summary>
    public override string ToString() =>
        string.Join(',', new[]
        {
            South.ToString("0.####", CultureInfo.InvariantCulture),
            West.ToString("0.####", CultureInfo.InvariantCulture),
            North.ToString("0.####", CultureInfo.InvariantCulture),
            East.ToString("0.####", CultureInfo.InvariantCulture),
        });
}

/// <summary>
/// Regulile prin care se cere o listă de puncte montane.
///
/// <para>
/// De ce un dreptunghi și nu un „cerc cu rază": harta oricum cere ce se vede pe ecran, iar un
/// dreptunghi se poate valida ieftin (încadrare, colțuri, întindere) înainte de a atinge baza. Un
/// cercuri cu rază ar fi însemnat trigonometrie în SQL pentru niciun cîștig.
/// </para>
///
/// <para>
/// Regulile de dreptunghi **sînt intenționat aceleași** ca la cache-ul OSM (<c>OsmCachePolicy</c>):
/// dacă un dreptunghi e prea mare ca să fie cache-uit, e prea mare și ca să fie importat dintr-o
/// bucată. Nu refolosim codul de acolo pentru că mesajele de eroare sînt diferite (acolo vorbesc
/// despre cache, aici despre import), iar un mesaj care trimite omul greșit e mai rău decît o
/// duplicare de 20 de linii.
/// </para>
/// </summary>
public static class MountainPoiPolicy
{
    /// <summary>Cît de mare poate fi un dreptunghi cerut (grade pe fiecare axă).</summary>
    public const double MaxSpanDegrees = 10;

    /// <summary>Plafonul unei răspuns de listă, ca un ecran să nu ceară țara întreagă.</summary>
    public const int MaxLimit = 2000;

    /// <summary>Cîte puncte se întorc cînd clientul nu cere nimic anume.</summary>
    public const int DefaultLimit = 500;

    /// <summary>
    /// Cît de scurt poate fi textul căutat. Sub atît, căutarea se face la fiecare tastă apăsată și ar
    /// întoarce jumătate din tabel: clientul primește listă goală, nu eroare, pentru că tastarea nu e
    /// o greșeală a clientului.
    /// </summary>
    public const int MinSearchLength = 2;

    /// <summary>Plafonul textului căutat, ca un `q` uriaș să nu ajungă într-un `ILIKE`.</summary>
    public const int MaxSearchLength = 100;

    public const int DefaultSearchLimit = 20;

    public const int MaxSearchLimit = 50;

    /// <summary>
    /// Cîte puncte importă o singură cerere. Importul e o operație de administrator, dar și așa:
    /// un dreptunghi de 10° pe 10° ar putea întoarce zeci de mii de rînduri, iar un import care
    /// blochează baza trei minute nu ajută pe nimeni.
    /// </summary>
    public const int MaxImportLimit = 5000;

    public const string BboxFormatHint =
        "Dreptunghiul trebuie scris „lat_sud,lon_vest,lat_nord,lon_est\" (ex. 45.30,24.20,45.75,25.00).";

    /// <summary>
    /// Validează un dreptunghi scris ca text: patru numere, în ordine, cu colțurile puse corect.
    /// </summary>
    public static bool TryParseBbox(string? raw, out GeoBbox bbox, out string? error)
    {
        bbox = default;
        error = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            error = "Lipsește dreptunghiul (bbox).";
            return false;
        }

        var parts = raw.Split(',');
        if (parts.Length != 4)
        {
            error = BboxFormatHint;
            return false;
        }

        var values = new double[4];
        for (var i = 0; i < parts.Length; i++)
        {
            if (!double.TryParse(parts[i].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out values[i])
                || double.IsNaN(values[i]) || double.IsInfinity(values[i]))
            {
                error = BboxFormatHint;
                return false;
            }
        }

        var (south, west, north, east) = (values[0], values[1], values[2], values[3]);

        if (south is < -90 or > 90 || north is < -90 or > 90 || west is < -180 or > 180 || east is < -180 or > 180)
        {
            error = "Coordonatele trebuie să fie latitudini (−90…90) și longitudini (−180…180).";
            return false;
        }

        if (south > north || west > east)
        {
            error = "Colțul sud-vest trebuie să fie înaintea celui nord-est.";
            return false;
        }

        bbox = new GeoBbox(south, west, north, east);

        if (bbox.SpanLatitude > MaxSpanDegrees || bbox.SpanLongitude > MaxSpanDegrees)
        {
            error = $"Dreptunghiul e prea mare (maxim {MaxSpanDegrees:0}° pe fiecare axă). Cere o zonă mai mică.";
            return false;
        }

        return true;
    }

    /// <summary>Plafonează numărul cerut de client, fără să refuze cererea.</summary>
    public static int ClampLimit(int? requested, int max = MaxLimit) =>
        requested is null or <= 0 ? DefaultLimit : Math.Min(requested.Value, max);

    /// <summary>Plafonează numărul de rezultate de căutare.</summary>
    public static int ClampSearchLimit(int? requested) =>
        requested is null or <= 0 ? DefaultSearchLimit : Math.Min(requested.Value, MaxSearchLimit);

    /// <summary>
    /// Normalizează textul căutat și **escapează metacaracterele `LIKE`**.
    ///
    /// <para>
    /// De ce escaping: `%` și `_` sînt metacaractere în `ILIKE`. Fără escape, căutarea „50%" ar găsi
    /// orice, iar „C_a" ar găsi „Cea" — adică utilizatorul ar primi rezultate care nu au legătură cu ce
    /// a scris, fără să înțeleagă de ce. Backslash-ul se escapează primul, altfel un `\%` intrat de om
    /// ar deveni iar metacaracter.
    /// </para>
    /// </summary>
    public static bool TryNormalizeSearchQuery(string? raw, out string normalized, out string? error)
    {
        normalized = string.Empty;
        error = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            error = "Lipsește textul căutat.";
            return false;
        }

        var trimmed = raw.Trim();
        if (trimmed.Length > MaxSearchLength)
        {
            error = $"Textul căutat poate avea cel mult {MaxSearchLength} de caractere.";
            return false;
        }

        normalized = trimmed
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_");

        return true;
    }

    /// <summary>Caracterul de escape folosit în `ILIKE`, ca escaping-ul de mai sus să fie cel executat.</summary>
    public const char LikeEscapeCharacter = '\\';

    /// <summary>
    /// Citește filtrele de categorie dintr-un text de forma „hut,shelter". Text gol sau lipsă
    /// înseamnă **toate** categoriile.
    /// </summary>
    public static bool TryParseCategories(
        string? raw, out IReadOnlyList<MountainPoiCategory> categories, out string? error)
    {
        error = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            categories = [];
            return true;
        }

        var parsed = new List<MountainPoiCategory>();
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (!Enum.TryParse<MountainPoiCategory>(part, ignoreCase: true, out var category))
            {
                error = $"Categorie necunoscută: „{part}\". " +
                        $"Valori acceptate: {string.Join(", ", Enum.GetNames<MountainPoiCategory>().Select(n => n.ToLowerInvariant()))}.";
                categories = [];
                return false;
            }

            if (!parsed.Contains(category)) parsed.Add(category);
        }

        categories = parsed;
        return true;
    }
}
