using TTRMap.Application.Services;
using TTRMap.Domain.Enums;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Regulile cererilor de puncte montane. Un dreptunghi valid e valid indiferent cine îl cere, deci
/// testele aici sînt contractul dintre client și bază: ce se acceptă, ce se refuză și ce se plafonează.
/// </summary>
public class MountainPoiPolicyTests
{
    [Theory]
    [InlineData("45.30,24.20,45.75,25.00")]
    [InlineData("45.3,24.2,45.75,25")]      // fără zecimale inutile
    [InlineData("45,24,45.1,24.1")]         // zonă mică
    public void TryParseBbox_AcceptsReasonableBoxes(string raw)
    {
        Assert.True(MountainPoiPolicy.TryParseBbox(raw, out var bbox, out var error));
        Assert.Null(error);
        Assert.True(bbox.North > bbox.South);
        Assert.True(bbox.East > bbox.West);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("45.30,24.20,45.75")]                 // trei numere
    [InlineData("45.30,24.20,45.75,25.00,1")]         // cinci
    [InlineData("a,b,c,d")]
    [InlineData("46.00,24.20,45.75,25.00")]           // colțuri inversate
    [InlineData("91,24,92,25")]                       // latitudine imposibilă
    [InlineData("45,24,45.1,24.1, ")]
    public void TryParseBbox_RefusesMalformedInput(string? raw)
    {
        Assert.False(MountainPoiPolicy.TryParseBbox(raw, out _, out var error));
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    [Fact]
    public void TryParseBbox_RefusesABoxBiggerThanTheLimit()
    {
        // 11° pe latitudine, peste plafonul de 10°: o cerere de țară întreagă nu are ce căuta aici.
        Assert.False(MountainPoiPolicy.TryParseBbox("40,20,51,30", out _, out var error));
        Assert.Contains("prea mare", error);

        // Fix la limită trece.
        Assert.True(MountainPoiPolicy.TryParseBbox("40,20,50,30", out _, out _));
    }

    [Fact]
    public void TryParseBbox_DoesNotLetAnInfiniteValueThrough()
    {
        // „Infinity" se parsează ca double în unele culturi — nu are voie să ajungă în SQL.
        Assert.False(MountainPoiPolicy.TryParseBbox("Infinity,0,1,1", out _, out _));
        Assert.False(MountainPoiPolicy.TryParseBbox("NaN,0,1,1", out _, out _));
    }

    [Fact]
    public void ClampLimit_UsesTheDefaultWhenNothingIsAsked()
    {
        Assert.Equal(MountainPoiPolicy.DefaultLimit, MountainPoiPolicy.ClampLimit(null));
        Assert.Equal(MountainPoiPolicy.DefaultLimit, MountainPoiPolicy.ClampLimit(0));
        Assert.Equal(MountainPoiPolicy.DefaultLimit, MountainPoiPolicy.ClampLimit(-5));
    }

    [Fact]
    public void ClampLimit_DoesNotRefuseTheRequest_ItJustCapsIt()
    {
        Assert.Equal(120, MountainPoiPolicy.ClampLimit(120));
        Assert.Equal(MountainPoiPolicy.MaxLimit, MountainPoiPolicy.ClampLimit(1_000_000));
    }

    [Fact]
    public void TryParseCategories_EmptyMeansAllCategories()
    {
        Assert.True(MountainPoiPolicy.TryParseCategories(null, out var none, out _));
        Assert.Empty(none);

        Assert.True(MountainPoiPolicy.TryParseCategories("  ", out none, out _));
        Assert.Empty(none);
    }

    [Fact]
    public void TryParseCategories_ReadsNamesIgnoringCase()
    {
        Assert.True(MountainPoiPolicy.TryParseCategories("Hut, shelter ,Water", out var categories, out var error));

        Assert.Null(error);
        Assert.Equal(
            new[] { MountainPoiCategory.Hut, MountainPoiCategory.Shelter, MountainPoiCategory.Water },
            categories);
    }

    [Fact]
    public void TryParseCategories_DoesNotRepeatACategory()
    {
        Assert.True(MountainPoiPolicy.TryParseCategories("hut,HUT,hut", out var categories, out _));
        Assert.Single(categories);
    }

    [Fact]
    public void TryParseCategories_RefusesAnUnknownNameAndListsTheValidOnes()
    {
        Assert.False(MountainPoiPolicy.TryParseCategories("hut,cabana", out var categories, out var error));

        Assert.Empty(categories);
        Assert.Contains("cabana", error);
        // Mesajul trebuie să spună ce e acceptat, altfel clientul ghicește.
        Assert.Contains("shelter", error);
    }

    [Fact]
    public void TryNormalizeSearchQuery_TrimsTheText()
    {
        Assert.True(MountainPoiPolicy.TryNormalizeSearchQuery("  Omu  ", out var normalized, out _));
        Assert.Equal("Omu", normalized);
    }

    [Theory]
    [InlineData("50%", "50\\%")]
    [InlineData("C_a", "C\\_a")]
    [InlineData("100%_x", "100\\%\\_x")]
    public void TryNormalizeSearchQuery_EscapesTheLikeMetacharacters(string raw, string expected)
    {
        // Fără escape, „50%" ar găsi orice, iar „C_a" ar găsi „Cea" — rezultate fără legătură cu ce a
        // scris omul, fără ca el să înțeleagă de ce.
        Assert.True(MountainPoiPolicy.TryNormalizeSearchQuery(raw, out var normalized, out _));
        Assert.Equal(expected, normalized);
    }

    [Fact]
    public void TryNormalizeSearchQuery_EscapesTheBackslashFirst()
    {
        // Ordinea contează: dacă `%` s-ar escape prima, un `\` intrat de om ar deveni iar metacaracter
        // (sau ar strica escaping-ul de dinainte).
        Assert.True(MountainPoiPolicy.TryNormalizeSearchQuery("a\\b", out var normalized, out _));
        Assert.Equal("a\\\\b", normalized);
    }

    [Fact]
    public void TryNormalizeSearchQuery_RefusesEmptyAndTooLong()
    {
        Assert.False(MountainPoiPolicy.TryNormalizeSearchQuery(null, out _, out var emptyError));
        Assert.False(string.IsNullOrWhiteSpace(emptyError));

        Assert.False(MountainPoiPolicy.TryNormalizeSearchQuery("   ", out _, out _));

        var tooLong = new string('a', MountainPoiPolicy.MaxSearchLength + 1);
        Assert.False(MountainPoiPolicy.TryNormalizeSearchQuery(tooLong, out _, out var longError));
        Assert.Contains("cel mult", longError);

        // Fix la limită trece.
        Assert.True(MountainPoiPolicy.TryNormalizeSearchQuery(
            new string('a', MountainPoiPolicy.MaxSearchLength), out _, out _));
    }

    [Fact]
    public void ClampSearchLimit_UsesTheDefaultAndCapsTheRest()
    {
        Assert.Equal(MountainPoiPolicy.DefaultSearchLimit, MountainPoiPolicy.ClampSearchLimit(null));
        Assert.Equal(MountainPoiPolicy.DefaultSearchLimit, MountainPoiPolicy.ClampSearchLimit(0));
        Assert.Equal(5, MountainPoiPolicy.ClampSearchLimit(5));
        Assert.Equal(MountainPoiPolicy.MaxSearchLimit, MountainPoiPolicy.ClampSearchLimit(10_000));
    }
}
