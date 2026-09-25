using TTRMap.Application.Services;
using TTRMap.Domain.Enums;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Regulile cererii de rutare. Granița se apără aici, înainte de motor: o listă prea lungă, un punct
/// imposibil sau două puncte suprapuse nu au voie să ajungă la Valhalla, unde ar ieși o eroare pe care
/// nimeni nu știe s-o explice.
/// </summary>
public class RoutePlanPolicyTests
{
    private static GeoPoint P(double latitude, double longitude) => new(latitude, longitude);

    [Fact]
    public void TryValidate_AcceptsTwoPoints()
    {
        Assert.True(RoutePlanPolicy.TryValidate([P(45.44, 25.45), P(45.40, 25.46)], out var error));
        Assert.Null(error);
    }

    [Fact]
    public void TryValidate_AcceptsTheMaximumNumberOfPoints()
    {
        var points = Enumerable.Range(0, RoutePlanPolicy.MaxWaypoints)
            .Select(i => P(45.0 + (i * 0.01), 25.0))
            .ToList();

        Assert.True(RoutePlanPolicy.TryValidate(points, out _));
    }

    [Fact]
    public void TryValidate_RefusesMoreThanTheMaximum()
    {
        var points = Enumerable.Range(0, RoutePlanPolicy.MaxWaypoints + 1)
            .Select(i => P(45.0 + (i * 0.01), 25.0))
            .ToList();

        Assert.False(RoutePlanPolicy.TryValidate(points, out var error));
        Assert.Contains("25", error, StringComparison.Ordinal);
    }

    [Fact]
    public void TryValidate_RefusesFewerThanTwoPoints()
    {
        Assert.False(RoutePlanPolicy.TryValidate([P(45.4, 25.4)], out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));

        Assert.False(RoutePlanPolicy.TryValidate([], out _));
        Assert.False(RoutePlanPolicy.TryValidate(null, out _));
    }

    [Theory]
    [InlineData(91, 25)]
    [InlineData(-91, 25)]
    [InlineData(45, 181)]
    [InlineData(45, -181)]
    [InlineData(double.NaN, 25)]
    [InlineData(45, double.PositiveInfinity)]
    public void TryValidate_RefusesImpossibleCoordinates(double latitude, double longitude)
    {
        Assert.False(RoutePlanPolicy.TryValidate([P(latitude, longitude), P(45.40, 25.46)], out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void TryValidate_RefusesTwoPointsInTheSamePlace()
    {
        // Sub un metru: motorul nu are ce rută să caute între ele.
        Assert.False(RoutePlanPolicy.TryValidate([P(45.4457, 25.4566), P(45.44570, 25.45660)], out var error));
        Assert.Contains("același loc", error, StringComparison.Ordinal);
    }

    [Fact]
    public void TryValidate_AcceptsTwoPointsAFewMetersApart()
    {
        // ~11 m: destul cît să existe un drum între ele.
        Assert.True(RoutePlanPolicy.TryValidate([P(45.4457, 25.4566), P(45.44580, 25.4566)], out _));
    }

    [Theory]
    [InlineData(null, TravelProfile.Foot)]
    [InlineData("", TravelProfile.Foot)]
    [InlineData("foot", TravelProfile.Foot)]
    [InlineData("FOOT", TravelProfile.Foot)]
    [InlineData(" pedestrian ", TravelProfile.Foot)]
    [InlineData("bike", TravelProfile.Bike)]
    [InlineData("bicycle", TravelProfile.Bike)]
    [InlineData("mtb", TravelProfile.Mtb)]
    [InlineData("MOUNTAIN", TravelProfile.Mtb)]
    public void TryParseProfile_ReadsTheKnownNames(string? raw, TravelProfile expected)
    {
        Assert.True(RoutePlanPolicy.TryParseProfile(raw, out var profile));
        Assert.Equal(expected, profile);
    }

    [Theory]
    [InlineData("car")]
    [InlineData("horse")]
    [InlineData("telecabina")]
    public void TryParseProfile_RefusesUnknownNames(string raw)
    {
        Assert.False(RoutePlanPolicy.TryParseProfile(raw, out _));
    }

    [Fact]
    public void TryParseProfile_DefaultIsFoot()
    {
        // Un client care nu trimite profilul nu are voie să primească tăcut rutare de mașină.
        Assert.True(RoutePlanPolicy.TryParseProfile(null, out var profile));
        Assert.Equal(TravelProfile.Foot, profile);
    }

    [Fact]
    public void HaversineMeters_MeasuresAKnownDistance()
    {
        // 45,4457/25,4566 -> 45,4028/25,4645: ~4,81 km (calculat cu raza medie a Pămîntului).
        var meters = RoutePlanPolicy.HaversineMeters(P(45.4457, 25.4566), P(45.4028, 25.4645));
        Assert.InRange(meters, 4750, 4870);
    }
}
