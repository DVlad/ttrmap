namespace TTRMap.Api.Configuration;

/// <summary>Setările serviciului de hartă.</summary>
public sealed class AdminOptions
{
    public const string SectionName = "Admin";

    /// <summary>
    /// Email-urile cu drept de import. În TTR rolul se citește din bază; aici nu există tabel de
    /// utilizatori, deci lista e configurare de deploy — vezi `AdministratorOnlyHandler`.
    /// </summary>
    public string[] Emails { get; set; } = [];
}

/// <summary>Setările tokenului. Valorile trebuie să fie **identice cu cele din TTR**, altfel tokenul
/// emis la login nu e acceptat aici și harta rămîne pe ecranul de autentificare.</summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    public string SecretKey { get; set; } = "";
    public string Issuer { get; set; } = "ttr-api";
    public string Audience { get; set; } = "ttr-app";
}

/// <summary>Setările bazei de date a hărții.</summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>Aplică migrările la pornire. Se scoate pe `false` cînd migrarea rulează ca pas separat.</summary>
    public bool MigrateOnStartup { get; set; } = true;
}
