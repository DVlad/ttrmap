using Microsoft.EntityFrameworkCore;
using TTRMap.Domain.Entities;

namespace TTRMap.Infrastructure.Data;

/// <summary>
/// Baza de date a serviciului de hartă: **doar punctele montane**.
///
/// <para>
/// De ce o bază separată și nu cea a TTR: harta are propriul ciclu de viață (importuri OSM care se
/// reiau, curățare, reimport după o lună), iar o migrare de hartă care se aplică peste tabelele de
/// antrenament e un risc fără niciun cîștig. Contul rămîne comun prin **tokenul JWT**, nu prin tabelul
/// de utilizatori: serviciul ăsta validează tokenul emis de TTR și nu are nevoie de `Users`.
/// </para>
///
/// <para>
/// `MountainPois` e singura tabelă de aici, deliberat. Traseele salvate au rămas în TTR, fiindcă le
/// folosește și antrenamentul (ride, grupuri) — dacă ar fi duplicate, aceeași rută planificată pe hartă
/// ar exista în două locuri care se pot contrazice.
/// </para>
/// </summary>
public class MapDbContext(DbContextOptions<MapDbContext> options) : DbContext(options)
{
    public DbSet<MountainPoi> MountainPois => Set<MountainPoi>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<MountainPoi>(e =>
        {
            e.Property(p => p.Name).HasMaxLength(200);
            e.Property(p => p.Source).HasMaxLength(32);
            e.Property(p => p.SourceRef).HasMaxLength(64);
            e.Property(p => p.VerifiedBy).HasMaxLength(200);
            e.Property(p => p.Notes).HasMaxLength(1000);
            e.Property(p => p.AttributesJson).HasColumnType("text");

            // Identitatea rîndului la sursă: un re-import al aceleiași zone actualizează, nu dublează.
            e.HasIndex(p => new { p.Source, p.SourceRef }).IsUnique();
            // Interogarea reală e „ce se vede pe ecran": un dreptunghi pe lat/lon. Fără index,
            // fiecare pan al hărții ar scana tot tabelul.
            e.HasIndex(p => new { p.Latitude, p.Longitude });
        });
    }
}
