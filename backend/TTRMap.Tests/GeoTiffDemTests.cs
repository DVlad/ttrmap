using System.Buffers.Binary;
using System.IO.Compression;
using TTRMap.Application.Services;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Cititorul de DEM. Testele construiesc un mini-GeoTIFF **cu aceeași structură ca fișierele
/// Copernicus** (float32, tile-uri, DEFLATE, `Predictor=3`), ca să verifice tot drumul — header,
/// decomprimare, predictor, proiecție — fără să depindă de rețea.
///
/// <para>
/// Schema predictorului a fost determinată pe **date reale**, nu dedusă: cu algoritmul de aici,
/// Vîrful Omu iese la 2506 m față de 2505 m cît are în OSM, iar distribuția pe un tile întreg de
/// Făgăraș iese 515–2435 m. Verificarea e notată în `ttrmap/docs/STUDY-MAP.md` §9 (F2).
/// </para>
/// </summary>
public class GeoTiffDemTests
{
    private const int TileWidth = 4;
    private const int TileHeight = 2;

    /// <summary>
    /// Un mini-DEM: un singur tile, cu valorile date. Encodează exact inversul a ce decodează
    /// <see cref="GeoTiffDem.DecodeTile"/> — plane de octeți cu MSB primul, apoi diferențiere pe rînd.
    /// </summary>
    private static byte[] BuildDem(float[] values, double originLat, double originLon, double scale)
    {
        // (a) valorile → plane de octeți (MSB primul), pe fiecare rînd.
        var rowBytes = TileWidth * 4;
        var encoded = new byte[rowBytes * TileHeight];

        for (var row = 0; row < TileHeight; row++)
        {
            for (var column = 0; column < TileWidth; column++)
            {
                var value = values[row * TileWidth + column];
                Span<byte> bigEndian = stackalloc byte[4];
                BinaryPrimitives.WriteSingleBigEndian(bigEndian, value);

                for (var plane = 0; plane < 4; plane++)
                {
                    encoded[row * rowBytes + plane * TileWidth + column] = bigEndian[plane];
                }
            }
        }

        // (b) diferențiere pe rînd, de la coadă spre cap, ca suma cumulativă s-o inverseze exact.
        for (var row = 0; row < TileHeight; row++)
        {
            var baseOffset = row * rowBytes;
            for (var i = rowBytes - 1; i >= 1; i--)
            {
                encoded[baseOffset + i] = (byte)(encoded[baseOffset + i] - encoded[baseOffset + i - 1]);
            }
        }

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            zlib.Write(encoded);
        }
        var tileBytes = compressed.ToArray();

        return BuildTiff(tileBytes, values.Length);
    }

    /// <summary>Antet TIFF cu IFD0, plus tile-ul comprimat lipit imediat după.</summary>
    private static byte[] BuildTiff(byte[] tileBytes, int sampleCount)
    {
        var entries = new (ushort Tag, ushort Type, uint Count, double[] Values)[]
        {
            (256, 3, 1, [TileWidth]),
            (257, 3, 1, [TileHeight]),
            (258, 3, 1, [32]),
            (259, 3, 1, [8]),      // Adobe Deflate
            (317, 3, 1, [3]),      // predictor pentru virgulă mobilă
            (322, 3, 1, [TileWidth]),
            (323, 3, 1, [TileHeight]),
            (324, 4, 1, [0]),      // se completează după ce știm unde începe tile-ul
            (325, 4, 1, [tileBytes.Length]),
            (339, 3, 1, [3]),      // IEEE float
            (33550, 12, 3, [0.0002777777777777778, 0.0002777777777777778, 0]),
            (33922, 12, 6, [0, 0, 0, 25, 46, 0]),
        };

        var ifdOffset = 8;
        var ifdBytes = 2 + entries.Length * 12 + 4;
        var extraOffset = ifdOffset + ifdBytes;

        // Valorile mai lungi de 4 octeți stau după IFD.
        var extra = new List<byte>();
        var valueOffsets = new Dictionary<int, int>();
        for (var i = 0; i < entries.Length; i++)
        {
            var size = entries[i].Count * TypeSize(entries[i].Type);
            if (size <= 4) continue;
            valueOffsets[i] = extraOffset + extra.Count;
            foreach (var v in entries[i].Values) extra.AddRange(ToBytes(entries[i].Type, v));
        }

        var tileOffset = extraOffset + extra.Count;
        var file = new byte[tileOffset + tileBytes.Length];

        file[0] = (byte)'I';
        file[1] = (byte)'I';
        BinaryPrimitives.WriteUInt16LittleEndian(file.AsSpan(2), 42);
        BinaryPrimitives.WriteUInt32LittleEndian(file.AsSpan(4), (uint)ifdOffset);
        BinaryPrimitives.WriteUInt16LittleEndian(file.AsSpan(ifdOffset), (ushort)entries.Length);

        for (var i = 0; i < entries.Length; i++)
        {
            var entry = ifdOffset + 2 + i * 12;
            var (tag, type, count, values) = entries[i];

            // TileOffsets se scrie cu offsetul real al tile-ului.
            double[] effective = tag == 324 ? [tileOffset] : values;

            BinaryPrimitives.WriteUInt16LittleEndian(file.AsSpan(entry), tag);
            BinaryPrimitives.WriteUInt16LittleEndian(file.AsSpan(entry + 2), type);
            BinaryPrimitives.WriteUInt32LittleEndian(file.AsSpan(entry + 4), count);

            var size = count * TypeSize(type);
            if (size <= 4)
            {
                for (var k = 0; k < count; k++)
                {
                    WriteValue(file.AsSpan(entry + 8 + k * TypeSize(type)), type, effective[k]);
                }
            }
            else
            {
                BinaryPrimitives.WriteUInt32LittleEndian(file.AsSpan(entry + 8), (uint)valueOffsets[i]);
            }
        }

        extra.CopyTo(file, extraOffset);
        tileBytes.CopyTo(file, tileOffset);
        _ = sampleCount;
        return file;
    }

    private static int TypeSize(int type) => type switch { 3 => 2, 4 => 4, 12 => 8, _ => 1 };

    private static byte[] ToBytes(int type, double value) => type switch
    {
        3 => [(byte)value, (byte)((int)value >> 8)],
        4 => BitConverter.GetBytes((uint)value),
        12 => BitConverter.GetBytes(value),
        _ => [],
    };

    private static void WriteValue(Span<byte> destination, int type, double value)
    {
        ToBytes(type, value).CopyTo(destination);
    }

    private static readonly float[] Values = [1234.5f, 0f, -0f, 2505.25f, 812f, 1900f, 500.75f, 2455f];

    [Fact]
    public void ParseHeader_ReadsTheStructureCopernicusUses()
    {
        var header = GeoTiffDem.ParseHeader(BuildDem(Values, 46, 25, 1.0 / 3600));

        Assert.NotNull(header);
        Assert.Equal(TileWidth, header.ImageWidth);
        Assert.Equal(TileHeight, header.ImageLength);
        Assert.Equal(32, header.BitsPerSample);
        Assert.Equal(3, header.SampleFormat);
        Assert.Equal(8, header.Compression);
        Assert.Equal(3, header.Predictor);
        Assert.Equal(25, header.OriginLongitude);
        Assert.Equal(46, header.OriginLatitude);
        Assert.Equal(1, header.TilesAcross);
        Assert.Single(header.TileOffsets);
    }

    [Fact]
    public void DecodeTile_InvertsTheFloatingPointPredictor()
    {
        // Turul complet: ce encodează testul (ca encoderul TIFF) trebuie să iasă la loc, exact.
        var file = BuildDem(Values, 46, 25, 1.0 / 3600);
        var header = GeoTiffDem.ParseHeader(file)!;

        var compressed = file[(int)header.TileOffsets[0]..(int)(header.TileOffsets[0] + header.TileByteCounts[0])];
        var inflated = GeoTiffDem.Inflate(compressed, TileWidth * TileHeight * 4);
        var decoded = GeoTiffDem.DecodeTile(inflated, TileWidth, TileHeight);

        Assert.Equal(Values, decoded);
    }

    [Fact]
    public void ReadValue_ReturnsTheElevationOfTheRequestedCoordinate()
    {
        var file = BuildDem(Values, 46, 25, 1.0 / 3600);
        var header = GeoTiffDem.ParseHeader(file)!;

        var compressed = file[(int)header.TileOffsets[0]..(int)(header.TileOffsets[0] + header.TileByteCounts[0])];
        var tile = GeoTiffDem.DecodeTile(GeoTiffDem.Inflate(compressed, TileWidth * TileHeight * 4), TileWidth, TileHeight);

        // Rîndul 1, coloana 3 → a opta valoare (2455).
        var pixel = GeoTiffDem.Project(header, 46 - 1.5 / 3600, 25 + 3.5 / 3600);
        Assert.NotNull(pixel);
        Assert.Equal(2455f, GeoTiffDem.ValueAt(header, tile, pixel.Value.Column, pixel.Value.Row));
    }

    [Fact]
    public void Project_ReturnsNullOutsideTheTile()
    {
        var header = GeoTiffDem.ParseHeader(BuildDem(Values, 46, 25, 1.0 / 3600))!;

        Assert.Null(GeoTiffDem.Project(header, 45.5, 25.5));   // sud de tile
        Assert.Null(GeoTiffDem.Project(header, 46.5, 25.5));   // nord
        Assert.Null(GeoTiffDem.Project(header, 45.9, 24.5));   // vest
    }

    [Fact]
    public void IsSupported_RefusesADemWeDoNotKnowHowToRead()
    {
        var header = GeoTiffDem.ParseHeader(BuildDem(Values, 46, 25, 1.0 / 3600))!;
        Assert.True(GeoTiffDem.IsSupported(header));

        // Un int16 fără predictor nu se citește „pe încredere": se refuză, ca să se vadă.
        Assert.False(GeoTiffDem.IsSupported(header with { BitsPerSample = 16 }));
        Assert.False(GeoTiffDem.IsSupported(header with { Predictor = 1 }));
        Assert.False(GeoTiffDem.IsSupported(header with { Compression = 5 }));
    }

    [Fact]
    public void ParseHeader_ReturnsNullForSomethingThatIsNotATiff()
    {
        Assert.Null(GeoTiffDem.ParseHeader("nu e un tiff"u8));
        Assert.Null(GeoTiffDem.ParseHeader([0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8]));  // big-endian
    }

    [Fact]
    public void Inflate_RefusesATileThatDecompressesTooSmall()
    {
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
        {
            zlib.Write(new byte[16]);
        }

        Assert.Throws<InvalidDataException>(() => GeoTiffDem.Inflate(compressed.ToArray(), 4096));
    }

    [Fact]
    public void DecodeTile_RefusesATileThatIsTooShort()
    {
        Assert.Throws<ArgumentException>(() => GeoTiffDem.DecodeTile(new byte[8], TileWidth, TileHeight));
    }

    [Theory]
    [InlineData(45.4456, 25.4544, "Copernicus_DSM_COG_10_N45_00_E025_00_DEM")]
    [InlineData(44.4268, 26.1025, "Copernicus_DSM_COG_10_N44_00_E026_00_DEM")]
    [InlineData(-33.9, 18.4, "Copernicus_DSM_COG_10_S34_00_E018_00_DEM")]
    [InlineData(-33.9, -70.6, "Copernicus_DSM_COG_10_S34_00_W071_00_DEM")]
    public void TileFileName_MatchesTheCopernicusNaming(double lat, double lon, string expected)
    {
        Assert.Equal(expected, GeoTiffDem.TileFileName(lat, lon));
    }
}
