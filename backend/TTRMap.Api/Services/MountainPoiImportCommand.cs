using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;

namespace TTRMap.Api.Services;

/// <summary>
/// Comanda de ops care importă punctele montane dintr-o zonă din OSM:
/// <c>--import-mountain-pois &lt;lat_sud,lon_vest,lat_nord,lon_est&gt;</c>.
///
/// <para>
/// De ce există, cînd există și <c>POST /api/mountain-pois/import</c>: endpoint-ul cere un cont de
/// administrator autentificat, iar primul import — cel care umple harta de la zero — se face la
/// instalare, cînd nu te-ai logat nicăieri. Comanda folosește **aceeași imagine publicată** și aceeași
/// conexiune ca aplicația (tiparul lui <c>--migrate-only</c> și <c>--import-food-catalog</c>), deci nu
/// are nevoie de un mediu separat.
/// </para>
///
/// <para>
/// Se rulează, în producție, prin
/// <c>docker compose run --rm backend --import-mountain-pois 45.30,24.20,45.75,25.00</c>.
/// Fără ea, stratul de puncte rămîne gol: pe hartă nu apare nicio cabană, deși codul e acolo.
/// </para>
///
/// <para>
/// **Durează.** Măsurat pe 2026-09-23: ~178 de secunde pentru un masiv (Făgăraș), iar un mirror a
/// răspuns 504. Nu e o comandă de pornire, e una de rulat cu răbdare.
/// </para>
/// </summary>
public static class MountainPoiImportCommand
{
    public const string Argument = "--import-mountain-pois";

    /// <summary>
    /// Dreptunghiul cerut, sau `null` dacă argumentul nu e prezent.
    ///
    /// </summary>
    /// <exception cref="ArgumentException">
    /// Argumentul e prezent, dar lipsește dreptunghiul sau e invalid. Se aruncă în loc să se tacă:
    /// un pas de ops care „reușește" fără să importe nimic e exact tăcerea care costă un strat gol.
    /// </exception>
    public static GeoBbox? ReadBbox(IEnumerable<string> args)
    {
        var list = args.ToList();
        var index = list.FindIndex(argument =>
            string.Equals(argument, Argument, StringComparison.OrdinalIgnoreCase));

        if (index < 0) return null;

        if (index + 1 >= list.Count || list[index + 1].StartsWith("--", StringComparison.Ordinal))
            throw new ArgumentException($"{Argument} are nevoie de dreptunghiul zonei „lat_sud,lon_vest,lat_nord,lon_est\".");

        if (!MountainPoiPolicy.TryParseBbox(list[index + 1], out var bbox, out var error))
            throw new ArgumentException($"{Argument}: {error}");

        return bbox;
    }

    /// <summary>
    /// Rulează importul. Întoarce codul de ieșire: 0 cînd ceva a intrat în bază, 1 cînd zona nu a
    /// produs niciun punct — o zonă fără cabane în OSM e posibilă, dar mai probabilă e o greșeală de
    /// dreptunghi, iar un pas de deploy nu are voie s-o raporteze ca succes.
    /// </summary>
    public static async Task<int> RunAsync(
        IServiceProvider services, ILogger logger, GeoBbox bbox, CancellationToken ct = default)
    {
        using var scope = services.CreateScope();
        var importer = scope.ServiceProvider.GetRequiredService<IOsmMountainPoiImporter>();

        MountainPoiImportResult result;
        try
        {
            result = await importer.ImportAsync(bbox, ct);
        }
        catch (OverpassUnavailableException ex)
        {
            // Fără `catch`, un pas de ops terminat cu stack trace arată ca un bug al nostru. E o sursă
            // externă picată: se spune scurt, se iese cu cod 1, iar omul reîncearcă mai tîrziu.
            logger.LogError(
                "Importul a eșuat: niciun mirror Overpass nu a răspuns pentru {Bbox}. {Message}",
                bbox.ToString(), ex.Message);
            return 1;
        }

        logger.LogInformation(
            "Puncte montane pentru {Bbox}: {Fetched} de la sursă, {Accepted} acceptate, " +
            "{Inserted} noi, {Updated} actualizate (sursa: {Endpoint}).",
            bbox.ToString(), result.Fetched, result.Accepted, result.Inserted, result.Updated, result.Endpoint);

        if (result.Fetched > result.Accepted)
        {
            logger.LogWarning(
                "Atenție: {Skipped} puncte au fost lăsate afară, peste plafonul de {Limit}. " +
                "Rulează comanda pe zone mai mici ca să le acoperi pe toate.",
                result.Fetched - result.Accepted, MountainPoiPolicy.MaxImportLimit);
        }

        return result.Inserted + result.Updated > 0 ? 0 : 1;
    }
}
