namespace TTRMap.Domain.Enums;

/// <summary>
/// Cu ce se merge pe ruta cerută. Nu e „mod de transport" în sensul general, ci **ce profil de cost**
/// primește motorul de rutare: pentru munte, diferența dintre „pe jos" și „cu bicicleta" nu e doar
/// viteza, ci ce trasee au voie să apară.
///
/// Vezi `ttrmap/docs/STUDY-MAP.md` §5.3.
/// </summary>
public enum TravelProfile
{
    /// <summary>Pe jos (`costing=pedestrian`). Urmează poteci marcate, acceptă trepte de dificultate.</summary>
    Foot = 0,

    /// <summary>
    /// Bicicletă de trekking / oraș (`bicycle_type=hybrid`). Evită potecii tehnice; e profilul potrivit
    /// pentru un drum forestier sau un traseu de cicloturism.
    /// </summary>
    Bike = 1,

    /// <summary>
    /// Bicicletă de munte (`bicycle_type=mountain`). Acceptă poteci cu `mtb:scale`, refuzate de
    /// profilul de trekking.
    /// </summary>
    Mtb = 2,
}
