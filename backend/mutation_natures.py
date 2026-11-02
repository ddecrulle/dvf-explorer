"""Official DVF mutation labels, shared by both importers."""

NATURES = frozenset(
    {
        "Vente",
        "Vente en l'état futur d'achèvement",
        "Vente terrain à bâtir",
        "Adjudication",
        "Echange",
        "Expropriation",
    }
)


def nature(value):
    label = value.strip().replace("’", "'")
    if label not in NATURES:
        raise ValueError(f"Unknown mutation nature: {label}")
    return label
