using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using TTRMap.Api.Configuration;
using TTRMap.Api.Services;
using TTRMap.Application.Interfaces;
using TTRMap.Infrastructure.Data;
using TTRMap.Infrastructure.Repositories;
using TTRMap.Infrastructure.Services;

// Npgsql 8+ tratează `timestamp with time zone` strict, iar entitățile noastre amestecă `DateTime` cu
// `Kind` Utc și Unspecified (aceeași decizie ca în TTR, ca datele să arate la fel în ambele baze).
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// ── Configurare ────────────────────────────────────────────────────────────

builder.Services.AddOptions<JwtOptions>()
    .Bind(builder.Configuration.GetSection(JwtOptions.SectionName))
    .Validate(
        options => !string.IsNullOrWhiteSpace(options.SecretKey),
        "Jwt:SecretKey lipsește. Trebuie să fie **același** secret ca în TTR, altfel tokenul de login nu e acceptat aici.")
    .ValidateOnStart();

builder.Services.AddOptions<AdminOptions>()
    .Bind(builder.Configuration.GetSection(AdminOptions.SectionName));

builder.Services.AddOptions<DatabaseOptions>()
    .Bind(builder.Configuration.GetSection(DatabaseOptions.SectionName));

var jwtSettings = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();

// ── Bază de date ───────────────────────────────────────────────────────────

builder.Services.AddDbContext<MapDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddScoped<IMountainPoiRepository, MountainPoiRepository>();

// ── Cache ──────────────────────────────────────────────────────────────────

// Un singur cache partajat, dimensionat în „intrări": tile-urile DEM decodate (4 MB bucata, cîteva
// zeci) și rutele Valhalla (mici, dar multe). Plafonul de 512 intrări e cel din TTR, unde s-a dovedit
// suficient pentru un traseu de planificator.
builder.Services.AddMemoryCache(options => options.SizeLimit = 512);

// ── Import puncte montane (Overpass) ───────────────────────────────────────

builder.Services.Configure<OverpassOptions>(
    builder.Configuration.GetSection(OverpassOptions.SectionName));
builder.Services.AddHttpClient(OverpassMountainPoiImporter.HttpClientName, (provider, client) =>
{
    var overpass = provider.GetRequiredService<IOptions<OverpassOptions>>().Value;
    client.Timeout = TimeSpan.FromSeconds(overpass.TimeoutSeconds);
    // `User-Agent` e obligatoriu, nu o curtoazie: fără el, Overpass răspunde **406 Not Acceptable**
    // (verificat la primul import real, 2026-09-23).
    client.DefaultRequestHeaders.UserAgent.ParseAdd(overpass.UserAgent);
});
builder.Services.AddScoped<IOsmMountainPoiImporter, OverpassMountainPoiImporter>();

// ── Altitudini (Copernicus DEM) ────────────────────────────────────────────

builder.Services.Configure<CopernicusOptions>(
    builder.Configuration.GetSection(CopernicusOptions.SectionName));
builder.Services.AddHttpClient(CopernicusElevationProvider.HttpClientName, (provider, client) =>
{
    var dem = provider.GetRequiredService<IOptions<CopernicusOptions>>().Value;
    client.Timeout = TimeSpan.FromSeconds(dem.TimeoutSeconds);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(dem.UserAgent);
});
builder.Services.AddScoped<IElevationProvider, CopernicusElevationProvider>();

// ── Rutare (Valhalla) ──────────────────────────────────────────────────────

builder.Services.Configure<ValhallaOptions>(
    builder.Configuration.GetSection(ValhallaOptions.SectionName));
builder.Services.AddHttpClient(ValhallaRoutingProvider.HttpClientName, (provider, client) =>
{
    var valhalla = provider.GetRequiredService<IOptions<ValhallaOptions>>().Value;
    client.Timeout = TimeSpan.FromSeconds(valhalla.TimeoutSeconds);
    client.DefaultRequestHeaders.UserAgent.ParseAdd(valhalla.UserAgent);
});
builder.Services.AddScoped<IRoutingProvider, ValhallaRoutingProvider>();

// ── Autentificare ──────────────────────────────────────────────────────────

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.SecretKey)),
        };
    });

builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, AdministratorOnlyHandler>();

builder.Services.AddAuthorizationBuilder()
    // Implicit, tot ce nu e marcat explicit cere autentificare: un endpoint nou nu are voie să fie
    // public din neatenție.
    .SetFallbackPolicy(new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build())
    .AddAdministratorPolicy();

// ── Rate limiting ──────────────────────────────────────────────────────────

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;

    // Citirea punctelor: ecranul cere la fiecare pan al hărții, deci plafonul e larg.
    options.AddPolicy(RateLimitPolicies.MountainPoiRead, context =>
        RateLimitKeys.FixedWindow(context, RateLimitKeys.AccountOrIp(context), permitLimit: 600, TimeSpan.FromHours(1)));

    // Importul: operație de administrator, rară, dar scumpă la sursă.
    options.AddPolicy(RateLimitPolicies.MountainPoiImport, context =>
        RateLimitKeys.FixedWindow(context, RateLimitKeys.AccountOrIp(context), permitLimit: 6, TimeSpan.FromHours(1)));

    // Altitudinile: fiecare cerere citește din DEM-ul public de pe AWS.
    options.AddPolicy(RateLimitPolicies.Elevation, context =>
        RateLimitKeys.FixedWindow(context, RateLimitKeys.AccountOrIp(context), permitLimit: 120, TimeSpan.FromHours(1)));

    // Rutarea: un proces Valhalla per cerere, iar planificatorul recalculează la fiecare atingere.
    options.AddPolicy(RateLimitPolicies.Routing, context =>
        RateLimitKeys.FixedWindow(context, RateLimitKeys.AccountOrIp(context), permitLimit: 600, TimeSpan.FromHours(1)));

    options.OnRejected = async (context, cancellationToken) =>
    {
        if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter))
        {
            context.HttpContext.Response.Headers.RetryAfter =
                ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }

        context.HttpContext.Response.ContentType = "text/plain; charset=utf-8";
        await context.HttpContext.Response.WriteAsync(
            "Prea multe cereri. Încearcă din nou în câteva minute.", cancellationToken);
    };
});

// ── CORS ───────────────────────────────────────────────────────────────────

builder.Services.AddCors(opt =>
{
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

    opt.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            policy.AllowAnyOrigin();
        }
        else
        {
            policy.WithOrigins(allowedOrigins).AllowCredentials();
        }

        policy.AllowAnyHeader().AllowAnyMethod();
    });
});

builder.Services.AddControllers();
builder.Services.AddHealthChecks();
builder.Services.AddOpenApi();

var app = builder.Build();

// ── Migrări ────────────────────────────────────────────────────────────────

var migrateOnStartup = app.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value.MigrateOnStartup;

if (MountainPoiImportCommand.ReadBbox(args) is { } mountainPoiBbox)
{
    await using (var scope = app.Services.CreateAsyncScope())
    {
        await scope.ServiceProvider.GetRequiredService<MapDbContext>().Database.MigrateAsync();
    }

    Environment.ExitCode = await MountainPoiImportCommand.RunAsync(app.Services, app.Logger, mountainPoiBbox);
    return;
}

if (args.Contains("--migrate-only", StringComparer.OrdinalIgnoreCase))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<MapDbContext>().Database.MigrateAsync();
    return;
}

if (migrateOnStartup)
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<MapDbContext>().Database.MigrateAsync();
}

// ── Pipeline ───────────────────────────────────────────────────────────────

app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
});

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.MapControllers();
app.MapHealthChecks("/health").AllowAnonymous();

app.Run();
