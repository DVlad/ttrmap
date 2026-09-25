using Npgsql;

namespace TTRMap.Tests;

/// <summary>
/// Politica de conexiune a tuturor testelor care au nevoie de o bază PostgreSQL reală.
///
/// Toată suita rulează peste **același** Postgres (containerul de dev, `max_connections = 100`), iar
/// xUnit rulează colecțiile în paralel (implicit: un thread per procesor). Cele ~32 de clase care
/// pornesc un proces Kestrel își fac fiecare câte o bază: ~12 baze simultan, fiecare cu procesul ei
/// de API. Cu valorile implicite ale Npgsql, amprenta de conexiuni atingea plafonul serverului, iar
/// testul care nimerea exact acolo pica cu `53300: sorry, too many clients already` — o eroare de
/// infrastructură, nu o regresie (vezi `docs/MUTARE-DIN-TTR.md`).
///
/// Ce ocupa, concret, cele 100 de locuri (măsurat cu `pg_stat_activity`, vezi §14.10):
/// <list type="bullet">
/// <item>conexiunea de întreținere era pool-uită, deci fiecare CREATE DATABASE concurent lăsa o
/// conexiune idle pe `postgres` — până la 11 ținute degeaba;</item>
/// <item>fiecare bază activă avea 5-6 conexiuni (procesul de API + procesul de test), iar pool-urile
/// aveau `Connection Idle Lifetime` implicit (300s) și plafon 100, deci nu se goleau între teste;</item>
/// <item>curățarea se făcea cu <c>ClearAllPools()</c>, care e globală în proces: închidea și
/// pool-urile testelor care rulau chiar atunci, în paralel.</item>
/// </list>
/// </summary>
internal static class TestPostgres
{
    /// <summary>Conexiune la o bază existentă, folosită exclusiv pentru CREATE/DROP DATABASE.</summary>
    public static readonly string MaintenanceConnectionString = new NpgsqlConnectionStringBuilder(
        Environment.GetEnvironmentVariable("TTRMAP_TEST_CONNECTION")
        ?? "Host=localhost;Port=5432;Database=postgres;Username=ttr;Password=ttr_dev_password")
    {
        // Nepool-uită: CREATE/DROP DATABASE sunt operații rare, de o singură folosire. Pool-uită,
        // fiecare bază creată în paralel lăsa în urmă o conexiune idle pe `postgres` (măsurat: 11).
        Pooling = false,
    }.ConnectionString;

    /// <summary>
    /// Lanțul de conexiune al unei baze temporare de test, cu pool mărginit.
    /// <paramref name="pooling"/> e `true` pentru procesul de API (serviciile lui de fundal cer
    /// conexiuni la fiecare 2 secunde, deci pool-ul e chiar util) și `false` pentru procesul de
    /// test, care face doar câteva operații scurte per test: pool-uită, fiecare bază activă lăsa în
    /// urmă 1-2 conexiuni idle — cu 12 teste în paralel, doar din asta se ducea o cincime din plafon.
    /// </summary>
    public static string ForDatabase(string databaseName, bool pooling = true) =>
        new NpgsqlConnectionStringBuilder(MaintenanceConnectionString)
        {
            Database = databaseName,
            Pooling = pooling,
            MinPoolSize = 0,
            // Un test face cereri secvențiale, iar aplicația are 7 servicii de fundal: 8 e plafonul
            // care nu blochează nimic legitim, dar oprește un singur proces să ocupe singur serverul.
            MaxPoolSize = 8,
            // Implicit 300s: conexiunile leneșe ale serviciilor de fundal rămâneau deschise cât
            // ținea testul, în toate cele ~12 procese paralele.
            ConnectionIdleLifetime = 10,
            // Implicitele (15s pentru conectare, 30s pentru comandă) sunt potrivite pentru producție,
            // dar aici 12 procese migrează simultan pe același server: un stall de I/O al
            // containerului (checkpoint forțat de CREATE/DROP DATABASE) depășește 30s și pică
            // testul fără ca vreo aserțiune să fie falsă. Testele verifică comportament, nu latență.
            Timeout = 30,
            CommandTimeout = 60,
        }.ConnectionString;

    /// <summary>
    /// Închide **doar** pool-ul acestei baze. <c>ClearAllPools()</c> ar fi închis idle-urile din
    /// pool-urile tuturor testelor care rulează în paralel în același proces.
    /// </summary>
    public static void ClearPool(string connectionString)
    {
        using var connection = new NpgsqlConnection(connectionString);
        NpgsqlConnection.ClearPool(connection);
    }
}
