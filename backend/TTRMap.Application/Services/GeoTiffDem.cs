using System.Buffers.Binary;
using System.Globalization;
using System.IO.Compression;

namespace TTRMap.Application.Services;

/// <summary>
/// Cititor minim de GeoTIFF „Cloud Optimized" — atît cît ne trebuie ca să scoatem **o altitudine la o
/// coordonată** dintr-un DEM Copernicus GLO-30.
///
/// <para>
/// **De ce nu GDAL.** GDAL rezolvă tot, dar vine cu ~200 MB de binare native, iar aplicația asta
/// rulează pe un VPS de ~5 €. Aici avem nevoie de exact un lucru (un `float` la un pixel), iar
/// fișierele Copernicus au o structură fixă și simplă: float32, tile-uri de 1024, DEFLATE, un singur
/// nivel de detaliu în IFD0. Cititorul de mai jos acoperă **doar** atît și **refuză explicit** orice
/// altceva (vezi <see cref="IsSupported"/>) — un DEM cu int16 sau fără predictor nu se citește pe
/// încredere, se raportează.
/// </para>
///
/// <para>
/// **Predictorul e partea grea.** Fișierele au `Predictor = 3` (predictor pentru virgulă mobilă), iar
/// octeții decomprimați **nu** sînt flotanții: sînt (a) o sumă cumulativă pe octeți, pe fiecare rînd,
/// apoi (b) patru „plane" de octeți per rînd, cu octetul cel mai semnificativ primul. Schema a fost
/// determinată pe date reale, nu ghicită: vezi testul care citește Vîrful Omu (2506 m față de 2505 în
/// OSM) și verificarea din `ttrmap/docs/STUDY-MAP.md`.
/// </para>
/// </summary>
public static class GeoTiffDem
{
    /// <summary>Cît citim din capul fișierului: destul pentru IFD0 și valorile lui în afara rîndului.</summary>
    public const int HeaderBytes = 64 * 1024;

    private const int TagImageWidth = 256;
    private const int TagImageLength = 257;
    private const int TagBitsPerSample = 258;
    private const int TagCompression = 259;
    private const int TagPredictor = 317;
    private const int TagTileWidth = 322;
    private const int TagTileLength = 323;
    private const int TagTileOffsets = 324;
    private const int TagTileByteCounts = 325;
    private const int TagSampleFormat = 339;
    private const int TagModelPixelScale = 33550;
    private const int TagModelTiepoint = 33922;

    /// <summary>Ce e nevoie ca să putem citi un pixel: tot restul se refuză, nu se presupune.</summary>
    public sealed record Header(
        int ImageWidth,
        int ImageLength,
        int TileWidth,
        int TileHeight,
        int BitsPerSample,
        int SampleFormat,
        int Compression,
        int Predictor,
        long[] TileOffsets,
        long[] TileByteCounts,
        double PixelScale,
        double OriginLongitude,
        double OriginLatitude)
    {
        public int TilesAcross => (ImageWidth + TileWidth - 1) / TileWidth;

        public int TilesDown => (ImageLength + TileHeight - 1) / TileHeight;

        /// <summary>Indexul tile-ului care conține pixelul dat, în ordinea TIFF (rînd cu rînd).</summary>
        public int TileIndexFor(int column, int row) =>
            (row / TileHeight) * TilesAcross + (column / TileWidth);
    }

    /// <summary>
    /// Citește IFD0. Întoarce `null` dacă fișierul nu e un TIFF little-endian valid sau nu are
    /// tag-urile de care avem nevoie — un fișier necitit trebuie să se vadă, nu să dea altitudini de 0.
    /// </summary>
    public static Header? ParseHeader(ReadOnlySpan<byte> head)
    {
        if (head.Length < 8) return null;

        // „II" = little-endian. Copernicus scrie așa; big-endian nu apare în practică la acest DEM.
        if (head[0] != (byte)'I' || head[1] != (byte)'I') return null;
        if (BinaryPrimitives.ReadUInt16LittleEndian(head[2..]) != 42) return null;

        var ifdOffset = (int)BinaryPrimitives.ReadUInt32LittleEndian(head[4..]);
        if (ifdOffset < 0 || ifdOffset + 2 > head.Length) return null;

        var entryCount = BinaryPrimitives.ReadUInt16LittleEndian(head[ifdOffset..]);
        var tags = new Dictionary<int, double[]>();

        for (var i = 0; i < entryCount; i++)
        {
            var entry = ifdOffset + 2 + i * 12;
            if (entry + 12 > head.Length) return null;

            var tag = BinaryPrimitives.ReadUInt16LittleEndian(head[entry..]);
            var type = BinaryPrimitives.ReadUInt16LittleEndian(head[(entry + 2)..]);
            var count = (int)BinaryPrimitives.ReadUInt32LittleEndian(head[(entry + 4)..]);

            var typeSize = TypeSize(type);
            if (typeSize == 0 || count < 0) continue;

            var totalBytes = (long)typeSize * count;
            var valueOffset = totalBytes <= 4
                ? entry + 8
                : (int)BinaryPrimitives.ReadUInt32LittleEndian(head[(entry + 8)..]);

            if (valueOffset < 0 || valueOffset + totalBytes > head.Length) continue;

            var values = new double[count];
            for (var k = 0; k < count; k++)
            {
                var at = valueOffset + k * typeSize;
                values[k] = type switch
                {
                    3 => BinaryPrimitives.ReadUInt16LittleEndian(head[at..]),
                    4 => BinaryPrimitives.ReadUInt32LittleEndian(head[at..]),
                    12 => BitConverter.Int64BitsToDouble(
                        BinaryPrimitives.ReadInt64LittleEndian(head[at..])),
                    _ => 0,
                };
            }

            tags[tag] = values;
        }

        if (!tags.TryGetValue(TagImageWidth, out var width) ||
            !tags.TryGetValue(TagImageLength, out var length) ||
            !tags.TryGetValue(TagTileWidth, out var tileWidth) ||
            !tags.TryGetValue(TagTileLength, out var tileLength) ||
            !tags.TryGetValue(TagTileOffsets, out var offsets) ||
            !tags.TryGetValue(TagTileByteCounts, out var byteCounts) ||
            !tags.TryGetValue(TagModelPixelScale, out var scale) ||
            !tags.TryGetValue(TagModelTiepoint, out var tiepoint))
        {
            return null;
        }

        return new Header(
            ImageWidth: (int)width[0],
            ImageLength: (int)length[0],
            TileWidth: (int)tileWidth[0],
            TileHeight: (int)tileLength[0],
            BitsPerSample: tags.TryGetValue(TagBitsPerSample, out var bits) ? (int)bits[0] : 0,
            SampleFormat: tags.TryGetValue(TagSampleFormat, out var format) ? (int)format[0] : 0,
            Compression: tags.TryGetValue(TagCompression, out var compression) ? (int)compression[0] : 0,
            Predictor: tags.TryGetValue(TagPredictor, out var predictor) ? (int)predictor[0] : 1,
            TileOffsets: [.. offsets.Select(v => (long)v)],
            TileByteCounts: [.. byteCounts.Select(v => (long)v)],
            PixelScale: scale.Length > 0 ? scale[0] : 0,
            OriginLongitude: tiepoint.Length >= 4 ? tiepoint[3] : 0,
            OriginLatitude: tiepoint.Length >= 5 ? tiepoint[4] : 0);
    }

    private static int TypeSize(int tiffType) => tiffType switch
    {
        1 or 2 or 6 or 7 => 1,
        3 or 8 => 2,
        4 or 9 or 11 => 4,
        5 or 10 or 12 => 8,
        _ => 0,
    };

    /// <summary>
    /// Fișierul are exact forma pe care o știm citi? Dacă nu, se spune — nu se ghicește.
    /// </summary>
    public static bool IsSupported(Header header) =>
        header.BitsPerSample == 32 &&
        header.SampleFormat == 3 &&          // IEEE float
        header.Compression == 8 &&           // Adobe Deflate (zlib)
        header.Predictor == 3 &&             // predictor pentru virgulă mobilă
        header.TileWidth > 0 &&
        header.TileHeight > 0 &&
        header.PixelScale > 0 &&
        header.TileOffsets.Length == header.TilesAcross * header.TilesDown;

    /// <summary>
    /// Octeții decomprimați ai unui tile → valorile lui, în ordinea pixelilor (rînd cu rînd).
    ///
    /// Pașii, în ordinea asta (inversul a ce a scris encoderul):
    /// <list type="number">
    /// <item>suma cumulativă pe octeți, **pe fiecare rînd în parte** (diferențierea orizontală);</item>
    /// <item>reasamblarea fiecărui `float` din patru plane de octeți, cu **MSB primul**.</item>
    /// </list>
    /// </summary>
    public static float[] DecodeTile(byte[] inflated, int tileWidth, int tileHeight)
    {
        var rowBytes = tileWidth * 4;
        var expected = rowBytes * tileHeight;
        if (inflated.Length < expected)
        {
            throw new ArgumentException(
                $"Tile-ul are {inflated.Length} octeți, dar ar trebui {expected}.", nameof(inflated));
        }

        var values = new float[checked(tileWidth * tileHeight)];
        var sample = new byte[4];

        for (var row = 0; row < tileHeight; row++)
        {
            var baseOffset = row * rowBytes;

            // (1) Suma cumulativă pe octeți, pe rînd.
            for (var i = 1; i < rowBytes; i++)
            {
                inflated[baseOffset + i] = (byte)(inflated[baseOffset + i] + inflated[baseOffset + i - 1]);
            }

            // (2) Planele: octetul cel mai semnificativ e primul.
            for (var column = 0; column < tileWidth; column++)
            {
                sample[0] = inflated[baseOffset + column];
                sample[1] = inflated[baseOffset + tileWidth + column];
                sample[2] = inflated[baseOffset + 2 * tileWidth + column];
                sample[3] = inflated[baseOffset + 3 * tileWidth + column];
                values[row * tileWidth + column] = BinaryPrimitives.ReadSingleBigEndian(sample);
            }
        }

        return values;
    }

    /// <summary>Decomprimă un tile DEFLATE (zlib) la dimensiunea lui completă.</summary>
    public static byte[] Inflate(byte[] compressed, int expectedBytes)
    {
        using var input = new MemoryStream(compressed, writable: false);
        using var zlib = new ZLibStream(input, CompressionMode.Decompress);
        using var output = new MemoryStream(expectedBytes);
        zlib.CopyTo(output);

        var bytes = output.ToArray();
        if (bytes.Length < expectedBytes)
        {
            throw new InvalidDataException(
                $"Tile-ul s-a decomprimat la {bytes.Length} octeți, sub cei {expectedBytes} așteptați.");
        }

        return bytes;
    }

    /// <summary>Pozitia pixelului pentru o coordonată, sau `null` dacă e în afara tile-ului.</summary>
    public static (int Column, int Row)? Project(Header header, double latitude, double longitude)
    {
        var column = (int)Math.Floor((longitude - header.OriginLongitude) / header.PixelScale);
        var row = (int)Math.Floor((header.OriginLatitude - latitude) / header.PixelScale);

        if (column < 0 || row < 0 || column >= header.ImageWidth || row >= header.ImageLength)
        {
            return null;
        }

        return (column, row);
    }

    /// <summary>Valoarea unui pixel dintr-un tile decodat.</summary>
    public static float ValueAt(Header header, float[] tile, int column, int row)
    {
        var localColumn = column % header.TileWidth;
        var localRow = row % header.TileHeight;
        return tile[localRow * header.TileWidth + localColumn];
    }

    /// <summary>Numele fișierului Copernicus pentru o coordonată (un grad pe un grad).</summary>
    public static string TileFileName(double latitude, double longitude)
    {
        var ns = latitude >= 0 ? "N" : "S";
        var ew = longitude >= 0 ? "E" : "W";
        var lat = Math.Abs((int)Math.Floor(latitude)).ToString("00", CultureInfo.InvariantCulture);
        var lon = Math.Abs((int)Math.Floor(longitude)).ToString("000", CultureInfo.InvariantCulture);
        return $"Copernicus_DSM_COG_10_{ns}{lat}_00_{ew}{lon}_00_DEM";
    }
}
