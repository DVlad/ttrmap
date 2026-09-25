using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using TTRMap.Api.Configuration;

namespace TTRMap.Api.Services;

/// <summary>Cerința „contul este administrator".</summary>
public sealed class AdministratorOnlyRequirement : IAuthorizationRequirement;

/// <summary>
/// Poarta de administrator a serviciului de hartă.
///
/// <para>
/// **De ce altfel decît în TTR.** Acolo rolul se citește proaspăt din bază, la fiecare request, ca un
/// administrator retrogradat să-și piardă accesul imediat. Serviciul de hartă nu are tabel de
/// utilizatori (are bază proprie, iar contul e comun doar prin token), deci nu poate citi rolul.
/// Poarta se sprijină atunci pe **lista de administratori din configurare** (`Admin:Emails`), verificată
/// față de email-ul din token.
/// </para>
///
/// <para>
/// Ce se pierde, spus explicit: un administrator scos din listă păstrează accesul pînă îi expiră
/// tokenul (30 de minute, `Jwt:TokenExpiryMinutes`). E acceptabil pentru singurul endpoint care o
/// folosește — importul de puncte montane, o operație rară de ops — și e mai ieftin decît să ducem
/// tabelul de utilizatori după noi.
/// </para>
/// </summary>
public sealed class AdministratorOnlyHandler(IOptions<AdminOptions> admin)
    : AuthorizationHandler<AdministratorOnlyRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context, AdministratorOnlyRequirement requirement)
    {
        var email = context.User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;

        if (!string.IsNullOrWhiteSpace(email) &&
            admin.Value.Emails.Any(candidate =>
                string.Equals(candidate.Trim(), email.Trim(), StringComparison.OrdinalIgnoreCase)))
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// `[AdministratorOnly]` = „contul e în lista de administratori". Se folosește pe endpoint-uri, nu pe
/// butoane: un gate doar în UI se ocolește cu un request direct.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
public sealed class AdministratorOnlyAttribute : AuthorizeAttribute
{
    public const string PolicyName = "AdministratorOnly";

    public AdministratorOnlyAttribute() => Policy = PolicyName;
}

public static class AdministratorPolicies
{
    /// <summary>
    /// Politica de admin: cere **și** autentificare, ca răspunsul să fie 401 pentru anonim și 403
    /// pentru „autentificat, dar nu e administrator".
    /// </summary>
    public static AuthorizationBuilder AddAdministratorPolicy(this AuthorizationBuilder builder) =>
        builder.AddPolicy(
            AdministratorOnlyAttribute.PolicyName,
            policy => policy
                .RequireAuthenticatedUser()
                .AddRequirements(new AdministratorOnlyRequirement()));
}
