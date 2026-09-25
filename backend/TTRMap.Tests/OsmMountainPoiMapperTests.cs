using TTRMap.Application.Services;
using TTRMap.Domain.Enums;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Clasificarea punctelor montane din OSM. Testele sînt pe **cazuri reale**, nu pe forme inventate:
/// fiecare scenariu de mai jos a fost ales pentru că s-a văzut în date (vezi măsurătorile din
/// `ttrmap/docs/F0-MAP-IMPLEMENTATION.md` §2.2 — pe Făgăraș sînt 41 de cabane, 17 refugii, 205 way-uri cu
/// `sac_scale`).
///
/// <para>
/// Miza cea mai mare e capcana `amenity=shelter`: în OSM înseamnă, în marea majoritate a cazurilor,
/// adăpost de stație de autobuz. Dacă intră în stratul de refugii, harta se umple de puncte inutile
/// exact acolo unde omul caută ceva serios.
/// </para>
/// </summary>
public class OsmMountainPoiMapperTests
{
    private static readonly DateTime ReadAt = new(2026, 9, 23, 20, 0, 0, DateTimeKind.Utc);

    private static string Response(params string[] elements) =>
        $$"""{ "elements": [ {{string.Join(",", elements)}} ] }""";

    [Fact]
    public void Map_ClassifiesAHutAndParsesTheAltitudeWithUnit()
    {
        var json = Response(
            """{ "type": "node", "id": 1, "lat": 45.60, "lon": 24.60, "tags": { "tourism": "alpine_hut", "name": "Cabana Bîlea", "ele": "1 234 m" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.Equal("Cabana Bîlea", poi.Name);
        Assert.Equal(MountainPoiCategory.Hut, poi.Category);
        Assert.Equal(1234, poi.ElevationM);
        Assert.Equal(45.60, poi.Latitude);
        Assert.Equal(24.60, poi.Longitude);
        Assert.Equal("osm", poi.Source);
        Assert.Equal("node/1", poi.SourceRef);
        Assert.Equal(ReadAt, poi.ReadAt);
    }

    [Fact]
    public void Map_TakesTheCentreOfAWay_BecauseHutsAreOftenDrawnAsAreas()
    {
        // Măsurat pe date reale (Bucegi, 2026-09-23): din 29 de cabane și refugii, **11 erau way-uri**
        // (suprafețe), nu noduri. Fără `out center` în interogare, cele 11 n-ar avea coordonate și ar
        // fi fost sărite în tăcere — mai bine de o treime din strat.
        var json = Response(
            """{ "type": "way", "id": 210926114, "center": { "lat": 45.4028, "lon": 25.4645 }, "tags": { "tourism": "alpine_hut", "name": "Cabana Babele", "ele": "2200" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.Equal(45.4028, poi.Latitude);
        Assert.Equal(25.4645, poi.Longitude);
        Assert.Equal("way/210926114", poi.SourceRef);
        Assert.Equal(MountainPoiCategory.Hut, poi.Category);
    }

    [Fact]
    public void Map_RefusesPlainShelters_BecauseTheyAreBusStopsNotMountainRefuges()
    {
        var json = Response(
            """{ "type": "node", "id": 2, "lat": 45.60, "lon": 24.60, "tags": { "amenity": "shelter", "name": "Stație" } }""");

        Assert.Empty(OsmMountainPoiMapper.Map(json, ReadAt));
    }

    [Fact]
    public void Map_TreatsAWildernessHutAsAShelterNotAsAHut()
    {
        // Găsit pe date reale (Bucegi, 2026-09-23): `node/430758331` se numește „Refugiul Coștila" și
        // e `tourism=wilderness_hut`. Un refugiu nu e o cabană — n-are gazdă, n-are curent, iar cine
        // pornește spre el așteptîndu-se la o cabană are o problemă.
        var json = Response(
            """{ "type": "node", "id": 430758331, "lat": 45.4311298, "lon": 25.40, "tags": { "tourism": "wilderness_hut", "name": "Refugiul Coștila", "ele": "1610" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.Equal(MountainPoiCategory.Shelter, poi.Category);
        Assert.Equal(1610, poi.ElevationM);
    }

    [Fact]
    public void Map_AcceptsAShelterThatSaysItIsAHut()
    {
        var json = Response(
            """{ "type": "node", "id": 3, "lat": 45.60, "lon": 24.60, "tags": { "amenity": "shelter", "shelter_type": "basic_hut" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.Equal(MountainPoiCategory.Shelter, poi.Category);
        // Fără nume în OSM: rîndul rămîne valid, doar numele e gol (un refugiu fără nume e tot util).
        Assert.Equal(string.Empty, poi.Name);
    }

    [Fact]
    public void Map_PrefersTheRescuePostOverTheHutTag()
    {
        // Un post Salvamont care e și refugiu: informația de siguranță are prioritate.
        var json = Response(
            """{ "type": "node", "id": 4, "lat": 45.60, "lon": 24.60, "tags": { "emergency": "mountain_rescue", "tourism": "wilderness_hut", "name": "Salvamont" } }""");

        Assert.Equal(MountainPoiCategory.Rescue, Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt)).Category);
    }

    [Fact]
    public void Map_AcceptsDrinkingWaterButNotAnySpring()
    {
        var json = Response(
            """{ "type": "node", "id": 5, "lat": 45.60, "lon": 24.60, "tags": { "natural": "spring", "drinking_water": "yes" } }""",
            """{ "type": "node", "id": 6, "lat": 45.61, "lon": 24.61, "tags": { "natural": "spring" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.Equal(MountainPoiCategory.Water, poi.Category);
        Assert.Equal("node/5", poi.SourceRef);
    }

    [Fact]
    public void Map_ClassifiesViewpointsAndGuideposts()
    {
        var json = Response(
            """{ "type": "node", "id": 7, "lat": 45.60, "lon": 24.60, "tags": { "tourism": "viewpoint", "name": "Belvedere" } }""",
            """{ "type": "node", "id": 8, "lat": 45.61, "lon": 24.61, "tags": { "information": "guidepost" } }""");

        var pois = OsmMountainPoiMapper.Map(json, ReadAt);

        Assert.Equal(2, pois.Count);
        Assert.Contains(pois, p => p.Category == MountainPoiCategory.Viewpoint);
        Assert.Contains(pois, p => p.Category == MountainPoiCategory.Guidepost);
    }

    [Fact]
    public void Map_SkipsElementsWithoutCoordinatesOrCategory()
    {
        var json = Response(
            // Un way fără `center` (nu putem inventa o coordonată).
            """{ "type": "way", "id": 9, "tags": { "tourism": "alpine_hut" } }""",
            // Un nod cu tag-uri care nu ne interesează.
            """{ "type": "node", "id": 10, "lat": 45.60, "lon": 24.60, "tags": { "amenity": "bench" } }""",
            // Un element fără tag-uri deloc.
            """{ "type": "node", "id": 11, "lat": 45.60, "lon": 24.60 }""");

        Assert.Empty(OsmMountainPoiMapper.Map(json, ReadAt));
    }

    [Fact]
    public void Map_KeepsOneRowPerSourceElement()
    {
        var element =
            """{ "type": "node", "id": 12, "lat": 45.60, "lon": 24.60, "tags": { "tourism": "alpine_hut", "name": "X" } }""";

        Assert.Single(OsmMountainPoiMapper.Map(Response(element, element), ReadAt));
    }

    [Fact]
    public void Map_ReturnsNothingForBrokenJson()
    {
        // Un răspuns trunchiat nu are voie să arunce într-un job de import.
        Assert.Empty(OsmMountainPoiMapper.Map("{ \"elements\": [ {", ReadAt));
        Assert.Empty(OsmMountainPoiMapper.Map("", ReadAt));
    }

    [Fact]
    public void Map_KeepsOnlyTheWhitelistedAttributes()
    {
        var json = Response(
            """{ "type": "node", "id": 13, "lat": 45.60, "lon": 24.60, "tags": { "tourism": "alpine_hut", "phone": "+40 123", "opening_hours": "24/7", "source": "survey", "note": "nu ne interesează", "fixme": "ceva" } }""");

        var poi = Assert.Single(OsmMountainPoiMapper.Map(json, ReadAt));

        Assert.NotNull(poi.AttributesJson);
        Assert.Contains("\"phone\":\"+40 123\"", poi.AttributesJson);
        Assert.Contains("\"opening_hours\":\"24/7\"", poi.AttributesJson);
        Assert.DoesNotContain("fixme", poi.AttributesJson);
        Assert.DoesNotContain("note", poi.AttributesJson);
    }

    [Fact]
    public void Map_ProducesTheSameAttributesJsonRegardlessOfTagOrder()
    {
        var first = Response(
            """{ "type": "node", "id": 14, "lat": 45.6, "lon": 24.6, "tags": { "tourism": "alpine_hut", "phone": "1", "operator": "2" } }""");
        var second = Response(
            """{ "type": "node", "id": 14, "lat": 45.6, "lon": 24.6, "tags": { "tourism": "alpine_hut", "operator": "2", "phone": "1" } }""");

        Assert.Equal(
            OsmMountainPoiMapper.Map(first, ReadAt)[0].AttributesJson,
            OsmMountainPoiMapper.Map(second, ReadAt)[0].AttributesJson);
    }

    [Theory]
    [InlineData("1234", 1234)]
    [InlineData("1234 m", 1234)]
    [InlineData("1 234", 1234)]
    [InlineData("1234,5", 1234.5)]
    [InlineData("1234.5", 1234.5)]
    [InlineData("2000", 2000)]
    public void ParseElevation_ReadsTheFormsThatAppearInOsm(string raw, double expected)
    {
        Assert.Equal(expected, OsmMountainPoiMapper.ParseElevation(raw));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("fără")]
    [InlineData("9001")]   // peste cel mai înalt punct de pe Pămînt
    [InlineData("-600")]   // sub Marea Moartă
    public void ParseElevation_ReturnsNullWhenTheValueIsNotAnAltitude(string? raw)
    {
        Assert.Null(OsmMountainPoiMapper.ParseElevation(raw));
    }

    [Fact]
    public void BuildQuery_ContainsTheBoxAndTheCentreDirective()
    {
        var query = OsmMountainPoiMapper.BuildQuery(new GeoBbox(45.30, 24.20, 45.75, 25.00));

        Assert.Contains("45.3,24.2,45.75,25", query);
        // `center` e obligatoriu: fără el, cabanele desenate ca suprafață n-ar avea coordonate.
        Assert.Contains("out center tags;", query);
        // Refugiile cer `shelter_type` — capcana adăposturilor de stație.
        Assert.Contains("shelter_type", query);
    }
}
