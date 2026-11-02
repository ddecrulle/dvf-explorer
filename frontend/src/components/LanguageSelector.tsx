import { useExplorerRoute } from '../routing/useExplorerRoute';
import { useTranslation } from 'react-i18next';

export function LanguageSelector() {
  const router = useExplorerRoute();
  const { t, i18n } = useTranslation();
  return (
    <div className="language-selector">
      <select
        aria-label={t('app.language')}
        value={i18n.resolvedLanguage}
        onChange={(event) =>
          void router.navigate({
            language: event.target.value === 'en' ? 'en' : 'fr',
          })
        }
      >
        <option value="fr" lang="fr">
          Français
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </div>
  );
}
