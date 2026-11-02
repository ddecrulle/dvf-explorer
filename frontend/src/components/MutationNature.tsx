import { useTranslation } from 'react-i18next';

export function MutationNature({ nature }: { nature?: string | null }) {
  const { t } = useTranslation();
  if (!nature) return null;
  const label =
    nature === "Vente en l'état futur d'achèvement"
      ? t('natures.vefa')
      : nature === 'Vente'
        ? t('natures.sale')
        : nature === 'Vente terrain à bâtir'
          ? t('natures.land')
          : nature === 'Adjudication'
            ? t('natures.auction')
            : nature === 'Echange'
              ? t('natures.exchange')
              : nature === 'Expropriation'
                ? t('natures.expropriation')
                : nature;
  return (
    <span className="mutation-nature" title={nature}>
      {label}
    </span>
  );
}
