using Microsoft.EntityFrameworkCore;
using TTRMap.Application.Interfaces;
using TTRMap.Application.Services;
using TTRMap.Domain.Entities;
using TTRMap.Domain.Enums;
using TTRMap.Infrastructure.Data;
using TTRMap.Infrastructure.Repositories;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Punctele montane pe PostgreSQL real. Aici se apără exact promisiunea care face importul utilizabil:
/// **un re-import nu dublează rîndurile și nu șterge ce a confirmat un om.** Fără asta, a doua
/// importare a unei zone ar arunca munca de verificare făcută manual.
/// </summary>
public sealed class MountainPoiRepositoryTests : IDisposable
{
    private static readonly GeoBbox Fagaras = new(45.30, 24.20, 45.75, 25.00);

    private readonly PostgresTestDb _database = new();
    private readonly MapDbContext _db;

    public MountainPoiRepositoryTests()
    {
        _db = _database.NewContext();
    }

    public void Dispose()
    {
        _db.Dispose();
        _database.Dispose();
    }

    private static MountainPoi Poi(
        string sourceRef,
        MountainPoiCategory category = MountainPoiCategory.Hut,
        double lat = 45.60,
        double lon = 24.60,
        string name = "Cabana") => new()
    {
        Name = name,
        Category = category,
        Latitude = lat,
        Longitude = lon,
        Source = "osm",
        SourceRef = sourceRef,
        ReadAt = new DateTime(2026, 9, 23, 12, 0, 0, DateTimeKind.Utc),
    };

    [Fact]
    public async Task UpsertMany_AddsNewRowsAndReportsThem()
    {
        var result = await new MountainPoiRepository(_db)
            .UpsertManyAsync([Poi("node/1"), Poi("node/2")]);

        Assert.Equal(new MountainPoiUpsertResult(2, 0), result);
        Assert.Equal(2, await _db.MountainPois.CountAsync());
    }

    [Fact]
    public async Task UpsertMany_UpdatesTheSameRowInsteadOfAddingASecondOne()
    {
        var repository = new MountainPoiRepository(_db);
        await repository.UpsertManyAsync([Poi("node/1", name: "Vechi")]);

        var result = await repository.UpsertManyAsync([Poi("node/1", name: "Nou")]);

        Assert.Equal(new MountainPoiUpsertResult(0, 1), result);
        Assert.Equal(1, await _db.MountainPois.CountAsync());
        Assert.Equal("Nou", (await _db.MountainPois.SingleAsync()).Name);
    }

    [Fact]
    public async Task UpsertMany_KeepsTheVerificationAndNotesOfAHuman()
    {
        var repository = new MountainPoiRepository(_db);
        await repository.UpsertManyAsync([Poi("node/1")]);

        var verified = await _db.MountainPois.SingleAsync();
        verified.VerifiedAt = new DateTime(2026, 9, 20, 8, 0, 0, DateTimeKind.Utc);
        verified.VerifiedBy = "mihai";
        verified.Notes = "Telefonul e cel vechi, cabana e închisă de trei ani.";
        await _db.SaveChangesAsync();

        // Re-import după o lună: sursa întoarce aceeaşi cabană, cu altă altitudine.
        var reimport = Poi("node/1");
        reimport.ElevationM = 1600;
        await repository.UpsertManyAsync([reimport]);

        var after = await _db.MountainPois.SingleAsync();
        Assert.Equal(1600, after.ElevationM);                       // datele sursei se actualizează
        Assert.NotNull(after.VerifiedAt);                            // verificarea omului rămîne
        Assert.Equal("mihai", after.VerifiedBy);
        Assert.Equal("Telefonul e cel vechi, cabana e închisă de trei ani.", after.Notes);
        Assert.True(after.IsVerified);
    }

    [Fact]
    public async Task UpsertMany_TreatsTheSameSourceRefFromAnotherSourceAsADifferentRow()
    {
        var repository = new MountainPoiRepository(_db);
        var osm = Poi("node/1");
        var manual = Poi("node/1");
        manual.Source = "salvamont";

        await repository.UpsertManyAsync([osm, manual]);

        Assert.Equal(2, await _db.MountainPois.CountAsync());
    }

    [Fact]
    public async Task UpsertMany_DoesNothingForAnEmptyBatch()
    {
        var result = await new MountainPoiRepository(_db).UpsertManyAsync([]);

        Assert.Equal(new MountainPoiUpsertResult(0, 0), result);
        Assert.Equal(0, await _db.MountainPois.CountAsync());
    }

    [Fact]
    public async Task GetInBbox_ReturnsOnlyWhatFallsInsideTheBox()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
        [
            Poi("node/1", lat: 45.60, lon: 24.60),   // în Făgăraș
            Poi("node/2", lat: 45.30, lon: 24.20),   // pe colț
            Poi("node/3", lat: 46.90, lon: 25.50),   // în altă parte (Bucovina)
        ]);

        var found = await new MountainPoiRepository(_db).GetInBboxAsync(Fagaras, [], 100);

        Assert.Equal(new[] { "node/1", "node/2" }, found.Select(p => p.SourceRef).OrderBy(r => r).ToArray());
    }

    [Fact]
    public async Task GetInBbox_FiltersByCategoryWhenAsked()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
        [
            Poi("node/1", MountainPoiCategory.Hut),
            Poi("node/2", MountainPoiCategory.Shelter),
            Poi("node/3", MountainPoiCategory.Rescue),
        ]);

        var found = await new MountainPoiRepository(_db)
            .GetInBboxAsync(Fagaras, [MountainPoiCategory.Shelter, MountainPoiCategory.Rescue], 100);

        Assert.Equal(2, found.Count);
        Assert.DoesNotContain(found, p => p.Category == MountainPoiCategory.Hut);
    }

    [Fact]
    public async Task GetInBbox_RespectsTheLimit()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
            Enumerable.Range(1, 10).Select(i => Poi($"node/{i}", lon: 24.60 + i * 0.001)).ToList());

        var found = await new MountainPoiRepository(_db).GetInBboxAsync(Fagaras, [], 4);

        Assert.Equal(4, found.Count);
    }

    [Fact]
    public async Task SearchByName_FindsWithoutCaringAboutCase()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
        [
            Poi("node/1", name: "Cabana Omu"),
            Poi("node/2", name: "Cabana Babele"),
        ]);

        var found = await new MountainPoiRepository(_db).SearchByNameAsync("omu", 10);

        Assert.Single(found);
        Assert.Equal("Cabana Omu", found[0].Name);
    }

    [Fact]
    public async Task SearchByName_PrefersTheShorterName()
    {
        // Cine scrie „Omu" vrea cabana, nu o nota administrativă cu numele lung.
        await new MountainPoiRepository(_db).UpsertManyAsync(
        [
            Poi("node/1", name: "Fosta cabană de lîngă vîrful Omu (ruină)"),
            Poi("node/2", name: "Cabana Omu"),
        ]);

        var found = await new MountainPoiRepository(_db).SearchByNameAsync("Omu", 10);

        Assert.Equal("Cabana Omu", found[0].Name);
    }

    [Fact]
    public async Task SearchByName_TreatsThePercentSignAsALiteral()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
        [
            Poi("node/1", name: "Refugiul 50% din potecă"),
            Poi("node/2", name: "Cabana Omu"),
        ]);

        // Așa cum vine din politică: `%` deja escapat.
        Assert.True(MountainPoiPolicy.TryNormalizeSearchQuery("50%", out var normalized, out _));
        var found = await new MountainPoiRepository(_db).SearchByNameAsync(normalized, 10);

        // Dacă escaping-ul n-ar ajunge în SQL, „50%" ar fi găsit TOATE rîndurile.
        Assert.Single(found);
        Assert.Contains("50%", found[0].Name);
    }

    [Fact]
    public async Task SearchByName_RespectsTheLimit()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync(
            Enumerable.Range(1, 10).Select(i => Poi($"node/{i}", name: $"Cabana {i}")).ToList());

        var found = await new MountainPoiRepository(_db).SearchByNameAsync("Cabana", 3);

        Assert.Equal(3, found.Count);
    }

    [Fact]
    public async Task SearchByName_ReturnsNothingWhenNothingMatches()
    {
        await new MountainPoiRepository(_db).UpsertManyAsync([Poi("node/1", name: "Cabana Omu")]);

        Assert.Empty(await new MountainPoiRepository(_db).SearchByNameAsync("Retezat", 10));
    }
}
