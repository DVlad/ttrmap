namespace TTRMap.Domain.Enums;

/// <summary>
/// Felul punctului de interes montan.
///
/// Lista e intenționat scurtă și **operațională**, nu enciclopedică: fiecare valoare are un loc unde
/// contează (o cabană e un popas, un refugiu e o salvare, un post Salvamont e un număr de telefon).
/// Vezi `ttrmap/docs/STUDY-MAP.md` §7.1.
/// </summary>
public enum MountainPoiCategory
{
    /// <summary>Cabană (`tourism=alpine_hut|chalet`).</summary>
    Hut = 0,

    /// <summary>Refugiu (`tourism=wilderness_hut`, `amenity=shelter` cu `shelter_type=basic_hut|lean_to`).</summary>
    Shelter = 1,

    /// <summary>Post Salvamont / salvare montană (`emergency=mountain_rescue`).</summary>
    Rescue = 2,

    /// <summary>Apă potabilă / izvor (`natural=spring` cu `drinking_water=yes`).</summary>
    Water = 3,

    /// <summary>Belvedere (`tourism=viewpoint`).</summary>
    Viewpoint = 4,

    /// <summary>Indicator de traseu (`information=guidepost`).</summary>
    Guidepost = 5,

    /// <summary>
    /// Zonă semnalizată ca periculoasă (porțiune expusă, cablu, horn, vale de avalanșă, zonă cu urs).
    ///
    /// **Nu se importă din OSM** — nu există un tag pe care să te bazezi. Se adaugă din catalog, cu
    /// proveniență și verificare umană (`ttrmap/docs/STUDY-MAP.md` §7.3.3), exact de aceea categoria există
    /// de la început: ca avertizările să nu ajungă un al doilea mecanism, paralel.
    /// </summary>
    Warning = 6,
}
