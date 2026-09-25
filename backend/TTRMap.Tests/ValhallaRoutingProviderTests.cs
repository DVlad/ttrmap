using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using TTRMap.Application.Services;
using TTRMap.Domain.Enums;
using TTRMap.Infrastructure.Services;
using Xunit;

namespace TTRMap.Tests;

/// <summary>
/// Rutarea prin Valhalla. Ce se apără aici:
/// <list type="bullet">
/// <item><b>ce pleacă</b> către motor — profilul și opțiunile de cost, fiindcă de ele depinde dacă ruta
/// urcă pe potecă sau ocolește pe drum forestier;</item>
/// <item><b>ce se întoarce</b> cînd motorul cade sau refuză — `null`, niciodată o linie dreaptă care
/// arată ca o rută.</item>
/// </list>
/// </summary>
public class ValhallaRoutingProviderTests
{
    private static readonly GeoPoint Start = new(45.4457, 25.4566);
    private static readonly GeoPoint End = new(45.4028, 25.4645);

    [Fact]
    public async Task FindRouteAsync_SendsPedestrianCostingWithTrailsForFoot()
    {
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", lengthKm: 6.347, timeSeconds: 4792.4));
        var provider = Build(handler);

        var path = await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot));

        Assert.NotNull(path);

        using var sent = JsonDocument.Parse(handler.Sent[0].Body);
        var root = sent.RootElement;
        Assert.Equal("pedestrian", root.GetProperty("costing").GetString());

        var pedestrian = root.GetProperty("costing_options").GetProperty("pedestrian");
        Assert.Equal(1, pedestrian.GetProperty("use_trails").GetDouble());
        Assert.Equal(6, pedestrian.GetProperty("max_hiking_difficulty").GetInt32());

        Assert.Equal(2, root.GetProperty("locations").GetArrayLength());
        Assert.Equal(45.4457, root.GetProperty("locations")[0].GetProperty("lat").GetDouble(), 4);
        Assert.Equal(25.4566, root.GetProperty("locations")[0].GetProperty("lon").GetDouble(), 4);
    }

    [Fact]
    public async Task FindRouteAsync_SendsMountainBicycleForMtb()
    {
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", 1.2, 300));
        var provider = Build(handler);

        await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Mtb));

        using var sent = JsonDocument.Parse(handler.Sent[0].Body);
        var bicycle = sent.RootElement.GetProperty("costing_options").GetProperty("bicycle");
        Assert.Equal("mountain", bicycle.GetProperty("bicycle_type").GetString());
    }

    [Fact]
    public async Task FindRouteAsync_KeepsTrekkingBikeOffTrails()
    {
        // Profilul de trekking nu are ce căuta pe o potecă tehnică: acolo se merge cu MTB-ul.
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", 1.2, 300));
        var provider = Build(handler);

        await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Bike));

        using var sent = JsonDocument.Parse(handler.Sent[0].Body);
        var bicycle = sent.RootElement.GetProperty("costing_options").GetProperty("bicycle");
        Assert.Equal("hybrid", bicycle.GetProperty("bicycle_type").GetString());
        Assert.Equal(0, bicycle.GetProperty("use_trails").GetDouble());
    }

    [Fact]
    public async Task FindRouteAsync_ConvertsUnitsToMetersAndSeconds()
    {
        // Motorul răspunde în kilometri și secunde; restul aplicației lucrează în metri.
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", lengthKm: 6.347, timeSeconds: 4792.4));
        var provider = Build(handler);

        var path = await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot));

        Assert.NotNull(path);
        Assert.Equal(6347, path.DistanceMeters, 1);
        Assert.Equal(4792.4, path.DurationSeconds, 1);
        Assert.Single(path.Legs);
        Assert.Equal(2, path.Geometry.Count);
        Assert.Equal(45.4457, path.Geometry[0].Latitude, 6);
        Assert.Equal(25.4645, path.Geometry[1].Longitude, 6);
    }

    [Fact]
    public async Task FindRouteAsync_ConcatenatesLegsOfAMultiPointRoute()
    {
        // Fiecare etapă are shape-ul ei, codificat **de la începutul etapei** — nu continuat din etapa
        // precedentă. Aici etapa a doua începe exact unde se termină prima.
        var body = """
        {
          "trip": {
            "legs": [
              { "shape": "gcxtuAo|vpo@fxrAwlN", "summary": { "length": 1.5, "time": 900 } },
              { "shape": "_jdruAgjfqo@wzcKvdzr@", "summary": { "length": 2.5, "time": 1800 } }
            ]
          }
        }
        """;
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, body));
        var provider = Build(handler);

        var path = await provider.FindRouteAsync(
            new RouteRequest([Start, End, new GeoPoint(45.6019, 24.6150)], TravelProfile.Foot));

        Assert.NotNull(path);
        Assert.Equal(2, path.Legs.Count);
        Assert.Equal(4000, path.DistanceMeters, 1);
        Assert.Equal(2700, path.DurationSeconds, 1);

        // Punctul de legătură nu se scrie de două ori: 2 + 2 - 1 = 3 puncte, nu 4.
        Assert.Equal(3, path.Geometry.Count);
        Assert.Equal(45.4028, path.Geometry[1].Latitude, 6);
        Assert.Equal(45.6019, path.Geometry[2].Latitude, 6);
    }

    [Fact]
    public async Task FindRouteAsync_ReturnsNullWhenTheEngineIsDown()
    {
        // Esențial: cînd motorul nu răspunde, planificatorul trebuie să poată spune „nu e
        // disponibil", nu să primească o linie dreaptă care pare o rută.
        var handler = new StubHandler(_ => throw new HttpRequestException("connection refused"));
        var provider = Build(handler);

        Assert.Null(await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot)));
    }

    [Fact]
    public async Task FindRouteAsync_ReturnsNullWhenTheEngineRefusesTheRoute()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.BadRequest,
            """{ "error": "No route found", "error_code": 442 }"""));
        var provider = Build(handler);

        Assert.Null(await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot)));
    }

    [Fact]
    public async Task FindRouteAsync_ReturnsNullForAnEmptyTrip()
    {
        var handler = new StubHandler(_ => Json(HttpStatusCode.OK, """{ "trip": { "legs": [] } }"""));
        var provider = Build(handler);

        Assert.Null(await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot)));
    }

    [Fact]
    public async Task FindRouteAsync_DoesNotCallTheEngineForAnInvalidRequest()
    {
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@", 1, 60));
        var provider = Build(handler);

        var path = await provider.FindRouteAsync(
            new RouteRequest([Start, new GeoPoint(45.44570, 25.45660)], TravelProfile.Foot));

        Assert.Null(path);
        Assert.Empty(handler.Sent);
    }

    [Fact]
    public async Task FindRouteAsync_ServesTheSameRouteFromCache()
    {
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", 6.3, 4700));
        var provider = Build(handler);
        var request = new RouteRequest([Start, End], TravelProfile.Foot);

        var first = await provider.FindRouteAsync(request);
        var second = await provider.FindRouteAsync(request);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Same(first, second);
        Assert.Single(handler.Sent);
    }

    [Fact]
    public async Task FindRouteAsync_DoesNotReuseTheCacheForAnotherProfile()
    {
        // Aceleași puncte, alt profil: bicicleta și mersul pe jos nu împart ruta.
        var handler = new StubHandler(_ => Trip("gcxtuAo|vpo@fxrAwlN", 6.3, 4700));
        var provider = Build(handler);

        await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Foot));
        await provider.FindRouteAsync(new RouteRequest([Start, End], TravelProfile.Mtb));

        Assert.Equal(2, handler.Sent.Count);
    }

    private static ValhallaRoutingProvider Build(StubHandler handler)
    {
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 64 });
        return new ValhallaRoutingProvider(
            new StubFactory(handler),
            cache,
            Options.Create(new ValhallaOptions()),
            NullLogger<ValhallaRoutingProvider>.Instance);
    }

    private static HttpResponseMessage Trip(string shape, double lengthKm, double timeSeconds) =>
        Json(HttpStatusCode.OK, $$"""
        {
          "trip": {
            "legs": [ { "shape": "{{shape}}", "summary": { "length": {{lengthKm}}, "time": {{timeSeconds}} } } ]
          }
        }
        """);

    private static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        /// <summary>Cererile trimise, cu tot cu corp: contractul cu motorul e ce *pleacă*, nu doar ce vine.</summary>
        public List<(string Method, string Uri, string Body)> Sent { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(ct);
            Sent.Add((request.Method.Method, request.RequestUri!.AbsoluteUri, body));
            return respond(request);
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}
