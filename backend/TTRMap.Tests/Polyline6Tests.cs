using TTRMap.Application.Services;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Decodorul de geometrie al Valhalla (polyline6, precizie 1e-6).
///
/// Fixture-urile sînt generate cu un encoder scris separat și verificate prin decodare încrucișată,
/// nu luate din memorie: formatul are două capcane reale — semnul numerelor negative (complementul
/// lui 1, nu simpla negare) și precizia, care la 1e-5 ar muta un traseu de munte cu cîțiva metri.
/// </summary>
public class Polyline6Tests
{
    [Fact]
    public void Decode_ReadsASinglePoint()
    {
        var points = Polyline6.Decode("gcxtuAo|vpo@");

        Assert.Single(points);
        Assert.Equal(45.4457, points[0].Latitude, 6);
        Assert.Equal(25.4566, points[0].Longitude, 6);
    }

    [Fact]
    public void Decode_ReadsTwoPointsAsDeltas()
    {
        // A doua pereche e o **diferență** față de prima, nu o valoare absolută — greșeala clasică.
        var points = Polyline6.Decode("gcxtuAo|vpo@fxrAwlN");

        Assert.Equal(2, points.Count);
        Assert.Equal(45.4457, points[0].Latitude, 6);
        Assert.Equal(25.4566, points[0].Longitude, 6);
        Assert.Equal(45.4028, points[1].Latitude, 6);
        Assert.Equal(25.4645, points[1].Longitude, 6);
    }

    [Fact]
    public void Decode_ReadsAThreePointTrail()
    {
        var points = Polyline6.Decode("gcxtuAo|vpo@fxrAwlNwzcKvdzr@");

        Assert.Equal(3, points.Count);
        Assert.Equal(45.6019, points[2].Latitude, 6);
        Assert.Equal(24.6150, points[2].Longitude, 6);
    }

    [Fact]
    public void Decode_KeepsNegativeLongitudes()
    {
        // Longitudine estică pozitivă, apoi una vestică: semnul se pierde dacă se folosește `>>` în loc
        // de `~` pentru complement.
        var points = Polyline6.Decode("vmbr_Agw}k_H");

        Assert.Single(points);
        Assert.Equal(-33.8675, points[0].Latitude, 6);
        Assert.Equal(151.2073, points[0].Longitude, 6);
    }

    [Fact]
    public void Decode_ReturnsEmptyForEmptyInput()
    {
        Assert.Empty(Polyline6.Decode(null));
        Assert.Empty(Polyline6.Decode(""));
    }

    [Fact]
    public void Decode_StopsInsteadOfThrowingOnTruncatedInput()
    {
        // Un răspuns tăiat nu are voie să dărîme cererea: întoarce ce a putut citi.
        var points = Polyline6.Decode("gcxtuAo|vpo@fxrAw");

        Assert.Single(points);
    }
}
