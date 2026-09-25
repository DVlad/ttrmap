using TTRMap.Application.Services;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Regulile cererii de altitudine. Granița se apără aici, înainte de orice apel către DEM: o listă
/// prea lungă sau un punct imposibil nu are voie să ajungă la un serviciu extern.
/// </summary>
public class ElevationPolicyTests
{
    [Fact]
    public void TryParseLocations_ReadsAPipeSeparatedList()
    {
        Assert.True(ElevationPolicy.TryParseLocations(
            "45.4456,25.4544|45.4028,25.4645", out var points, out var error));

        Assert.Null(error);
        Assert.Equal(2, points.Count);
        Assert.Equal(45.4456, points[0].Latitude);
        Assert.Equal(25.4544, points[0].Longitude);
        Assert.Equal(25.4645, points[1].Longitude);
    }

    [Fact]
    public void TryParseLocations_IgnoresEmptySegmentsAndSpaces()
    {
        Assert.True(ElevationPolicy.TryParseLocations(
            " 45.4,25.4 |  | 45.5,25.5 ", out var points, out _));

        Assert.Equal(2, points.Count);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("45.4")]                 // lipsește longitudinea
    [InlineData("45.4,25.4,1")]          // prea multe numere
    [InlineData("a,b")]
    [InlineData("91,25")]                // latitudine imposibilă
    [InlineData("45,181")]               // longitudine imposibilă
    [InlineData("NaN,25")]
    [InlineData("Infinity,25")]
    public void TryParseLocations_RefusesMalformedInput(string? raw)
    {
        Assert.False(ElevationPolicy.TryParseLocations(raw, out var points, out var error));
        Assert.Empty(points);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void TryParseLocations_RefusesMorePointsThanTheLimit()
    {
        var many = string.Join('|', Enumerable.Range(0, ElevationPolicy.MaxLocations + 1)
            .Select(_ => "45.4,25.4"));

        Assert.False(ElevationPolicy.TryParseLocations(many, out _, out var error));
        Assert.Contains(ElevationPolicy.MaxLocations.ToString(), error);

        // Fix la limită trece.
        var exact = string.Join('|', Enumerable.Range(0, ElevationPolicy.MaxLocations)
            .Select(_ => "45.4,25.4"));
        Assert.True(ElevationPolicy.TryParseLocations(exact, out var points, out _));
        Assert.Equal(ElevationPolicy.MaxLocations, points.Count);
    }

    [Fact]
    public void Sanitize_KeepsRealAltitudesAndRefusesTheRest()
    {
        Assert.Equal(2505, ElevationPolicy.Sanitize(2505));
        Assert.Equal(0, ElevationPolicy.Sanitize(0));       // nivelul mării e o valoare reală
        Assert.Equal(-430, ElevationPolicy.Sanitize(-430)); // Marea Moartă

        Assert.Null(ElevationPolicy.Sanitize(double.NaN));
        Assert.Null(ElevationPolicy.Sanitize(double.PositiveInfinity));
        Assert.Null(ElevationPolicy.Sanitize(9001));
        Assert.Null(ElevationPolicy.Sanitize(-600));
    }
}
