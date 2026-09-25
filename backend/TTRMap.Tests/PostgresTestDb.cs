using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using TTRMap.Infrastructure.Data;

namespace TTRMap.Tests;

/// <summary>
/// Bază PostgreSQL temporară pentru teste (singurul provider suportat de aplicație). Fiecare test
/// care are nevoie de o bază reală își creează una proprie (<c>ttrmap_test_&lt;guid&gt;</c>) și o șterge
/// la final. Baza de întreținere (pentru CREATE/DROP DATABASE) se ia din variabila de mediu
/// <c>TTRMAP_TEST_CONNECTION</c>; utilizatorul trebuie să aibă drept de CREATEDB.
/// <para>
/// Pool-urile sunt mărginite de <see cref="TestPostgres"/>: suita rulează 12 astfel de baze în
/// paralel peste același server, iar amprenta implicită de conexiuni a Npgsql depășea
/// `max_connections` (vezi `docs/MUTARE-DIN-TTR.md`).
/// </para>
/// </summary>
internal sealed class PostgresTestDb : IDisposable
{
    private readonly string _databaseName;

    public string ConnectionString { get; }

    /// <param name="createSchema">
    /// true (implicit) creează schema din model (`EnsureCreated`) — ce vor aproape toate testele.
    /// false lasă baza complet goală, pentru testele care verifică **migrările** (aplicate de la
    /// zero) sau bootstrap-ul bazei.
    /// </param>
    public PostgresTestDb(bool createSchema = true)
    {
        // Același switch ca în Program.cs: entitățile amestecă DateTime cu Kind Utc și Unspecified.
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        _databaseName = $"ttrmap_test_{Guid.NewGuid():N}";
        ConnectionString = TestPostgres.ForDatabase(_databaseName);

        Execute(TestPostgres.MaintenanceConnectionString, $"CREATE DATABASE \"{_databaseName}\"");

        if (!createSchema) return;

        using var db = NewContext();
        db.Database.EnsureCreated();
    }

    /// <param name="interceptors">
    /// Interceptori EF, pentru testele care verifică **forma** interogărilor (ex. câte rânduri
    /// întoarce o singură citire). Nu afectează testele obișnuite, care nu trimit niciunul.
    /// </param>
    public MapDbContext NewContext(params IInterceptor[] interceptors)
    {
        // Nepool-uit: procesul de test face doar câteva operații per test, iar pool-urile lui erau
        // cele care țineau conexiuni idle pentru fiecare bază activă (vezi TestPostgres).
        var builder = new DbContextOptionsBuilder<MapDbContext>()
            .UseNpgsql(TestPostgres.ForDatabase(_databaseName, pooling: false));
        if (interceptors.Length > 0) builder.AddInterceptors(interceptors);
        return new MapDbContext(builder.Options);
    }

    public void Dispose()
    {
        // Conexiunile idle din pool ar bloca DROP DATABASE; FORCE (PG 13+) le închide oricum.
        // Se curăță doar pool-ul acestei baze: ClearAllPools() e globală în proces și ar închide
        // idle-urile testelor care rulează în paralel. Procesul de test nu mai pool-uiește (vezi
        // TestPostgres), deci apelul e ieftin și acoperă doar varianta pool-uită, dacă apare.
        TestPostgres.ClearPool(ConnectionString);
        try
        {
            Execute(TestPostgres.MaintenanceConnectionString, $"DROP DATABASE IF EXISTS \"{_databaseName}\" WITH (FORCE)");
        }
        catch (NpgsqlException)
        {
            // Cleanup best-effort: o bază ttrmap_test_* rămasă în urmă nu trebuie să pice testul.
        }
    }

    private static void Execute(string connectionString, string sql)
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }
}
