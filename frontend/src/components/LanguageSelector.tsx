import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../i18n';

export function LanguageSelector() {
  const { t, i18n } = useTranslation();
  return (
    <div className="language-selector">
      <select
        aria-label={t('app.language')}
        value={i18n.resolvedLanguage}
        onChange={(event) =>
          void changeLanguage(event.target.value === 'en' ? 'en' : 'fr')
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
